// The tier-1 harness of the P14 tasks (F40): P9's world (`P9Tier1World`: Sam's real `ChatEngine` chats `c1` and `c2`,
// both members, the real jobs, sub-agents, verifier, Vault, Ledger and routes, Sam's real `Person` memory and the one
// scripted fake model) composed with what the identity tasks name (delta 6):
//   - the page as served (`GET /chats/<c1>` as Sam, the m27 panel and shell markup) and the panel script under the
//     page harness for the handle line it fills from `/me`;
//   - Sam's real mail store (`PersonMail`) over a `MailOutService` fake that records what the host is handed;
//   - two lifecycle worlds over the real `Company`, `Ledger` and `PersonMemory`: a standalone deploy with Sam its one
//     owner, and a company with Sam its owner and Pat a member, each offboarded through `finishOffboarding`;
//   - the production tool registry as a full chat's tool reference lists it, with the onboarding namespace's, its
//     guard (`identityReach`), and two planted specs registered in a `ToolRegistry`;
//   - the sources under `packages/agent/src`, read for `writeStanding`'s callers and for any reach into sign-in.
// Turns, beside P9's, P3's and P5's (`reload` evicts the chat object, as P3's does):
//   - `look` (payload `width`): the page as served and the panel's handle, read and kept in `drawn`;
//   - `profile`: `GET /app/profile` as Sam;
//   - `request` (payload `text`): Pat's colleague request to Sam's agent, run to its end in its own chat;
//   - `mail` (payload `subject`): Sam's agent mails Pat Sam's newest reply in `c1` through `person/mail.ts`;
//   - `offboard` (payload `who`, `deploy`): the person starts and finishes offboarding with `export`;
//   - `shell`: the page's title, the manifest's names and the handle line.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { onboardingNamespace } from "../../../packages/agent/src/company/onboarding-tools.ts";
import { SCHEMA as FILES_SCHEMA } from "../../../packages/agent/src/files/store.ts";
import { finishOffboarding, startOffboarding } from "../../../packages/agent/src/lifecycle/offboarding.ts";
import { defaultStanding, STANDING_FILES } from "../../../packages/agent/src/memory/home.ts";
import { PersonMail } from "../../../packages/agent/src/person/mail.ts";
import { SCHEMA as PROFILE_SCHEMA } from "../../../packages/agent/src/person/profile.ts";
import { identityReach, ToolRegistry, type ToolSpec } from "../../../packages/agent/src/tools/registry.ts";
import type { FakeStep } from "../../support/fake-model.ts";
import { ObjectHarness } from "../../support/object-harness.ts";
import type { ScenarioWorld } from "../../support/scenario.ts";
import { Seeded } from "../../support/seeded.ts";
import type { DefinedTask, TaskHarness, Turn } from "../../support/task.ts";
import { repoRoot } from "../../support/temp-repo.ts";
import { lifecycleWorld } from "../../workers/support/lifecycle-world.ts";
import { CHILD_MARK, JOB_TASK_MARK, VERIFIER_MARK } from "../p5-activity/harness.ts";
import { P9Tier1World, pat, sam } from "../p9-connectors/harness.ts";
import type { ChatLabel, Drawn, MailCall, Offboarded, P14World, Planted, Sent, Standing, ToolLine } from "./world.ts";

export { pat, sam };

const SRC = join(repoRoot, "packages/agent/src");
const REQUEST_MARK = "Surface: a colleague's request";
const settleUi = async () => {
  for (let i = 0; i < 60; i++) await new Promise((r) => setImmediate(r));
};
type Msg = { role: string; content?: unknown };
const textOf = (content: unknown): string => (typeof content === "string" ? content : Array.isArray(content) ? content.map((c) => (c as { text?: string }).text ?? "").join("") : "");
const asText = (v: unknown) => (v instanceof Uint8Array ? new TextDecoder().decode(v) : v);
const tablesOf = (h: { rows: (q: string) => Record<string, unknown>[] }) => h.rows("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").map((t) => String(t.name));
const strip = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
/** The columns a `CREATE TABLE` statement for `table` declares. */
const columnsOf = (schema: string, table: string): string[] => {
  const m = new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\)\\s*(?:;|$)`).exec(schema);
  return (m?.[1] ?? "").split(",").map((c) => c.trim().split(/\s+/)[0] ?? "").filter((c) => c && !/^(PRIMARY|UNIQUE|FOREIGN|CHECK)$/i.test(c));
};
/** Every `.ts` file under `packages/agent/src`, with its path relative to it. */
const sources = (): Array<{ file: string; text: string }> => {
  const out: Array<{ file: string; text: string }> = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".ts")) out.push({ file: relative(SRC, p), text: readFileSync(p, "utf8") });
    }
  };
  walk(SRC);
  return out;
};

/** The calls of `writeStanding` in `files` (its definition aside), with the writer each passes. */
export const standingCallersIn = (files: Array<{ file: string; text: string }>) =>
  files.flatMap((f) => [...f.text.matchAll(/(?<!async )\bwriteStanding\(([^;]*?)\)/g)].map((m) => ({ file: f.file, writer: /"([^"]+)"\s*$/.exec(m[1] ?? "")?.[1] ?? "" })));
/** The files in `files` that call `loginCall` or a `passkey*` or `recovery*` operation. */
export const loginReachIn = (files: Array<{ file: string; text: string }>) => [...new Set(files.filter((f) => /\bloginCall\s*[<(]|\.\s*(passkey|recovery)\w*\s*\(/i.test(f.text)).map((f) => f.file))].sort();

/** A planted tool, as a test registering one would write it. */
export const plantedSpec = (name: string, description = "Fixture: planted."): ToolSpec => ({ name, kind: "action", label: name, description, parameters: Type.Object({}), actionKind: "test.planted", execute: async () => ({ content: [{ type: "text", text: "ran" }], details: {} }) });
/** What a `ToolRegistry` answers when `spec` is registered: null, or the refusal's message. */
export const registered = (spec: ToolSpec): string | null => {
  try {
    new ToolRegistry([{ name: "planted", description: "planted tools", deferral: "eager", tools: [spec] }]);
    return null;
  } catch (e) {
    return String((e as Error).message);
  }
};

export interface P14HarnessOptions {
  script: FakeStep[];
  /** Runs before the snapshot, after `c1` and `c2` are open: the task's setup records. */
  seed?: (w: P14Tier1World) => Promise<void>;
  /** The model's answers for the two lifecycle worlds' handover drafts. */
  drafts?: FakeStep[];
  /** Replaces the lifecycle Company's `mayDepart` (`planted.test.ts`: the check taken out of the production path). */
  mayDepart?: (person: string) => Promise<{ ok: true } | { ok: false; code: string; reason: string }>;
  /** Builds the world: a subclass for the tasks that read a slot's or the Security pane's world (`harness-slot.ts`). */
  make?: (o: P14HarnessOptions) => P14Tier1World;
}

type Lifecycle = ReturnType<typeof lifecycleWorld>;

export class P14Tier1World extends P9Tier1World implements P14World {
  readonly seeded = defaultStanding(sam.email) as Record<string, string>;
  readonly drawn: Drawn[] = [];
  profile: P14World["profile"] = null;
  shell: P14World["shell"] = null;
  readonly offboarded: Offboarded[] = [];
  readonly profileColumns = columnsOf(PROFILE_SCHEMA, "profile");
  readonly fileColumns = columnsOf(FILES_SCHEMA, "files");
  private readonly src = sources();
  readonly standingCallers = standingCallersIn(this.src);
  readonly loginReach = loginReachIn(this.src);
  private readonly mailed: MailCall[] = [];
  private readonly mailBox: ObjectHarness<PersonMail>;
  private readonly lives = new Map<string, Lifecycle>();
  private readonly o: P14HarnessOptions;

  constructor(o: P14HarnessOptions) {
    super({ script: o.script });
    this.o = o;
    this.mailBox = new ObjectHarness(`mail-p14-${sam.id}`, (ctx) =>
      new PersonMail((ctx as DurableObjectState).storage, {
        person: sam.email,
        name: sam.name,
        now: () => this.w.clock.now,
        openChat: async () => ({ ok: true, chatId: this.chatId("c1") }),
        ownsChat: (c) => c === this.chatId("c1"),
        notify: async (chat, n) => this.w.chats.harness(chat).instance.notify(n),
        mailOut: {
          send: async (m) => {
            this.mailed.push({ fields: Object.keys(m).sort(), person: m.person, to: m.to, text: m.text });
            return { ok: true, messageId: `p14-${this.mailed.length}` };
          },
        },
        holdCode: async () => ({ ok: false, code: "P14_NO_CODE", reason: "no code is held in P14's world" }),
      }), {});
  }

  private get svc() {
    return this.w.host(sam.email).memory;
  }

  async play(turn: Turn): Promise<void> {
    if (turn.kind !== "event") return super.play(turn);
    const p = (turn.payload ?? {}) as Record<string, string>;
    if (turn.name === "look") await this.look((p.width as Drawn["width"]) ?? "desktop");
    else if (turn.name === "profile") {
      const r = await this.w.http(sam.email, "GET", "/app/profile");
      this.profile = { status: r.status, body: r.body };
    } else if (turn.name === "request") {
      this.w.clock.now += 60_000;
      await this.w.request({ from: pat.email, to: sam.email, text: p.text ?? "", origin: pat.email, hops: 0, viaAgent: false });
      for (const id of this.w.chatsOf(sam.email)) await this.w.chats.harness(id).instance.settled();
    } else if (turn.name === "mail") {
      const text = this.replies("c1").at(-1) ?? "";
      const r = await this.mailBox.instance.send(sam.email, { to: pat.email, subject: p.subject ?? "p14 probe", text, chatId: this.chatId("c1") });
      if (!r.ok) throw new Error(`P14_MAIL_REFUSED: ${r.code}`);
    } else if (turn.name === "offboard") await this.offboard(p.who as "sam" | "pat", p.deploy as "standalone" | "company");
    else if (turn.name === "shell") {
      const html = String((await this.w.http(sam.email, "GET", `/chats/${this.chatId("c1")}`)).body.html ?? "");
      const manifest = (await this.w.http(sam.email, "GET", "/manifest.webmanifest")).body as { name?: string; short_name?: string };
      this.shell = { title: /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? "", manifest: [manifest.name ?? "", manifest.short_name ?? ""], handle: await this.handle() };
    } else return super.play(turn);
  }

  /** The handle line the panel script fills from `/me`. */
  private async handle(): Promise<string> {
    const p = await this.page();
    await settleUi();
    return p.byId("handle").textContent;
  }

  /** The page as served to Sam, its static identity words read from the markup, and the handle from the script. */
  private async look(width: Drawn["width"]): Promise<void> {
    const html = String((await this.w.http(sam.email, "GET", `/chats/${this.chatId("c1")}`)).body.html ?? "");
    const identity = html.slice(html.indexOf('id="panel-identity"'), html.indexOf('id="job-dialog"'));
    const card = /<div class="qf-idname"><h3>([^<]*)<\/h3>([\s\S]*?)<\/div>/.exec(identity);
    const controls = [...identity.matchAll(/<(button|a|input|textarea|select)\b([^>]*)>([\s\S]*?)(?:<\/\1>|$)/g)]
      .map((m) => ({ id: /\bid="([^"]*)"/.exec(m[2] ?? "")?.[1] ?? m[1], words: strip(m[3] ?? "") }))
      .filter((c) => !/^tile-(soul|memory)$/.test(c.id))
      .map((c) => `${c.id}: ${c.words}`);
    this.drawn.push({
      width,
      header: strip(/<button id="open-agent"[^>]*>[\s\S]*?<span class="nm">([^<]*)<\/span>/.exec(html)?.[1] ?? ""),
      panelName: strip(/<div class="panel-hero panel-name">([^<]*)<\/div>/.exec(html)?.[1] ?? ""),
      cardName: strip(card?.[1] ?? ""),
      cardNote: strip(card?.[2] ?? ""),
      controls,
      handle: await this.handle(),
    });
  }

  private life(deploy: "standalone" | "company"): Lifecycle {
    let l = this.lives.get(deploy);
    if (!l) {
      l = lifecycleWorld({ script: this.o.drafts ?? [{ text: '{"items":[]}' }, { text: '{"items":[]}' }], seed: deploy === "standalone" ? [sam] : [sam, pat], roles: { [sam.email]: "owner" }, shape: deploy });
      if (this.o.mayDepart) {
        const plant = this.o.mayDepart;
        const company = l.company();
        company.mayDepart = plant as typeof company.mayDepart;
      }
      this.lives.set(deploy, l);
    }
    return l;
  }

  /** Seeds `who`'s scope on `deploy`: two memory lines, a file and a journal row. */
  async seedLife(who: "sam" | "pat", deploy: "standalone" | "company"): Promise<void> {
    const l = this.life(deploy);
    const email = who === "sam" ? sam.email : pat.email;
    await l.write(email, `${who === "sam" ? "Sam Solo" : "Pat Solo"} keeps the p14 probe notes in plain text`);
    await l.write(email, `${who === "sam" ? "Sam Solo" : "Pat Solo"} meets the team on Thursdays`);
    const f = await l.host(email).files.write({ path: "p14-probe.md", text: "# p14 probe\n\nA file to be counted.\n" }, { requester: email, writer: `agent:${email}` });
    if (!f.ok) throw new Error(`P14_SEED_FILE: ${f.code}`);
    const row = { id: `p14:${who}`, at: l.clock.now, actor: `agent:${email}`, principal: email, actionKind: "mail.send", subjectRef: "personal;connector:mail", counterpart: "own-agent", origin: email, hops: 0, decision: "auto" as const, grantId: null, outcome: "DONE", runId: `p14-${who}`, tokens: 1 };
    const j = await l.ledger().journal(row);
    if (!j.ok) throw new Error(`P14_SEED_JOURNAL: ${j.code}`);
  }

  private counts(l: Lifecycle, email: string): Record<string, number> {
    const out: Record<string, number> = {};
    const h = l.personHarness(email);
    if (h) for (const t of ["daily_lines", "claims", "chunks", "files"]) out[`person/${t}`] = tablesOf(h).includes(t) ? Number(h.rows(`SELECT COUNT(*) AS n FROM "${t}"`)[0]?.n ?? 0) : 0;
    out["r2/home"] = [...l.r2.objects.keys()].filter((k) => k.includes(email)).length;
    const ledger = l.ledgerHarness();
    for (const t of tablesOf(ledger)) out[`ledger/${t}`] = Number(ledger.rows(`SELECT COUNT(*) AS n FROM "${t}"`)[0]?.n ?? 0);
    return out;
  }

  private async offboard(who: "sam" | "pat", deploy: "standalone" | "company"): Promise<void> {
    const l = this.life(deploy);
    const email = who === "sam" ? sam.email : pat.email;
    const deps = l.offboarding(email);
    const started = await startOffboarding(deps, l.person(email));
    if (!started.ok) throw new Error(`P14_OFFBOARD_START: ${started.code}`);
    // Counted after the start (whose handover draft is one model call) and before the finish this task grades.
    const before = this.counts(l, email);
    const r = await finishOffboarding(deps, l.person(email), "export");
    this.offboarded.push({
      who,
      deploy,
      ok: r.ok,
      code: r.ok ? null : r.code,
      reason: r.ok ? "" : r.reason,
      bundle: r.ok && r.choice === "export" && r.markdown.length > 0,
      departed: (await l.company().lookup(email)) === null,
      before,
      after: this.counts(l, email),
    });
  }

  async standing(): Promise<Standing[]> {
    const out: Standing[] = [];
    for (const name of STANDING_FILES.filter((n) => n !== "MEMORY.md")) {
      const f = await this.svc.mem.home.read(name);
      out.push({ name, text: f?.text ?? "", writer: f?.writer ?? "" });
    }
    return out;
  }

  async remembered(): Promise<string[]> {
    const daily = this.svc.mem.rows<{ text: string }>("SELECT text FROM daily_lines ORDER BY date, line").map((r) => r.text);
    const seed = new Set((this.seeded["MEMORY.md"] ?? "").split("\n"));
    const curated = ((await this.svc.mem.home.read("MEMORY.md"))?.text ?? "").split("\n").filter((l) => l.trim() && !l.startsWith("#") && !seed.has(l));
    return [...daily, ...curated];
  }

  async memoryWriter(): Promise<string> {
    return (await this.svc.mem.home.read("MEMORY.md"))?.writer ?? "";
  }

  async holding(needle: string): Promise<string[]> {
    const all = [...this.w.objects(), ["vault", this.vaultH], ["mail", this.mailH], ["delivery", this.deliveryH], ["p14-mail", this.mailBox]] as Array<[string, { rows: (q: string) => Record<string, unknown>[] }]>;
    const out: string[] = [];
    for (const [name, h] of all) {
      for (const t of tablesOf(h)) if (h.rows(`SELECT * FROM "${t}"`).some((r) => JSON.stringify(Object.values(r).map(asText)).includes(needle))) out.push(`${this.label(name)}/${t}`);
    }
    for (const k of this.w.r2.objects.keys()) if (((await (await this.w.r2.get(k))?.text()) ?? "").includes(needle)) out.push(`r2:${k.replace(/^.*?\/home\//, "home/")}`);
    return out.sort();
  }

  asked(): Sent[] {
    return this.w.fake.requests.map((r) => {
      const text = ((r.inputs as { messages?: Msg[] }).messages ?? []).map((m) => textOf(m.content)).join("\n");
      const surface: Sent["surface"] = text.includes(JOB_TASK_MARK) ? "job" : text.includes(VERIFIER_MARK) ? "verifier" : text.includes(CHILD_MARK) ? "subagent" : text.includes(REQUEST_MARK) ? "request" : "chat";
      return { surface, text };
    });
  }

  prefix(): string {
    const chat = this.w.fake.requests.filter((r) => this.asked()[this.w.fake.requests.indexOf(r)]?.surface === "chat");
    const last = chat.at(-1);
    return last ? ((last.inputs as { messages?: Msg[] }).messages ?? []).filter((m) => m.role === "system").map((m) => textOf(m.content)).join("\n") : "";
  }

  async modelIds(): Promise<string[]> {
    return [...new Set((await this.w.ledger().modelCalls({ person: sam.email })).map((r) => r.model))];
  }

  async readAs(as: "sam" | "pat") {
    const r = await this.svc.memoryGet({ path: "MEMORY.md", limit: 200 }, as === "sam" ? sam.email : pat.email);
    return r.ok ? { ok: true as const, lines: r.lines.map((l) => l.text) } : { ok: false as const, code: r.code };
  }

  tools(): ToolLine[] {
    const first = this.w.fake.requests.find((_, i) => this.asked()[i]?.surface === "chat");
    const system = ((first?.inputs as { messages?: Msg[] } | undefined)?.messages ?? []).filter((m) => m.role === "system").map((m) => textOf(m.content)).join("\n");
    // The authority world's fixture connectors (each described "Fixture: …") are the test's, not production's.
    const listed = [...system.matchAll(/^- ([a-z][a-z0-9_]+) \([^)]*\): (.*)$/gm)].map((m) => ({ name: m[1] as string, description: m[2] as string })).filter((t) => !t.description.startsWith("Fixture:"));
    const onboarding = onboardingNamespace({} as never, () => sam.email).tools.map((t) => ({ name: t.name, description: t.description }));
    return [...listed, ...onboarding];
  }

  guard(t: ToolLine): string | null {
    return identityReach(t);
  }

  planted(): Planted[] {
    return ["settings_set", "passkey_remove"].map((name) => ({ name, refused: registered(plantedSpec(name)) }));
  }

  handed(): MailCall[] {
    return this.mailed.map((m) => ({ ...m, fields: [...m.fields] }));
  }

  /** The chat label of an object's name, as P5's tables name it. */
  protected override label(chatId: string): string {
    return super.label(chatId);
  }
}

export function p14Harness(o: P14HarnessOptions): TaskHarness<P14World> {
  return {
    setup: async () => {
      const w = o.make ? o.make(o) : new P14Tier1World(o);
      await w.open();
      // Sam's standing files are written on their first read, as a first turn would: here, before the count.
      await w.w.host(sam.email).memory.standingFiles();
      await o.seed?.(w);
      await w.activity();
      w.before = w.tables();
      return w;
    },
    play: async (world, turn) => (world as P14Tier1World).play(turn),
  };
}

/** The task's turns played through `p14Harness(o)`, and the world after them. */
export async function played(task: DefinedTask<P14World>, o: P14HarnessOptions, turns = task.turns): Promise<P14Tier1World> {
  const h = p14Harness(o);
  const rng = new Seeded(task.setup.seed);
  const world = (await h.setup(rng, task)) as P14Tier1World;
  for (const t of turns) await h.play(world, t, rng);
  return world;
}

/** Each grader's verdict on the task's turns: true where an end state or fact holds and where a minefield was not stepped on. */
export async function graded<W extends ScenarioWorld = P14World>(task: DefinedTask<W>, o: P14HarnessOptions): Promise<Record<string, boolean>> {
  // A slot's or the Security pane's task is played on the subclass its run's `make` builds.
  const world = (await played(task as unknown as DefinedTask<P14World>, o)) as unknown as W;
  const out: Record<string, boolean> = {};
  for (const g of task.graders) out[g.name] = g.kind === "minefield" ? !(await g.check(world)) : await g.check(world);
  return out;
}

export type { ChatLabel };
