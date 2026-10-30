// The tool registry (AD-7, muse-reference section 3): tools live in namespaces, each eager or
// deferred at one of two levels. "names": the reference shows the names and one line each, and
// `tool_search` loads the full schemas on demand. "hidden": nothing is shown until `tool_search`
// discovers it. A loaded namespace stays loaded for the rest of the chat session.
//
// Every tool is classified: an observation runs when called and returns its result at once (it may
// read or change the person's own store); an action reaches outside the agent and is queued until
// the step's persistence barrier (`actions.ts`). The classification is typed on the spec, so the
// reference and the queue read it from one place and prompt text never decides it. From M7.1 every
// call but `send_to_user`'s passes the chat's gate (`chat/gate.ts`), where the grants engine decides.
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { TSchema } from "@earendil-works/pi-ai";
import { refuseMalformed } from "../chat/tools.ts";
import { scrubSurrogates, scrubValue } from "../egress/surrogate.ts";
import type { Descriptor } from "../grants/types.ts";
import { DOCS_PREFIX, DOCS_READ_ONLY, reachesDocs, reachesPlatformSkills, SKILLS_PLATFORM_PREFIX, SKILLS_READ_ONLY } from "../skills/platform-docs.ts";
import { type SpillSink, spillResult } from "../tree/spill.ts";

export type ToolKind = "observation" | "action";
export type Deferral = "eager" | "names" | "hidden";

export interface ToolSpec<P extends TSchema = TSchema> {
  name: string;
  kind: ToolKind;
  label: string;
  description: string;
  parameters: P;
  /** An observation runs this when called; an action runs it after the barrier, from the queue. */
  execute: AgentTool<P>["execute"];
  /** Set on an action whose execute queues its own effect (send_to_user); the registry then does not queue it. */
  queues?: "self";
  /** The action kind the grants engine decides on (M7.1); every action other than `queues: "self"` has one. */
  actionKind?: string;
  /** The ids the call touches; a company scope makes an observation a grant decision too. */
  subject?: (args: Record<string, unknown>) => Omit<Descriptor["subject"], "ref">;
  /** Words the approval card adds beyond the descriptor's identifiers (what the person decides on), read when the call is proposed. */
  cardLines?: (args: Record<string, unknown>) => Promise<string[]>;
  amount?: (args: Record<string, unknown>) => Descriptor["amount"];
  recipients?: (args: Record<string, unknown>) => string[];
  purchase?: true;
  /** The action hands the task to another agent; the restricted latch refuses it. */
  forwardsToAgent?: true;
  /** The connector can project a pending call: the result it would read as once applied (simulation). */
  project?: (args: Record<string, unknown>) => string;
  /** An observation that changes the person's own store; refused while a colleague's request runs. */
  mutates?: true;
  /** Results carry content from outside the person's own stores (a page, a connector, a sandbox). */
  external?: true;
  /** A decision the agent never makes: every call is journaled as refused with this code (M16.3), and `execute` only shows where the person decides. */
  refuses?: string;
}

/**
 * Where every gated call goes (M7.1): actions, and observations of company resources. It decides
 * through the grants engine, queues what the decision allows and answers the model; `run` performs an
 * observation when the decision lets it run now.
 */
export interface Gate {
  call(spec: ToolSpec, id: string, args: Record<string, unknown>, run: () => Promise<AgentToolResult<unknown>>): Promise<AgentToolResult<unknown>>;
}

export interface Namespace {
  name: string;
  description: string;
  deferral: Deferral;
  tools: ToolSpec[];
}

export interface SearchHit {
  namespace: string;
  loaded: boolean;
  tool: string;
  kind: ToolKind;
  description: string;
}

const NAME = /^[a-z][a-z0-9_]{1,40}$/;
const STOP = new Set(["a", "an", "and", "as", "at", "be", "by", "do", "for", "from", "how", "i", "in", "is", "it", "me", "my", "of", "on", "or", "that", "the", "this", "to", "up", "use", "with", "you", "your"]);

/** Search terms of a query: lower-cased words with the function words dropped, so "my" never matches. */
export function searchTerms(query: string): string[] {
  return query.toLowerCase().split(/[^a-z0-9_-]+/).filter((t) => t.length > 1 && !STOP.has(t));
}

/**
 * What no tool may reach (F40, P14 B-P14-02, B-P14-05 to 07, delta 5): the agent's name, the person's profile, a
 * setting, a passkey, a session, sign-in, recovery, an export or the account. A tool whose name holds one of these
 * words, or whose description offers to change one of them, is refused when its registry is built, so no turn of a
 * chat, a request or a sub-agent is ever offered one. Exporting work (a file, the notes) is work, not identity: only
 * an export of the account or its data is refused. The tests plant a `settings_set` and a `passkey_remove`.
 */
export const IDENTITY_TOOL_WORDS: readonly string[] = ["identity", "setting", "settings", "theme", "language", "notification", "notifications", "profile", "avatar", "pronoun", "pronouns", "passkey", "passkeys", "session", "sessions", "login", "logout", "signin", "signout", "recovery", "recover", "password", "account"];
export const IDENTITY_TOOL_OFFER =
  /\b(passkeys?|recovery codes?|log ?out|sign[- ]?out|delete (?:the |your |an )?account|export (?:the |your |all )?(?:data|account)|(?:change|set|switch|update|toggle|turn (?:on|off)) (?:a |the |your |their )?(?:settings?|theme|language|notifications?|profile|avatar|password|e-?mail address|agent'?s name))\b/i;

/**
 * Tools whose name says `login` of another site, never fletch's sign-in (F41): `browse_save_login` keeps a website's
 * login sealed in the person's vault (M24.3), registered only where a browser is bound, so no hermetic world built it
 * and the guard refused every turn on a deploy with one. Only the word `login` is let through, and only for these.
 */
export const SITE_LOGIN_TOOLS: readonly string[] = ["browse_save_login"];

/** The identity word a tool's name holds or its description offers, or null: the guard `ToolRegistry` applies. */
export function identityReach(spec: Pick<ToolSpec, "name" | "description">): string | null {
  const site = SITE_LOGIN_TOOLS.includes(spec.name);
  const word = spec.name.split("_").find((w) => IDENTITY_TOOL_WORDS.includes(w) && !(site && w === "login"));
  return word ?? IDENTITY_TOOL_OFFER.exec(spec.description)?.[0]?.toLowerCase() ?? null;
}

/** The namespaces of one tenant's agent, fixed at construction; loads are per session. */
export class ToolRegistry {
  readonly namespaces: readonly Namespace[];

  constructor(namespaces: Namespace[]) {
    const seen = new Set<string>();
    for (const ns of namespaces) {
      if (!NAME.test(ns.name)) throw new Error(`TOOL_NAMESPACE_INVALID: ${ns.name}`);
      for (const t of ns.tools) {
        if (!NAME.test(t.name)) throw new Error(`TOOL_NAME_INVALID: ${t.name}`);
        if (seen.has(t.name)) throw new Error(`TOOL_NAME_DUPLICATE: ${t.name}`);
        const reach = identityReach(t);
        if (reach) throw new Error(`TOOL_IDENTITY_REFUSED: ${t.name} reaches "${reach}", which only the person changes`);
        seen.add(t.name);
      }
    }
    this.namespaces = namespaces;
  }

  namespace(name: string): Namespace | undefined {
    return this.namespaces.find((n) => n.name === name);
  }

  spec(tool: string): { namespace: Namespace; spec: ToolSpec } | undefined {
    for (const namespace of this.namespaces) {
      const spec = namespace.tools.find((t) => t.name === tool);
      if (spec) return { namespace, spec };
    }
    return undefined;
  }

  /** Namespaces whose tools the model may call now: eager ones and the loaded ones. */
  active(loaded: ReadonlySet<string>): Namespace[] {
    return this.namespaces.filter((n) => n.deferral === "eager" || loaded.has(n.name));
  }

  /** Case-insensitive match over every namespace, hidden ones included: this is the discovery path. */
  search(query: string, loaded: ReadonlySet<string>): SearchHit[] {
    const terms = searchTerms(query);
    const hits: Array<SearchHit & { score: number }> = [];
    for (const ns of this.namespaces) {
      for (const t of ns.tools) {
        const hay = `${ns.name} ${ns.description} ${t.name} ${t.description}`.toLowerCase();
        const score = terms.filter((term) => hay.includes(term)).length;
        if (terms.length && score === 0) continue;
        hits.push({ namespace: ns.name, loaded: ns.deferral === "eager" || loaded.has(ns.name), tool: t.name, kind: t.kind, description: t.description, score });
      }
    }
    return hits.sort((a, b) => b.score - a.score || a.tool.localeCompare(b.tool)).map(({ score: _, ...hit }) => hit);
  }
}

/** Without a gate nothing outside the person's own stores runs: the safe default. */
const NO_GATE: Gate = {
  call: async (spec, _id, _args, run) =>
    spec.kind === "observation" && spec.subject === undefined
      ? run()
      : { content: [{ type: "text", text: `GRANTS_UNAVAILABLE: ${spec.name} needs the grants engine, which this chat does not have` }], details: { code: "GRANTS_UNAVAILABLE" } },
};

/** A tool that reads or searches may name the docs prefix; one that could change a path there is refused (M24.1). */
const READS = /_(read|list|get|search|explain)$/;
export function refuseDocsWrite(tool: string, args: unknown): void {
  if (READS.test(tool) || typeof args !== "object" || args === null) return;
  for (const key of ["path", "to", "key", "prefix"]) {
    const v = (args as Record<string, unknown>)[key];
    if (typeof v === "string" && reachesDocs(v)) throw new Error(`${DOCS_READ_ONLY}: ${DOCS_PREFIX} is written by rollout and read-only to you`);
    if (typeof v === "string" && reachesPlatformSkills(v)) throw new Error(`${SKILLS_READ_ONLY}: ${SKILLS_PLATFORM_PREFIX} is written by rollout and read-only to you`);
  }
}

/**
 * The model-callable form of a spec: the loop's tool, with malformed arguments refused first. Every
 * call but `send_to_user`'s goes through the gate: an action's call is decided and, when allowed,
 * queued as an effect whose `execute` runs later, from the outbox, after the barrier. Every result
 * passes the spill (M24.3): one over the threshold reaches the model as a stub with a `file_read`
 * pointer into the person's working tree. Before that, every result and every thrown reason has its
 * surrogate tokens scrubbed (M25.1), so none reaches the model, the transcript or the spilled file.
 */
export function toAgentTool(spec: ToolSpec, gate: Gate = NO_GATE, spill?: SpillSink): AgentTool<never> {
  const call: AgentTool<TSchema>["execute"] =
    spec.queues === "self"
      ? spec.execute
      : async (id, args, signal, onUpdate) => {
          refuseDocsWrite(spec.name, args);
          return gate.call(spec, id, args as Record<string, unknown>, async () => spec.execute(id, args, signal, onUpdate));
        };
  const scrubbed: AgentTool<TSchema>["execute"] = async (id, args, signal, onUpdate) => {
    try {
      return scrubValue(await call(id, args, signal, onUpdate));
    } catch (err) {
      throw new Error(scrubSurrogates(String(err instanceof Error ? err.message : err)));
    }
  };
  const execute: AgentTool<TSchema>["execute"] = async (id, args, signal, onUpdate) => spillResult(spec.name, id, await scrubbed(id, args, signal, onUpdate), spill);
  const tool: AgentTool<TSchema> = { name: spec.name, label: spec.label, description: spec.description, parameters: spec.parameters, execute };
  return refuseMalformed(tool as unknown as AgentTool<never>);
}

/**
 * One chat session's view of the registry: the live tool array the loop reads before every request
 * (pi diffs it into `toolsAdded`), and the loaded namespaces, persisted by the engine so they stay
 * loaded across turns.
 */
export class ToolSession {
  readonly registry: ToolRegistry;
  readonly loaded: Set<string>;
  /** The loop's tool array; `load` pushes into it, so a namespace loaded mid-turn is callable next step. */
  readonly tools: AgentTool<never>[] = [];
  private readonly gate: Gate | undefined;
  private readonly spill: SpillSink | undefined;

  /** `gate` decides every gated call and queues its effects; without one nothing gated runs. `spill` stores oversized results. */
  constructor(registry: ToolRegistry, loaded: Iterable<string>, gate?: Gate, spill?: SpillSink) {
    this.registry = registry;
    this.gate = gate;
    this.spill = spill;
    this.loaded = new Set([...loaded].filter((n) => registry.namespace(n)?.deferral !== undefined && registry.namespace(n)?.deferral !== "eager"));
    for (const ns of registry.active(this.loaded)) this.tools.push(...ns.tools.map((t) => toAgentTool(t, gate, spill)));
  }

  /** Loads deferred namespaces; unknown names are refused by code and nothing is half-loaded. */
  load(names: string[]): { ok: true; loaded: string[]; already: string[] } | { ok: false; code: "TOOL_NAMESPACE_UNKNOWN"; reason: string } {
    const unknown = names.filter((n) => !this.registry.namespace(n));
    if (unknown.length) return { ok: false, code: "TOOL_NAMESPACE_UNKNOWN", reason: `no namespace named ${unknown.join(", ")}` };
    const loaded: string[] = [];
    const already: string[] = [];
    for (const name of names) {
      const ns = this.registry.namespace(name) as Namespace;
      if (ns.deferral === "eager" || this.loaded.has(name)) {
        already.push(name);
        continue;
      }
      this.loaded.add(name);
      this.tools.push(...ns.tools.map((t) => toAgentTool(t, this.gate, this.spill)));
      loaded.push(name);
    }
    return { ok: true, loaded, already };
  }

  /**
   * Performs a queued action once, from the outbox, and only with the grant id the gate's commit
   * returned: an action without one is refused, so nothing automatic runs uncited.
   */
  async perform(id: string, tool: string, args: Record<string, unknown>, grantId: string | undefined): Promise<{ ok: boolean; code?: string; text?: string; reason?: string }> {
    const found = this.registry.spec(tool);
    // Actions, and observations whose subject made them a grant decision (a company resource).
    if (!found || (found.spec.kind !== "action" && found.spec.subject === undefined) || found.spec.queues === "self") return { ok: false, code: "ACTION_UNKNOWN" };
    if (!grantId) return { ok: false, code: "ACTION_UNGRANTED" };
    try {
      refuseDocsWrite(tool, args);
      const r = (await (found.spec.execute as (id: string, args: unknown) => Promise<AgentToolResult<unknown>>)(id, args)) as AgentToolResult<unknown> | undefined;
      const text = scrubSurrogates(r?.content?.map((c) => (c.type === "text" ? c.text : "")).join("") ?? "");
      return { ok: true, ...(text ? { text } : {}) };
    } catch (err) {
      // The thrown message is "CODE: reason"; the code is stable and the reason says what happened.
      const message = scrubSurrogates(String(err instanceof Error ? err.message : err));
      const code = message.split(": ")[0] || "ACTION_FAILED";
      const reason = message.slice(code.length + 2).trim();
      return { ok: false, code, ...(reason ? { reason: reason.slice(0, 500) } : {}) };
    }
  }
}

/** Specs from loop tools that already exist (the memory tools), with one classification for all. */
export function specsOf(tools: AgentTool<never>[], kind: ToolKind): ToolSpec[] {
  return tools.map((t) => ({ name: t.name, kind, label: t.label, description: t.description, parameters: t.parameters as TSchema, execute: t.execute as ToolSpec["execute"] }));
}
