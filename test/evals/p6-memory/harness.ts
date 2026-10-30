// The tier-1 harness of the P6 tasks (F27): `P6Tier1World` over P2's, the authority world with Sam's real `ChatEngine`
// chats, her real `Person` memory (`stores`: the daily lines, claims, chunk index and home tree over one in-memory R2)
// and the scripted fake model, plus what the contract's tasks name:
//   - the hourly upkeep as `objects/person.ts` runs it: the real `PersonLoops` over Sam's memory, its model calls
//     answered from the same script (`upkeep`, then the verify step), and the relationships loop (`relationships`);
//   - the render timer as `Person.flushMemory` runs it (`render`), the clock movable (`clock`, payload `ms`);
//   - the forget flow on Sam's `Person` (`forget_plan`, `forget_confirm` with `as`: `sam`, `pat`, or `agent`, the
//     principal the chat's own writes carry, `agent:<owner>`); the chat's memory seam (`personMemory`) has no forget
//     call at all, which `chatSeam()` reports;
//   - a people page through the Person's `upsertEntity` (`upsert_entity`);
//   - a sub-agent run as its facet runs it (`subagent`): `runSubAgent` over its own storage, offered the production
//     `subAgentReads` and, with `offer: "memory"`, the memory reads the M7.2 wiring gave it, so the gate's refusal is
//     what decides; `memoryCalls` counts every call that reached Sam's memory store.
// A `prompt` turn is Sam's send into the chat `chats[i]` names (`c1` when unset).

import type { Egress } from "../../../packages/agent/src/connectors/egress.ts";
import { PersonLoops, personSlot } from "../../../packages/agent/src/loops/personal.ts";
import { LoopSettings, PERSON_LOOPS } from "../../../packages/agent/src/loops/registry.ts";
import type { ForgetProducers } from "../../../packages/agent/src/memory/forget.ts";
import { citation, dailyPath, homeKey } from "../../../packages/agent/src/memory/home.ts";
import { personMemory } from "../../../packages/agent/src/memory/rpc.ts";
import type { MemoryService } from "../../../packages/agent/src/memory/service.ts";
import { type MemoryApi, memorySpecs } from "../../../packages/agent/src/memory/tools.ts";
import { subAgentReads } from "../../../packages/agent/src/subagents/namespaces.ts";
import { readTranscript, runSubAgent, SCHEMA as SUBAGENT_SCHEMA } from "../../../packages/agent/src/subagents/run.ts";
import type { Namespace } from "../../../packages/agent/src/tools/registry.ts";
import type { FakeStep } from "../../support/fake-model.ts";
import { FakeVectorize } from "../../support/fake-vectorize.ts";
import { ObjectHarness } from "../../support/object-harness.ts";
import type { Snapshot } from "../../support/scenario.ts";
import type { TaskHarness, Turn } from "../../support/task.ts";
import { authorityWorld, person, TENANT } from "../../workers/support/authority-world.ts";
import { P2Tier1World, sam } from "../p2-loop/harness.ts";
import type { ChatLabel, Chunk, Claim, Confirmed, Line, P6World, Plan, Searched, SubAgentRun } from "./world.ts";

export { sam };
export const pat = person("pat-solo");

type Msg = { role: string; content?: unknown };
const textOf = (m: Msg) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? ""));

export class P6Tier1World extends P2Tier1World implements P6World {
  readonly index: FakeVectorize;
  /** Each prompt's chat and the model requests its turn made, `[from, to)`. */
  readonly turnLog: Array<{ chat: ChatLabel; from: number; to: number }> = [];
  readonly confirmed: Confirmed[] = [];
  planned: Plan | null = null;
  readonly trail: Array<{ turn: string; paths: string[] }> = [];
  ran: SubAgentRun | null = null;
  producerTexts: { jobs: Array<{ id: string; text: string }>; skills: Array<{ name: string; text: string }> } = { jobs: [], skills: [] };
  private readonly loopState = new ObjectHarness("p6-loop-state", (ctx) => new LoopSettings((ctx as DurableObjectState).storage, PERSON_LOOPS), {});
  private loopsInstance: PersonLoops | null = null;

  constructor(w: ReturnType<typeof authorityWorld>, index: FakeVectorize) {
    super(w);
    this.index = index;
  }

  get svc(): MemoryService {
    return this.w.host(sam.email).memory;
  }
  /** The hourly loops as `objects/person.ts` builds them, over Sam's memory and the world's fake model. */
  get loops(): PersonLoops {
    this.loopsInstance ??= new PersonLoops({
      mem: this.svc.mem,
      state: this.loopState.instance,
      model: { ai: this.w.fake.binding as unknown as Ai, ledger: this.w.ledger(), tenant: TENANT, wait: async () => {} },
      skillNames: async () => [],
      proposeSkill: async () => ({ ok: false, code: "P6_NO_SKILLS", reason: "the P6 world proposes no skills" }),
      now: () => this.w.clock.now,
    });
    return this.loopsInstance;
  }

  private label(s: string): string {
    let out = s;
    for (const l of ["c1", "c2"] as ChatLabel[]) {
      try {
        out = out.replaceAll(this.harness(l).name, l);
      } catch {
        // A chat the task never opened has no id to replace.
      }
    }
    return out;
  }

  lines(): Line[] {
    return this.svc.mem
      .rows<{ date: string; line: number; text: string; source: string; writer: string }>("SELECT date, line, text, source, writer FROM daily_lines ORDER BY date, line")
      .map((r) => ({ citation: citation(dailyPath(r.date), r.line), text: r.text, source: this.label(r.source), writer: r.writer }));
  }
  claims(): Claim[] {
    return this.svc.mem
      .rows<{ id: string; kind: string; status: string; quote: string; source_path: string; source_line: number; supersedes: string | null }>("SELECT * FROM claims ORDER BY created_at, id")
      .map((r) => ({ id: r.id, kind: r.kind, status: r.status, quote: r.quote, citation: citation(r.source_path, r.source_line), supersedes: r.supersedes }));
  }
  chunks(): Chunk[] {
    return this.svc.mem.rows<{ path: string; line_start: number; text: string }>("SELECT path, line_start, text FROM chunks ORDER BY id").map((r) => ({ citation: citation(r.path, r.line_start), text: r.text }));
  }
  async file(path: string): Promise<string | null> {
    return (await this.svc.mem.home.read(path))?.text ?? null;
  }
  paths(): string[] {
    const prefix = homeKey(sam.email, "");
    return [...this.w.r2.objects.keys()].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));
  }
  async search(queries: string[]): Promise<Searched> {
    const r = await this.svc.memorySearch({ queries, maxResults: 25 }, sam.email);
    if (!r.ok) throw new Error(`P6_SEARCH_REFUSED: ${r.code}`);
    return {
      hits: r.hits.map((h) => ({ citation: h.citation, text: h.text, marker: h.marker ?? null, claims: h.claims.map((c) => ({ id: c.id, status: c.status })), match: h.match ?? null })),
      degraded: r.semantic?.code ?? null,
    };
  }
  async get(path: string, from?: number, limit?: number) {
    const r = await this.svc.memoryGet({ path, ...(from ? { from } : {}), ...(limit ? { limit } : {}) }, sam.email);
    return r.ok ? { ok: true as const, lines: r.lines } : { ok: false as const, code: r.code };
  }
  async explain(claimId: string) {
    const r = await this.svc.memoryExplain({ claimId }, sam.email);
    return r.ok ? { ok: true as const, supersedes: r.supersedes, supersededBy: r.supersededBy, sourceText: r.sourceText } : { ok: false as const, code: r.code };
  }
  sentIn(chat: ChatLabel): string[] {
    return this.turnLog.filter((t) => t.chat === chat).flatMap((t) => this.w.fake.requests.slice(t.from, t.to).flatMap((r) => (r.inputs.messages as Msg[]).map(textOf)));
  }
  context(chat: ChatLabel): string {
    const last = this.turnLog.filter((t) => t.chat === chat).at(-1);
    const req = last ? this.w.fake.requests[last.from] : undefined;
    // The turn's first request: the stable prefix and every system message the turn added (a standing file's diff).
    return req ? (req.inputs.messages as Msg[]).filter((m) => m.role === "system").map(textOf).join("\n") : "";
  }
  /** Sam's message to `label` run to its end, as a seed: before the snapshot, so it is not the task's change. */
  async say(text: string, label: ChatLabel = "c1"): Promise<void> {
    try {
      this.harness(label);
    } catch {
      await this.open(label);
    }
    await this.chat(label).send({ person: sam.email, text });
    await this.chat(label).settled();
  }
  writes() {
    return (["c1", "c2"] as ChatLabel[])
      .flatMap((l) => {
        try {
          return this.rows(l);
        } catch {
          return [];
        }
      })
      .filter((r) => r.role === "toolResult" && r.tool === "memory_write")
      .map((r) => ({ ok: !r.isError, code: /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/.exec(r.text)?.[0] ?? null, text: r.text }));
  }
  plan(): Plan | null {
    return this.planned;
  }
  confirms(): Confirmed[] {
    return [...this.confirmed];
  }
  producers() {
    return { jobs: this.producerTexts.jobs.map((j) => ({ ...j })), skills: this.producerTexts.skills.map((s) => ({ ...s })) };
  }
  subagent(): SubAgentRun | null {
    return this.ran;
  }
  renders(): string[] {
    const prefix = homeKey(sam.email, "memory/");
    return this.w.r2.puts.filter((k) => k.startsWith(prefix) && /\/\d{4}-\d{2}-\d{2}\.md$/.test(k)).map((k) => k.slice(homeKey(sam.email, "").length));
  }
  after() {
    return this.trail.map((t) => ({ turn: t.turn, paths: [...t.paths] }));
  }
  /** How many of the plan's claims still exist. */
  remaining(): number {
    const plan = this.planned;
    const ids = new Set(this.claims().map((c) => c.id));
    return plan?.ok ? plan.claims.filter((c) => ids.has(c.id)).length : 0;
  }
  /** The calls the chat's memory seam offers, as `objects/chat.ts` wires it (`personMemory`). */
  chatSeam(): string[] {
    return Object.keys(personMemory({} as Env, sam.email)).sort();
  }

  private readonly seen = new Set<string>();
  /**
   * P2's rows and keys, and Sam's memory: each daily line, claim (with its status), chunk and forget plan (with its
   * status). Memory rows are kept as seen, and one that is gone since is `gone:<key>`, so a forget or a supersession is
   * a declared addition and never an undeclared removal.
   */
  override snapshot(): Snapshot {
    const s = super.snapshot();
    const now = [
      ...this.lines().map((l) => `line:${l.citation}`),
      ...this.claims().map((c) => `claim:${c.citation}:${c.status}`),
      ...this.chunks().map((c) => `chunk:${c.citation}`),
      ...this.svc.mem.rows<{ status: string }>("SELECT status FROM forget_plans ORDER BY created_at").map((p) => `forget:${p.status}`),
    ];
    for (const k of now) this.seen.add(k);
    const present = new Set(now);
    for (const k of this.seen) s.journal.push(present.has(k) ? k : `gone:${k}`, ...(present.has(k) ? [] : [k]));
    return s;
  }

  async runSubAgent(brief: string, offer: string | undefined): Promise<void> {
    let memoryCalls = 0;
    const api = this.svc;
    const count = <T>(r: T): T => {
      memoryCalls++;
      return r;
    };
    const counted: MemoryApi = {
      memorySearch: (...a) => count(api.memorySearch(...a)),
      memoryGet: (...a) => count(api.memoryGet(...a)),
      memoryExplain: (...a) => count(api.memoryExplain(...a)),
      memoryWrite: (...a) => count(api.memoryWrite(...a)),
      standingFiles: () => count(api.standingFiles()),
    };
    // As `objects/subagent.ts` wires it, with an egress no call reaches (the scripts call no Hacker News read).
    const production = subAgentReads({ egress: {} as Egress });
    const extra: Namespace[] =
      offer === "memory"
        ? [{ name: "memory", description: "the person's memory, read only", deferral: "eager", tools: memorySpecs({ api: counted, requester: sam.email, setting: { scope: "personal" }, source: "subagent:p6" }).filter((t) => t.name !== "memory_write") }]
        : [];
    const facet = new ObjectHarness(`p6-subagent-${this.turnLog.length}`, (ctx) => ({ storage: (ctx as DurableObjectState).storage }), {});
    const storage = facet.instance.storage;
    storage.sql.exec(SUBAGENT_SCHEMA);
    const r = await runSubAgent(
      storage,
      { ai: this.w.fake.binding as unknown as Ai, ledger: this.w.ledger(), tenant: TENANT, namespaces: () => [...production, ...extra], now: () => this.w.clock.now, wait: async () => {} },
      { id: "p6-subagent", role: "worker", depth: 1, person: sam.email, brief },
    );
    const results = readTranscript(storage)
      .filter((m) => m.role === "toolResult")
      .map((m) => {
        const t = m as { toolName: string; content: Array<{ type: string; text?: string }>; details?: { code?: string } };
        return { tool: t.toolName, text: t.content.map((c) => c.text ?? "").join(""), code: t.details?.code ?? null };
      });
    this.ran = { offered: production.flatMap((n) => n.tools.map((t) => t.name)), results, memoryCalls, handoff: r.status === "done" ? r.text : `${r.code}: ${r.detail}` };
  }
}

export interface P6HarnessOptions {
  script: FakeStep[];
  /** The chat each prompt goes to, by prompt order; `c1` when unset. */
  chats?: ChatLabel[];
  /** The semantic leg's index fails every call: the keyword leg answers alone (T-P6-02). */
  vectorDown?: boolean;
  /** The jobs and skills the forget plan reads (M25.4 producers). */
  producers?: { jobs: Array<{ id: string; text: string }>; skills: Array<{ name: string; text: string }> };
  /** Seeds the records the task names, after `c1` is open and the standing files are written, before the snapshot. */
  seed?: (world: P6Tier1World) => Promise<void>;
}

export async function playP6(world: P6Tier1World, turn: Turn, o: P6HarnessOptions, prompt: number): Promise<void> {
  const w = world.w;
  if (turn.kind === "prompt") {
    if (turn.by !== sam.email) throw new Error(`P6_TURN_BY_UNKNOWN: ${turn.by}`);
    const label = o.chats?.[prompt] ?? "c1";
    try {
      world.harness(label);
    } catch {
      await world.open(label);
    }
    const from = w.fake.requests.length;
    await world.chat(label).send({ person: sam.email, text: turn.text });
    await world.chat(label).settled();
    world.turnLog.push({ chat: label, from, to: w.fake.requests.length });
    return;
  }
  if (turn.kind !== "event") throw new Error(`P6_TURN_UNSUPPORTED: ${turn.kind}`);
  const p = turn.payload ?? {};
  const svc = world.svc;
  switch (turn.name) {
    case "clock":
      w.clock.now += Number(p.ms ?? 0);
      return;
    case "render":
      // As `Person.flushMemory` runs on its timer: buffered days to R2, queued chunks to the index.
      await svc.renderPending();
      await svc.syncVectors();
      return;
    case "upkeep": {
      const r = await world.loops.upkeep(personSlot("memory-upkeep", w.clock.now));
      if (r.signal === "failed") throw new Error(`P6_UPKEEP_FAILED: ${r.code}`);
      return;
    }
    case "relationships":
      await world.loops.relationships(personSlot("relationships", w.clock.now));
      return;
    case "forget_plan": {
      const ids = world.claims().filter((c) => c.status === "active" && c.quote.includes(p.claim ?? "\u0000")).map((c) => c.id);
      const texts = o.producers ?? { jobs: [], skills: [] };
      world.producerTexts = { jobs: texts.jobs.map((j) => ({ ...j })), skills: texts.skills.map((s) => ({ ...s })) };
      const producers: ForgetProducers = { jobs: async () => world.producerTexts.jobs, skills: async () => world.producerTexts.skills };
      const r = await svc.forgetPlan({ claimIds: ids }, sam.email, producers);
      world.planned = r.ok
        ? { ok: true, planId: r.planId, claims: r.claims.map((c) => ({ id: c.id, citation: c.citation })), lines: r.lines, rederives: r.rederives.map((x) => ({ kind: x.kind, id: x.id })), unchecked: r.unchecked.map((u) => u.source), remaining: 0 }
        : { ok: false, code: r.code };
      if (world.planned.ok) world.planned.remaining = world.remaining();
      return;
    }
    case "forget_confirm": {
      const plan = world.planned;
      if (!plan?.ok) throw new Error("P6_NO_PLAN: forget_confirm before a plan");
      const as = (p.as ?? "sam") as Confirmed["as"];
      const requester = as === "sam" ? sam.email : as === "pat" ? pat.email : `agent:${sam.email}`;
      const r = await svc.forgetConfirm(plan.planId, requester);
      world.confirmed.push(r.ok ? { as, ok: true, code: null, claims: r.claims, chunks: r.chunks, remaining: world.remaining() } : { as, ok: false, code: r.code, remaining: world.remaining() });
      return;
    }
    case "upsert_entity": {
      const r = await svc.upsertEntity({ kind: "people", displayName: p.name ?? "", summary: p.summary ?? "", rank: Number(p.rank ?? 1) }, `agent:${sam.email}`);
      if (!r.ok) throw new Error(`P6_ENTITY_REFUSED: ${r.code}`);
      return;
    }
    case "subagent":
      await world.runSubAgent(p.brief ?? "", p.offer);
      return;
    default:
      throw new Error(`P6_TURN_UNSUPPORTED: ${turn.name}`);
  }
}

export function p6Harness(o: P6HarnessOptions): TaskHarness<P6Tier1World> {
  let prompts = 0;
  return {
    setup: async () => {
      prompts = 0;
      const index = new FakeVectorize();
      const world = new P6Tier1World(authorityWorld({ script: o.script, stores: true, index }), index);
      await world.open("c1");
      // Sam's standing files are written on their first read, as a first turn would: here, before the snapshot.
      await world.svc.standingFiles();
      await o.seed?.(world);
      if (o.vectorDown) index.fail = "VECTORIZE_UNAVAILABLE: the index did not answer";
      return world;
    },
    play: async (world, turn) => {
      const i = turn.kind === "prompt" ? prompts++ : prompts;
      await playP6(world, turn, o, i);
      world.trail.push({ turn: turn.kind === "prompt" ? `prompt:${o.chats?.[i] ?? "c1"}` : `${turn.kind}:${"name" in turn ? turn.name : ""}`, paths: world.paths() });
    },
  };
}

/** A scripted `memory_write` of a daily line. */
export const writeDaily = (id: string, text: string): FakeStep => ({ toolCall: { id, name: "memory_write", arguments: { target: "daily", text } } });
/** A scripted `memory_search` with two phrasings. */
export const searchFor = (id: string, a: string, b: string): FakeStep => ({ toolCall: { id, name: "memory_search", arguments: { queries: [a, b] } } });
/** A scripted `memory_get` of one line. */
export const getLine = (id: string, path: string, line: number): FakeStep => ({ toolCall: { id, name: "memory_get", arguments: { path, from: line, limit: 1 } } });
type Req = Parameters<Extract<FakeStep, { fromRequest: unknown }>["fromRequest"]>[0];
/** Every message of a model request as one text. */
export const requestText = (r: Req): string => (r.inputs.messages as Msg[]).map(textOf).join("\n");
/** The tool results a chat request carries, newest last. */
export const toolResults = (r: Req): string[] => (r.inputs.messages as Msg[]).filter((m) => m.role === "tool").map(textOf);
/** A reply made from the request: `make` reads what the tools returned. */
export const replyFrom = (make: (results: string[]) => string): FakeStep => ({ fromRequest: (r) => ({ text: make(toolResults(r)) }) });
/** A tool call made from the request (a `memory_get` of the line a search cited). */
export const callFrom = (make: (results: string[]) => { id: string; name: string; arguments: Record<string, unknown> }): FakeStep => ({ fromRequest: (r) => ({ toolCall: make(toolResults(r)) }) });
/** The first `memory/<date>.md#L<n>` in `s` whose text line holds `needle` (a search result's heading and its text). */
export function citeOf(s: string, needle?: string): string {
  const lines = s.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /(memory\/\d{4}-\d{2}-\d{2}\.md#L\d+)/.exec(lines[i] ?? "");
    if (m && (!needle || (lines[i] ?? "").includes(needle) || (lines[i + 1] ?? "").includes(needle))) return m[1] as string;
  }
  return "";
}

/**
 * The hourly upkeep's two model calls answered from what they are shown: one claim per new line (`kind`), superseding
 * the active claim whose quote `supersede` picks, then the verify step applying each by the citation it cites (M25.4).
 */
export function upkeepSteps(o: { kind?: string; supersede?: (line: string, active: Array<{ id: string; quote: string }>) => string | undefined } = {}): FakeStep[] {
  let cites: string[] = [];
  return [
    {
      fromRequest: (r) => {
        const text = requestText(r);
        const fresh = [...text.matchAll(/^(memory\/\d{4}-\d{2}-\d{2}\.md#L\d+) (.+)$/gm)].map((m) => ({ cite: m[1] as string, text: m[2] as string }));
        const active = [...text.matchAll(/^(c_[0-9a-f]{12}) \[\w+\] \S+ (.+)$/gm)].map((m) => ({ id: m[1] as string, quote: m[2] as string }));
        cites = fresh.map((l) => l.cite);
        const claims = fresh.map((l) => {
          const sup = o.supersede?.(l.text, active);
          return { kind: o.kind ?? "preference", text: l.text, cite: l.cite, ...(sup ? { supersedes: sup } : {}) };
        });
        return { text: JSON.stringify({ claims }), usage: { prompt: 400, completion: 100 } };
      },
    },
    { fromRequest: () => ({ text: JSON.stringify({ verdicts: cites.map((handle, n) => ({ n: n + 1, verdict: "apply", handle })) }), usage: { prompt: 400, completion: 100 } }) },
  ];
}
