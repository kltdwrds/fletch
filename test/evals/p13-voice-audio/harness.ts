// The tier-1 harness of the P13 tasks (F70): Sam's real `ChatEngine` chat (the authority world: the real gate, Ledger
// and journal, Sam's real memory and files, the one scripted fake model) with the production `speech` namespace as
// `chat/session.ts` builds it for every chat, and Sam's real `PersonAttachments` behind the agent script's real upload
// route over an in-memory R2 (the attachment world). Speech is off, as on every deploy before F71: neither world has an
// `AI` binding for speech, and the fake speech binding (`world.ts`) is reached by no production path.
// Turns:
//   - `prompt`: Sam types in the chat; the turn runs to rest;
//   - `voice-note` (payload `name`, `type`, `frames`): the composer uploads a generated MP3 as a browser's recorder sends it;
//   - `dictate` (payload `text`): the composer's mic filled the box with `text` (dictation is the browser's), and Sam sends
//     it from the real chat page in Chromium (`o.dictate`, `dictation-is-text.test.ts`); with no page the turn is refused;
//   - `read`: the chat is asked for nothing new; the reference, the sources and the routes are read (T-P13-01);
//   - `press` (payload `choice`, `once` by default): Sam approves the one pending card from her session, as the chat page
//     does, and the turn it held runs to rest (F74).
// With `documents` (F74) the chats offer the production `documents` namespace (`share_document`, `share_list`,
// `share_revoke`) over Sam's real `PersonLinks`; after each turn every share link the chat drew is opened with no
// session through the production `serve`, and what it answered is kept (`shares()`).
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { FakeRequest, FakeStep } from "../../support/fake-model.ts";
import type { Snapshot } from "../../support/scenario.ts";
import { Seeded } from "../../support/seeded.ts";
import type { DefinedTask, TaskHarness, Turn } from "../../support/task.ts";
import { repoRoot } from "../../support/temp-repo.ts";
import { attachmentWorld } from "../../workers/support/attachment-world.ts";
import { type AuthorityWorld, authorityWorld, person, T0, TENANT } from "../../workers/support/authority-world.ts";
import { serve } from "../../../packages/agent/src/http/serve.ts";
import { DEFAULT_SPEAKER, speechOf } from "../../../packages/agent/src/speech/speech.ts";
import type { AttachmentRow, AudioItem, CardLine, P13World, ResultLine, ShareLine, SpeechCall, SpeechCue, SpeechRow, ToolLine, Upload } from "./world.ts";
import { fakeSpeechAI, PROBE_FILE, probeNote, SPEECH_MODELS, silentMp3 } from "./world.ts";

export const sam = person("sam-solo");
export const pat = person("pat-solo");

type Msg = { role: string; content?: unknown; toolName?: string; isError?: boolean };
const textOf = (content: unknown): string => (typeof content === "string" ? content : Array.isArray(content) ? content.map((c) => (c as { text?: string }).text ?? "").join("") : "");
const messagesOf = (r: FakeRequest) => ((r.inputs as { messages?: Msg[] }).messages ?? []) as Msg[];

/** Every `.ts` file under a folder of `packages/agent/src`, as text. */
const sourcesUnder = (dir: string): Array<{ file: string; text: string }> => {
  const root = join(repoRoot, "packages/agent/src");
  const out: Array<{ file: string; text: string }> = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".ts")) out.push({ file: relative(root, p), text: readFileSync(p, "utf8") });
    }
  };
  walk(join(root, dir));
  return out;
};

export interface P13HarnessOptions {
  script: FakeStep[];
  /** Replaces the sources a grader reads (`planted.test.ts`: a capture tool or route planted in the text). */
  plantSources?: (files: Array<{ file: string; text: string }>) => Array<{ file: string; text: string }>;
  /** The `dictate` turn: the shipped chat page in Chromium, its box filled with the text and sent (T-P13-04's browser test). */
  dictate?: (world: P13Tier1World, text: string) => Promise<void>;
  /**
   * Speech on (F71): the chats' `speech` hook and the attachments' transcriber over the fake speech binding (`world.ts`),
   * each call admitted and written by the authority world's real Ledger; `cues` in the order the binding is called,
   * `monthlyMicros` the tenant's speech cap, `seed` turns played before the task's (a render the task starts after).
   */
  speech?: { cues?: SpeechCue[]; monthlyMicros?: number; seed?: Turn[]; voice?: string };
  /** F74: the chats offer the production `documents` namespace; its Renderer answers nothing (no task here renders). */
  documents?: boolean;
}

/** The Renderer the `documents` namespace reaches in the P13 world: none is bound, so a render is refused by name. */
const NO_RENDER = async () => ({ ok: false as const, code: "RENDER_UNAVAILABLE" as const, reason: "the P13 world binds no Renderer" });
/** The end a share item names (`share_document`'s `until <YYYY-MM-DD HH:MM> UTC`), in ms; 0 when it names none. */
export const endOf = (words: string): number => {
  const m = /\buntil (\d{4}-\d\d-\d\d) (\d\d:\d\d) UTC\b/.exec(words);
  return m ? Date.parse(`${m[1]}T${m[2]}:00Z`) : 0;
};

export class P13Tier1World implements P13World {
  readonly w: AuthorityWorld;
  readonly a: ReturnType<typeof attachmentWorld>;
  /** The fake speech binding when speech is on (F71); absent, as on every deploy before it. */
  readonly speechAI?: ReturnType<typeof fakeSpeechAI>;
  readonly uploads: Upload[] = [];
  /** What each share link the chat drew answered, opened with no session after the last turn (F74), by its href. */
  readonly answered = new Map<string, string>();
  private chat = "";
  /** Sam's main chat, which the page opens at `/`. */
  get chatId(): string {
    return this.chat;
  }
  private readonly o: P13HarnessOptions;

  constructor(o: P13HarnessOptions) {
    this.o = o;
    const ai = o.speech ? fakeSpeechAI(o.speech.cues) : undefined;
    this.w = authorityWorld({ seed: [sam, pat], stores: true, script: o.script, ...(ai ? { speech: { ai: ai.binding } } : {}), ...(o.documents ? { render: NO_RENDER as never } : {}) });
    if (ai) this.speechAI = ai;
    // The attachments' transcriber as `attachments/wiring.ts` builds it: the binding, admitted by the tenant's Ledger.
    const speech = ai ? speechOf({ AI: ai.binding }, { ledger: this.w.ledger() as never, tenant: String((this.w.env as { TENANT_ID?: string }).TENANT_ID ?? "solo-sam"), now: () => this.w.clock.now }) : null;
    this.a = attachmentWorld(speech ? { speech } : {});
  }

  async open(): Promise<void> {
    this.chat = ((await this.w.host(sam.email).chats.main(this.w.clock.now)) as { chatId: string }).chatId;
    if (this.o.speech?.monthlyMicros !== undefined) await this.w.ledger().setBudgets({ tenantSpeechMonthlyMicros: this.o.speech.monthlyMicros });
    // Sam's voice record as set before the task (the setup's "voice record set"), straight in the store: no journal row.
    if (this.o.speech?.voice) await this.w.host(sam.email).audio.call({ op: "voice-set", speaker: this.o.speech.voice, writer: "setup" }, sam.email);
  }

  /** The tenant Ledger's rows, read from its storage. */
  private ledgerRows(sql: string): Record<string, unknown>[] {
    const h = this.w.objects().find(([n]) => n === "ledger")?.[1];
    return h ? h.rows(sql) : [];
  }

  /** Sam's `Person` rows from one table, empty before the table exists. */
  private personRows(table: string): Record<string, unknown>[] {
    const h = this.w.personHarness(sam.email);
    return h?.rows("SELECT name FROM sqlite_master WHERE name = ?", table).length ? h.rows(`SELECT * FROM ${table} ORDER BY rowid`) : [];
  }

  speechCalls(): SpeechCall[] {
    return this.speechAI?.calls ?? [];
  }

  audio(): AudioItem[] {
    return this.personRows("audio_items").map((r) => ({ id: String(r.id), kind: r.kind as AudioItem["kind"], path: String(r.path), durationMs: Number(r.duration_ms), voice: String(r.voice), model: String(r.model), source: String(r.source), ...(r.topics ? { topics: JSON.parse(String(r.topics)) as string[] } : {}), removed: r.removed_at != null }));
  }

  voice(): { speaker: string | null; changes: Array<{ speaker: string; writer: string }> } {
    const set = this.personRows("speech_settings").find((r) => r.key === "speaker");
    const changes = this.ledgerRows("SELECT body FROM journal ORDER BY at, id")
      .map((r) => JSON.parse(String(r.body)) as { actionKind: string; subjectRef: string; runId: string; principal: string })
      .filter((j) => j.actionKind === "speech.voice_set" && j.principal === sam.email)
      .map((j) => ({ speaker: j.subjectRef.split("voice/")[1] ?? "", writer: j.runId.split(":")[0] ?? "" }));
    return { speaker: set ? String(set.value) : this.speechAI ? DEFAULT_SPEAKER : null, changes };
  }

  speechRows(): SpeechRow[] {
    return this.ledgerRows("SELECT route, model, cost_micros FROM model_calls WHERE route = 'speech' AND status != 'refused' ORDER BY id").map((r) => ({ route: String(r.route), model: String(r.model), costMicros: Number(r.cost_micros) }));
  }

  /** The codes `speak` refused with, in order, as the model read them. */
  refusals(): string[] {
    return this.results().filter((r) => r.tool === "speak" && r.isError).map((r) => /\b(SPEECH_[A-Z_]+|MODEL_[A-Z_]+|BUDGET_[A-Z_]+)\b/.exec(r.text)?.[1] ?? "");
  }

  /** The approval cards raised in Sam's chat: each one's action kind from its stored descriptor, its lines as drawn. */
  cards(): CardLine[] {
    const kinds = new Map(this.w.chats.harness(this.chat).rows("SELECT id, descriptor FROM cards").map((r) => [String(r.id), String((JSON.parse(String(r.descriptor)) as { actionKind?: string }).actionKind ?? "")]));
    return this.w.cardsOf(sam.email).map((c) => ({ kind: kinds.get(String(c.id)) ?? "", lines: [...((c as { lines?: string[] }).lines ?? [])], pressed: (c as { state?: string }).state === "approved" }));
  }

  /**
   * The share items the chat drew (F74), in order: their href, words and the file `share_document` said it shared at that
   * href, read from what the model was shown (a card's run reaches the model as the decided result, not as a stored row).
   */
  private shareItems(): Array<{ href: string; text: string; path: string }> {
    const shown = this.w.fake.requests.flatMap((r) => messagesOf(r).map((m) => textOf(m.content))).join("\n");
    const said = [...shown.matchAll(/SHARED: (\S+) at (\/hooks\/share\/[0-9a-f]{32}\.[0-9a-f]{64})/g)];
    const items = (this.engine().linksFor(sam.email) ?? []) as Array<{ kind: string; text: string; href: string }>;
    return items.filter((l) => l.kind === "share").map((l) => ({ href: String(l.href), text: String(l.text), path: said.find((m) => m[2] === l.href)?.[1] ?? "" }));
  }

  /** Each share link made in the chat (F74): its file, its link, the end its item names and what the link answers now. */
  shares(): ShareLine[] {
    return this.shareItems().map((s) => ({ path: s.path, url: s.href, endsAt: endOf(s.text), answers: this.answered.get(s.href) ?? "NOT_OPENED" }));
  }

  /** One request with no session at all: the public door `serve.ts` answers first. */
  async publicGet(path: string): Promise<Response> {
    return serve(new Request(`https://${TENANT}.example${path}`), { TENANT_ID: TENANT, TENANT_SHAPE: "company", QYVR_ENV: "test" } as never, { tenant: TENANT }, { dir: this.w.dir as never, now: () => this.w.clock.now });
  }

  /** Opens every share link the chat drew with no session and keeps its answer: `SERVED` on a 200, else the refusal's code. */
  private async openShares(): Promise<void> {
    for (const { href } of this.shareItems()) {
      const r = await this.publicGet(href);
      const body = await r.text();
      let code = `HTTP_${r.status}`;
      try {
        code = r.status === 200 ? "SERVED" : ((JSON.parse(body) as { code?: string }).code ?? code);
      } catch {}
      this.answered.set(href, code);
    }
  }

  /** Plants a lasting auto grant over `files.share` in Sam's grants store, past the grant rules (F74's plant, as M24.3's). */
  plantStandingShareGrant(): void {
    const id = `g_${"b".repeat(32)}`;
    this.w.personHarness(sam.email)?.db.prepare("INSERT INTO grants (id, body, created_at) VALUES (?, ?, ?)").run(id, JSON.stringify({ id, tenant: TENANT, grantor: { kind: "person", id: sam.email }, grantee: { kind: "own-agent" }, mode: "auto", constraints: {}, created_at: T0, subject: { kind: "action-kind", ref: "files.share" }, created_from: "chat-confirmation" }), T0);
  }

  engine() {
    return this.w.chats.harness(this.chat).instance;
  }

  private sources(dir: string) {
    const files = sourcesUnder(dir);
    return this.o.plantSources ? this.o.plantSources(files) : files;
  }

  async play(turn: Turn): Promise<void> {
    await this.turn(turn);
    if (this.o.documents) await this.openShares();
  }

  private async turn(turn: Turn): Promise<void> {
    if (turn.kind === "prompt") {
      await this.w.say(sam.email, turn.text, this.chat);
      await this.engine().settled();
      return;
    }
    if (turn.kind !== "event") throw new Error(`P13_TURN_UNKNOWN: ${turn.kind}`);
    const p = turn.payload ?? {};
    if (turn.name === "voice-note") {
      const bytes = p.frames ? silentMp3(Number(p.frames)) : probeNote();
      const name = p.name ?? PROBE_FILE;
      const r = await this.a.upload(sam.email, name, bytes, { type: p.type ?? "audio/mpeg" });
      this.uploads.push({ name, status: r.status, ...(typeof r.body.code === "string" ? { code: r.body.code } : {}), words: String(r.body.words ?? "") });
    } else if (turn.name === "dictate") {
      // The composer's mic is the browser's: what reaches the deploy is what the page sends, so the turn runs on the page.
      if (!this.o.dictate) throw new Error("P13_DICTATE_NEEDS_PAGE: T-P13-04 is a browser test (dictation-is-text.test.ts)");
      await this.o.dictate(this, p.text ?? "");
      await this.engine().settled();
    } else if (turn.name === "press") {
      // The chat page's Allow: Sam's own session posts the decision for the one pending card.
      const card = this.w.cardsOf(sam.email).find((c) => (c as { state?: string }).state === "pending");
      if (!card) throw new Error("P13_NO_PENDING_CARD");
      await this.w.http(sam.email, "POST", `/chats/${this.chat}/cards/decide`, { ids: [card.id], choice: p.choice ?? "once" });
      await this.engine().settled();
    } else if (turn.name === "read") {
      await this.w.say(sam.email, p.text ?? "p13 probe: what can you do with voice?", this.chat);
      await this.engine().settled();
    } else throw new Error(`P13_EVENT_UNKNOWN: ${turn.name}`);
  }

  private chatRequests(): FakeRequest[] {
    return this.w.fake.requests.filter((r) => messagesOf(r).some((m) => m.role === "system" && textOf(m.content).includes("Surface: chat.")));
  }

  prefix(): string {
    const first = this.chatRequests()[0];
    return first ? messagesOf(first).filter((m) => m.role === "system").map((m) => textOf(m.content)).join("\n") : "";
  }

  tools(): ToolLine[] {
    // The authority world's fixture connectors (each described "Fixture: …") are the test's, not production's.
    return [...this.prefix().matchAll(/^- ([a-z][a-z0-9_]+) \([^)]*\): (.*)$/gm)].map((m) => ({ name: m[1] as string, description: m[2] as string })).filter((t) => !t.description.startsWith("Fixture:"));
  }

  declaredTools(): string[] {
    return [...new Set(this.sources(".").flatMap((f) => [...f.text.matchAll(/\bname: "([a-z][a-z0-9_]+)",\s*\n\s*kind: "(?:observation|action)"/g)].map((m) => m[1] as string)))].sort();
  }

  routes(): string[] {
    const files = this.sources("http").concat(this.sources(".").filter((f) => f.file === "index.ts"));
    return [...new Set(files.flatMap((f) => [...f.text.matchAll(/["'`](\/[A-Za-z0-9_/.:${}<>-]*)["'`]/g)].map((m) => m[1] as string)))].sort();
  }

  private entries() {
    return this.engine().history().entries;
  }

  typed(): string[] {
    return this.entries().filter((e) => e.kind === "you").map((e) => String((e as { text?: string }).text ?? ""));
  }

  replies(): string[] {
    return this.entries().filter((e) => e.kind === "agent").map((e) => String((e as { text?: string }).text ?? ""));
  }

  results(): ResultLine[] {
    return this.w.chats
      .harness(this.chat)
      .rows("SELECT body FROM messages ORDER BY seq")
      .map((r) => JSON.parse(String(r.body)) as Msg)
      .filter((m) => m.role === "toolResult")
      // The fence the loop puts around a tool's result is the loop's, not the tool's words.
      .map((m) => ({ tool: m.toolName ?? "", text: textOf(m.content).replace(/^\[(BEGIN|END) EXTERNAL CONTENT[^\]]*\]\n?/gm, "").trim(), isError: !!m.isError }));
  }

  rows(): AttachmentRow[] {
    return this.a.rows(sam.email).map((r) => ({ id: String(r.id), name: String(r.name), mime: String(r.mime), size: Number(r.size), cls: String(r.cls), sha256: String(r.sha256), status: String(r.status), code: r.code == null ? null : String(r.code), transcript: r.transcript == null ? null : String(r.transcript) }));
  }

  async objects(): Promise<string[]> {
    const keys = async (r2: { list(o?: { prefix?: string }): Promise<{ objects: Array<{ key: string }> }> }) => (await r2.list({})).objects.map((o) => o.key);
    return [...(await keys(this.a.r2 as never)), ...(await keys(this.w.r2 as never))].sort();
  }

  speechRequests(): string[] {
    return this.w.fake.requests.map((r) => r.model).filter((m) => SPEECH_MODELS.includes(m));
  }

  async snapshot(): Promise<Snapshot> {
    return { journal: (await this.w.journal()).map((r) => `${r.actionKind}:${r.outcome}`), vault: [], r2: await this.objects() };
  }
}

export function p13Harness(o: P13HarnessOptions): TaskHarness<P13World> {
  return {
    setup: async () => {
      const w = new P13Tier1World(o);
      await w.open();
      for (const t of o.speech?.seed ?? []) await w.play(t);
      // Sam's standing files are written on their first read, as a first turn would: here, before the snapshot.
      await w.w.host(sam.email).memory.standingFiles();
      return w;
    },
    play: async (world, turn) => (world as P13Tier1World).play(turn),
  };
}

/** The task's turns played through `p13Harness(o)`, and the world after them (`planted.test.ts`). */
export async function played(task: DefinedTask<P13World>, o: P13HarnessOptions, plant?: (w: P13Tier1World) => void): Promise<P13Tier1World> {
  const h = p13Harness(o);
  const rng = new Seeded(task.setup.seed);
  const world = (await h.setup(rng, task)) as P13Tier1World;
  plant?.(world);
  for (const t of task.turns) await h.play(world, t, rng);
  return world;
}

/** Each grader's verdict: true where an end state or fact holds and where a minefield was not stepped on. */
export async function graded(task: DefinedTask<P13World>, world: P13World): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  for (const g of task.graders) out[g.name] = g.kind === "minefield" ? !(await g.check(world)) : await g.check(world);
  return out;
}
