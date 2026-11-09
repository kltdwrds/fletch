// The tier-1 harness of the P11 tasks (F100): the M24.3 world (`authorityWorld`: Sam's real chat engine, gate, card
// store, grants, routes and `Person` with `PersonFiles` and `PersonLinks` over the object harness, the scripted fake
// model, the world's clock moved by hand) with Sam Solo and Pat Solo of Solo Sam both members, and a recording
// Renderer port: the production `render()` over a pandoc port that answers the formats it is told to. A world for
// T-P11-02 is also built on the self-host default host, whose render is `singleAccountHost`'s own refusal. Each task's
// scripted run (`runs.ts`) plays its turns here and records what it saw into `P11World` (`world.ts`).
import { zipSync } from "fflate";
import { available } from "../../../packages/agent/src/host.ts";
import { singleAccountHost } from "@qyvr/host-cloudflare";
import { serve } from "../../../packages/agent/src/http/serve.ts";
import { render as renderMarkdown, type RenderResult } from "../../../packages/agent/src/render/render.ts";
import type { FakeStep } from "../../support/fake-model.ts";
import type { Snapshot } from "../../support/scenario.ts";
import type { Seeded } from "../../support/seeded.ts";
import type { Task, TaskHarness, Turn } from "../../support/task.ts";
import { authorityWorld, person, T0, TENANT } from "../../workers/support/authority-world.ts";
import type { Answer, CardSeen, Entry, FileRow, LinkSeen, P11World, RenderRun } from "./world.ts";

export const sam = person("sam-solo");
export const pat = person("pat-solo");
export { T0 };

/** A docx's first bytes: a zip header the Renderer's output check accepts. */
export const DOCX_BYTES = [0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00, 0x08, 0x00, 0x77, 0x72, 0x65, 0x6e];
export const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * A pptx as pandoc makes one from `---`-separated Markdown (F101): one slide per part, each slide's text its part's
 * lines, in a package `ooxml.ts` reads back. The Renderer port's stand-in, so a deck's slide count is read from bytes.
 */
export function fakePptx(markdown: string): Uint8Array {
  const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
  const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const parts = markdown.split(/^---\s*$/m).map((p) => p.trim()).filter(Boolean);
  const files: Record<string, Uint8Array> = {};
  const put = (k: string, v: string) => {
    files[k] = new TextEncoder().encode(v);
  };
  put("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>`);
  put("ppt/presentation.xml", `<?xml version="1.0" encoding="UTF-8"?><p:presentation xmlns:p="${P}" xmlns:r="${R}"><p:sldIdLst>${parts.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join("")}</p:sldIdLst></p:presentation>`);
  put("ppt/_rels/presentation.xml.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${parts.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${R}/slide" Target="slides/slide${i + 1}.xml"/>`).join("")}</Relationships>`);
  for (const [i, part] of parts.entries()) put(`ppt/slides/slide${i + 1}.xml`, `<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:p="${P}" xmlns:a="${A}"><p:cSld><p:spTree><p:sp><p:txBody>${part.split("\n").filter((l) => l.trim()).map((l) => `<a:p><a:r><a:t>${esc(l.replace(/^#+\s*/, ""))}</a:t></a:r></a:p>`).join("")}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`);
  return zipSync(files);
}

/** The production `render()` over a pandoc port answering `formats`; every format it is asked for is kept. */
export function recordingRenderer(formats: string[]) {
  const asked: string[] = [];
  const port = async (req: Request) => {
    const body = (await req.json()) as { to: string; text: string };
    asked.push(body.to);
    if (!formats.includes(body.to)) return new Response(JSON.stringify({ error: `unknown writer ${body.to}` }), { status: 200 });
    const output = body.to === "html" ? `<html><body>${body.text.replace(/[<>&]/g, "")}</body></html>` : btoa(String.fromCharCode(...(body.to === "pptx" ? fakePptx(body.text) : DOCX_BYTES)));
    return new Response(JSON.stringify({ output }), { status: 200 });
  };
  const render = ((input: unknown) => renderMarkdown(input, { fetch: port as never }, async () => {})) as (input: { markdown: string; to: string }) => Promise<RenderResult>;
  return { asked, render };
}

/** The self-host default host's render, as `objects/chat.ts` reaches it: `singleAccountHost`'s refusal. */
export function defaultHostRender() {
  const host = singleAccountHost({ TENANT_ID: TENANT, OWNER_EMAIL: sam.email, COMPANY: {} as DurableObjectNamespace });
  const asked: string[] = [];
  const render = (async (input: { markdown: string; to: string }) => {
    if (available(host.render)) {
      asked.push(input.to);
      return host.render.render(input) as Promise<RenderResult>;
    }
    return host.render;
  }) as (input: { markdown: string; to: string }) => Promise<RenderResult>;
  return { asked, render };
}

export const load = (ns: string[], id = "l1"): FakeStep => ({ toolCall: { id, name: "tool_search", arguments: { load: ns } } });
export const call = (name: string, args: Record<string, unknown>, id: string): FakeStep => ({ toolCall: { id, name, arguments: args } });

type Msg = { role: string; content?: unknown; toolName?: string };
/** A tool result without the external-content fence the chat wraps it in. */
const unfence = (t: string) => t.replace(/^\[BEGIN EXTERNAL CONTENT[^\]]*\]\n/, "").replace(/\n\[END EXTERNAL CONTENT[^\]]*\]$/, "");
const textOf = (c: unknown): string => (typeof c === "string" ? c : Array.isArray(c) ? c.filter((x) => (x as { type?: string }).type === "text").map((x) => (x as { text: string }).text).join("") : "");

export interface WorldSpec {
  script: FakeStep[];
  /** The formats the Renderer port answers; `default` is the self-host default host (no render); none, no Renderer. */
  render?: string[] | "default";
}

/** One tier-1 world and its recorder. */
export class P11Tier1 implements P11World {
  readonly w: ReturnType<typeof authorityWorld>;
  readonly renderer: { asked: string[] } | null;
  before: FileRow[] = [];
  /** The R2 keys the seed left (F101): setup's, whose fate each task grades in its own end state. */
  seeded = new Set<string>();
  readonly answers: Record<string, Answer> = {};
  readonly at: P11World["at"] = {};
  readonly renders: RenderRun[] = [];
  readonly egress: string[] = [];
  liveExpr = "";
  listing: P11World["listing"] = { tool: "", library: [] };
  chat: string | null = null;

  constructor(spec: WorldSpec) {
    const r = spec.render === "default" ? defaultHostRender() : spec.render ? recordingRenderer(spec.render) : null;
    this.renderer = r;
    this.w = authorityWorld({ stores: true, seed: [sam, pat], script: spec.script, ...(r ? { render: r.render } : {}) });
  }

  /** Makes Sam's stores' tables, so an empty `files` table reads as empty. */
  async open(): Promise<void> {
    await this.w.host(sam.email).files.list({}, sam.email);
    await this.w.host(sam.email).links.link({ path: "p11-none.md" }, sam.email);
    await this.w.host(sam.email).authority.list(sam.email);
  }

  async say(text: string, as = sam.email): Promise<void> {
    const r = await this.w.say(as, text, this.chat ?? undefined);
    this.chat ??= r.chatId;
  }

  files(): FileRow[] {
    const h = this.w.personHarness(sam.email);
    return (h?.rows("SELECT path, size, sha256, media_type, updated_at, body FROM files ORDER BY path") ?? []).map((x) => ({ path: String(x.path), size: Number(x.size), sha256: String(x.sha256), mediaType: x.media_type === null ? null : String(x.media_type), updatedAt: Number(x.updated_at), text: x.body === null ? null : String(x.body) }));
  }

  entries(): Entry[] {
    if (!this.chat) return [];
    return this.w.chats.harness(this.chat).rows("SELECT body FROM messages ORDER BY seq").flatMap((r): Entry[] => {
      const m = JSON.parse(String(r.body)) as Msg;
      if (m.role === "user") return [{ role: "user", text: textOf(m.content) }];
      if (m.role === "toolResult") return [{ role: "tool", text: unfence(textOf(m.content)), tool: String(m.toolName ?? "") }];
      if (m.role === "assistant" && Array.isArray(m.content)) {
        return (m.content as Array<{ type: string; text?: string; name?: string; arguments?: unknown }>).flatMap((c): Entry[] => (c.type === "text" && c.text ? [{ role: "agent", text: c.text }] : c.type === "toolCall" ? [{ role: "call", text: JSON.stringify(c.arguments ?? {}), tool: String(c.name) }] : []));
      }
      return [];
    });
  }

  cards(): CardSeen[] {
    return this.w.cardsOf(sam.email).map((c) => ({ state: String(c.state), title: String(c.title), lines: [...(c.lines ?? [])], choices: (c.choices ?? []).map((x: { choice: string }) => x.choice) }));
  }

  links(): LinkSeen[] {
    return this.chat ? (this.w.chats.harness(this.chat).instance.linksFor(sam.email) ?? []).map((l) => ({ kind: String(l.kind), title: String(l.title), text: String(l.text), href: String(l.href) })) : [];
  }

  shares() {
    return (this.w.personHarness(sam.email)?.rows("SELECT id, path, sha256, expires_at FROM shares ORDER BY id") ?? []).map((x) => ({ id: String(x.id), path: String(x.path), sha256: String(x.sha256), expiresAt: Number(x.expires_at) }));
  }

  pointers(): string[] {
    return [...this.w.r2.objects.keys()].filter((k) => k.startsWith("shares/"));
  }

  async journal(): Promise<string[]> {
    return (await this.w.journal()).map((r) => `${r.actionKind} ${r.subjectRef}`);
  }

  async journalText(): Promise<string> {
    return JSON.stringify(await this.w.journal());
  }

  async snapshot(): Promise<Snapshot> {
    // R2 is read as P11's area alone: Sam's home files and the share pointers (the standing files a first chat seeds are P14's).
    // A journal id carries the chat's random id and a share pointer its random share id: each is named by what is stable;
    // a row whose id names no chat (a file's delete or a share's revoke, F101) is named by its action and subject alone.
    // The seed's own keys are setup (F101): a delete or a revoke removes them by design, and the task's end state grades it.
    return {
      journal: (await this.w.journal()).map((r) => `${r.actionKind} ${r.subjectRef} ${r.id.split(":").slice(1).join(":")}`.trimEnd()),
      vault: [],
      r2: [...this.w.r2.objects.keys()].filter((k) => (k.includes("/files/") || k.startsWith("shares/")) && !this.seeded.has(k)).map((k) => k.replace(/^shares\/[0-9a-f]+$/, "shares/<id>")).sort(),
    };
  }

  /** Counts at a named stage of the turns. */
  mark(name: string): void {
    this.at[name] = { shares: this.shares().length, pointers: this.pointers().length, pending: this.cards().filter((c) => c.state === "pending").length, links: this.links().length };
  }

  /** One request with no session at all: the public door `serve.ts` answers first. */
  async publicGet(path: string): Promise<Response> {
    return serve(new Request(`https://${TENANT}.example${path}`), { TENANT_ID: TENANT, TENANT_SHAPE: "company", QYVR_ENV: "test" } as never, { tenant: TENANT }, { dir: this.w.dir as never, now: () => this.w.clock.now });
  }

  /** Keeps an answer under `name`. */
  async keep(name: string, who: Answer["who"], res: { status: number; text: string }): Promise<void> {
    let code: string | null = null;
    try {
      code = (JSON.parse(res.text) as { code?: string }).code ?? null;
    } catch {}
    this.answers[name] = { who, status: res.status, code, body: res.text };
  }

  async getAs(name: string, who: "sam" | "pat" | "none", path: string): Promise<void> {
    if (who === "none") {
      const r = await this.publicGet(path);
      return this.keep(name, who, { status: r.status, text: await r.text() });
    }
    const r = await this.w.http(who === "sam" ? sam.email : pat.email, "GET", path);
    return this.keep(name, who, { status: r.status, text: JSON.stringify(r.body) });
  }

  /** Approves the one pending card as Sam, from her session. */
  async approve(): Promise<void> {
    const card = this.w.cardsOf(sam.email).find((c) => c.state === "pending");
    if (!card || !this.chat) throw new Error("P11_NO_PENDING_CARD");
    await this.w.http(sam.email, "POST", `/chats/${this.chat}/cards/decide`, { ids: [card.id], choice: "once" });
  }

  /** Writes a home file as Sam, as a seed. */
  async seedText(path: string, text: string): Promise<void> {
    const r = await this.w.host(sam.email).files.write({ path, text }, { requester: sam.email, writer: sam.email });
    if (!r.ok) throw new Error(`P11_SEED: ${r.code}`);
  }

  async seedDocx(path: string): Promise<void> {
    const r = await this.w.host(sam.email).files.writeBytes({ path, bytes: new Uint8Array(DOCX_BYTES), mediaType: DOCX_TYPE }, { requester: sam.email, writer: `agent:${sam.email}` });
    if (!r.ok) throw new Error(`P11_SEED: ${r.code}`);
  }

  /** Plants a lasting auto grant over every files action, past the grant rules, as M24.3's test does. */
  plantStandingGrant(): void {
    const id = `g_${"a".repeat(32)}`;
    this.w.personHarness(sam.email)?.db.prepare("INSERT INTO grants (id, body, created_at) VALUES (?, ?, ?)").run(id, JSON.stringify({ id, tenant: TENANT, grantor: { kind: "person", id: sam.email }, grantee: { kind: "own-agent" }, mode: "auto", constraints: {}, created_at: T0, subject: { kind: "action-kind", ref: "files.share" }, created_from: "chat-confirmation" }), T0);
  }
}

/** A task's scripted run: its world, its seed, and one handler per turn in order. */
export interface Run {
  spec: WorldSpec;
  seed?: (t: P11Tier1) => Promise<void>;
  turns: Array<(t: P11Tier1, turn: Turn) => Promise<void>>;
  /** Runs after the turns: read-backs that are not turns (the listing, a second world). */
  after?: (t: P11Tier1) => Promise<void>;
}

/** The harness for one run: the world from its spec, the seed, then each turn by its handler; an egress recorder around it all. */
export function p11Harness(run: Run): TaskHarness<P11Tier1> {
  let i = 0;
  return {
    setup: async (_rng: Seeded, _task: Task<P11Tier1>) => {
      i = 0;
      const t = new P11Tier1(run.spec);
      const real = globalThis.fetch;
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        t.egress.push(String(input instanceof Request ? input.url : input));
        return real(input, init);
      }) as typeof fetch;
      await t.open();
      await run.seed?.(t);
      t.before = t.files();
      t.seeded = new Set(t.w.r2.objects.keys());
      (t as unknown as { restore: () => void }).restore = () => {
        globalThis.fetch = real;
      };
      return t;
    },
    play: async (t, turn) => {
      const h = run.turns[i++];
      if (!h) throw new Error(`P11_TURN_UNSCRIPTED: ${JSON.stringify(turn)}`);
      await h(t, turn);
      if (i === run.turns.length) {
        await run.after?.(t);
        (t as unknown as { restore: () => void }).restore();
      }
    },
  };
}

/** A prompt turn: Sam says its text in c1. */
export const prompt = async (t: P11Tier1, turn: Turn): Promise<void> => {
  if (turn.kind !== "prompt") throw new Error("P11_NOT_A_PROMPT");
  await t.say(turn.text, turn.by);
};
