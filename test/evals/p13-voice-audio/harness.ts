// The tier-1 harness of the P13 tasks (F70): Sam's real `ChatEngine` chat (the authority world: the real gate, Ledger
// and journal, Sam's real memory and files, the one scripted fake model) with the production `speech` namespace as
// `chat/session.ts` builds it for every chat, and Sam's real `PersonAttachments` behind the agent script's real upload
// route over an in-memory R2 (the attachment world). Speech is off, as on every deploy before F71: neither world has an
// `AI` binding for speech, and the fake speech binding (`world.ts`) is reached by no production path.
// Turns:
//   - `prompt`: Sam types in the chat; the turn runs to rest;
//   - `voice-note` (payload `name`, `type`, `frames`): the composer uploads a generated MP3 as a browser's recorder sends it;
//   - `dictate` (payload `text`): the composer's mic filled the box with `text` (dictation is the browser's), and Sam sends it;
//   - `read`: the chat is asked for nothing new; the reference, the sources and the routes are read (T-P13-01).
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { FakeRequest, FakeStep } from "../../support/fake-model.ts";
import type { Snapshot } from "../../support/scenario.ts";
import { Seeded } from "../../support/seeded.ts";
import type { DefinedTask, TaskHarness, Turn } from "../../support/task.ts";
import { repoRoot } from "../../support/temp-repo.ts";
import { attachmentWorld } from "../../workers/support/attachment-world.ts";
import { type AuthorityWorld, authorityWorld, person } from "../../workers/support/authority-world.ts";
import type { AttachmentRow, P13World, ResultLine, ToolLine, Upload } from "./world.ts";
import { PROBE_FILE, probeNote, SPEECH_MODELS, silentMp3 } from "./world.ts";

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
}

export class P13Tier1World implements P13World {
  readonly w: AuthorityWorld;
  readonly a = attachmentWorld();
  readonly uploads: Upload[] = [];
  private chat = "";
  private readonly o: P13HarnessOptions;

  constructor(o: P13HarnessOptions) {
    this.o = o;
    this.w = authorityWorld({ seed: [sam, pat], stores: true, script: o.script });
  }

  async open(): Promise<void> {
    this.chat = ((await this.w.host(sam.email).chats.main(this.w.clock.now)) as { chatId: string }).chatId;
  }

  private engine() {
    return this.w.chats.harness(this.chat).instance;
  }

  private sources(dir: string) {
    const files = sourcesUnder(dir);
    return this.o.plantSources ? this.o.plantSources(files) : files;
  }

  async play(turn: Turn): Promise<void> {
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
      // The composer's mic is the browser's: what reaches the deploy is the box's text, sent as any typed message.
      await this.w.say(sam.email, p.text ?? "", this.chat);
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
