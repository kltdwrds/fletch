// The worktree's preview slot as the tier-2 runner's `Slot` (F19): the lease `pnpm preview up` left in
// <git common dir>/fletch-previews/, the slot's host from the pool's subdomain, a session obtained as the live exit
// test obtains one (test/live/f1-deploy.live.test.ts: the software passkey, test/support/soft-authenticator.ts), and
// one chat per trial driven over the chat socket (another opened when a prompt names it, F28). Every failure here is the slot's, an `InfraError` by code:
//   SLOT_MISSING         no lease file, or the slot does not serve the app (`pnpm preview up` leases and deploys one)
//   LEASE_LAPSED         the slot no longer takes this worktree's key, or its lease is another branch's or over
//   SLOT_UNREACHABLE     no answer at all from the slot's host
//   SLOT_5XX             a 5xx before the first model call (the lease read, the sign-in, the chat's creation)
//   SESSION_UNAVAILABLE  no way to sign in: the saved passkey is unknown to the slot and the setup token is spent
// The session is kept in the same git-ignored folder as the lease (`evals-<tag>.json`, mode 600): the cookie, and the
// passkey's material so the next run signs in again when the cookie is gone; a fresh lease (new setup token) registers
// a new one. Nothing here is printed: not the key, the cookie, the token nor the passkey.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ChatLabel } from "../../test/evals/p6-memory/world.ts";
import { EMPTY_SNAPSHOT, InfraError, reactionsOf, type SlotEntry, type SlotWorld, TurnError } from "../../test/support/evals.ts";
import { type SavedPasskey, softAuthenticator } from "../../test/support/soft-authenticator.ts";
import { origin as originOf, ownerTag, SLOT_OWNER, slotPlan } from "../preview-plan.mjs";
import { knownSubdomain, readJson } from "../preview-pool.mjs";
import { p3Page } from "./p3-page.ts";
import { type P3State, p3Slot } from "./p3-slot.ts";
import { p5Page } from "./p5-page.ts";
import { p5Slot } from "./p5-slot.ts";
import { type P6Call, p6Slot } from "./p6-slot.ts";
import { p7Page } from "./p7-page.ts";
import { type P7Slot, p7Slot, ZONE } from "./p7-slot.ts";
import { p9Page } from "./p9-page.ts";
import { p12Page } from "./p12-page.ts";
import { type P12State, p12Slot } from "./p12-slot.ts";
import { p14Page } from "./p14-page.ts";
import { type P14State, p14Slot } from "./p14-slot.ts";
import { type P9State, p9Slot } from "./p9-slot.ts";
import type { Slot } from "./runner.ts";
import { type TestHostState, testHostReaders } from "./test-host.ts";

/** The slot's owner: the fixture person every slot is deployed for (scripts/preview-plan.mjs). */
export const OWNER = SLOT_OWNER;
/** How long one turn may take before it is the agent's failure, not the slot's. */
export const TURN_TIMEOUT_MS = 4 * 60_000;
const REQUEST_TIMEOUT_MS = 60_000;

interface Lease {
  slot: number;
  key: string;
  tag: string;
  branch?: string;
  state: string;
  setupToken?: string;
}

interface Session {
  slot: number;
  cookie?: string;
  passkey?: SavedPasskey;
  /** The setup token a registration spent, so a spent one is not tried again. */
  spentSetup?: string;
}

type Json = Record<string, unknown>;

const git = (cwd: string, args: string[]) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
};

/** The worktree's root and the git-ignored folder the lease lives in. */
export function previewDir(cwd: string): { root: string; dir: string } {
  const top = git(cwd, ["rev-parse", "--show-toplevel"]);
  const common = git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (!top || !common) throw new InfraError("SLOT_MISSING", "run it inside the fletch repository");
  return { root: realpathSync(top), dir: join(common, "fletch-previews") };
}

const cookieOf = (res: Response) => {
  const m = (res.headers.get("set-cookie") ?? "").match(/fletch_session=([^;]+)/);
  return m ? `fletch_session=${m[1]}` : "";
};

/** A JSON request to the slot: a network failure is SLOT_UNREACHABLE, a 5xx SLOT_5XX; anything else is the caller's to read. */
async function http(base: string, method: string, path: string, opts: { body?: unknown; cookie?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", ...(opts.headers ?? {}) };
  if (method !== "GET") headers.origin = new URL(base).origin;
  if (opts.cookie) headers.cookie = opts.cookie;
  let res: Response;
  try {
    res = await fetch(base + path, { method, headers, ...(method === "GET" ? {} : { body: JSON.stringify(opts.body ?? {}) }), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), redirect: "manual" });
  } catch (error) {
    throw new InfraError("SLOT_UNREACHABLE", `${method} ${path}: ${(error as Error).message}`);
  }
  if (res.status >= 500) throw new InfraError("SLOT_5XX", `${method} ${path} answered ${res.status}`);
  const text = await res.text();
  let body: Json = {};
  try {
    body = text ? (JSON.parse(text) as Json) : {};
  } catch {
    body = {};
  }
  return { res, body };
}

/** The slot of this worktree's lease, checked live: its name and origin, or the InfraError that says what is missing. */
export async function resolveLease(cwd: string, env: NodeJS.ProcessEnv): Promise<{ dir: string; lease: Lease; name: string; base: string }> {
  const { root, dir } = previewDir(cwd);
  const lease = readJson(join(dir, `lease-${ownerTag(root)}.json`)) as Lease | null;
  if (lease?.state !== "held") throw new InfraError("SLOT_MISSING", "this worktree holds no slot; `pnpm preview up` leases one and deploys the working tree to it");
  const sub = knownSubdomain({ dir, env });
  if (!sub) throw new InfraError("SLOT_MISSING", "the account's workers.dev subdomain is not known here; set FLETCH_PREVIEW_SUBDOMAIN (docs/runbooks/preview.md)");
  const plan = slotPlan(lease.slot, sub);
  const base = originOf(plan);
  const { res, body } = await http(base, "GET", "/__preview/lease", { headers: { "x-preview-tag": lease.tag, "x-preview-key": lease.key } });
  if (res.status !== 200) throw new InfraError("LEASE_LAPSED", `slot ${lease.slot} answered ${res.status} to this worktree's key`);
  if (!body.leased || body.tag !== lease.tag) throw new InfraError("LEASE_LAPSED", `slot ${lease.slot} is ${body.leased ? "another branch's" : "no longer leased"}; \`pnpm preview up\` leases it again`);
  if (body.serving !== "app") throw new InfraError("SLOT_MISSING", `slot ${lease.slot} serves ${String(body.serving ?? "nothing")}, not the app; \`pnpm preview up\` deploys it`);
  return { dir, lease, name: plan.name, base };
}

const sessionPath = (dir: string, tag: string) => join(dir, `evals-${tag}.json`);
const loadSession = (file: string, slot: number): Session => {
  const s = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Session) : null;
  return s && s.slot === slot ? s : { slot };
};
const saveSession = (file: string, s: Session) => writeFileSync(file, `${JSON.stringify(s, null, 2)}\n`, { mode: 0o600 });

/** A signed-in session on the slot: the saved cookie if it still works, else the saved passkey, else the lease's setup token. */
export async function signIn(base: string, lease: Lease, file: string): Promise<string> {
  const session = loadSession(file, lease.slot);
  const works = async (cookie: string) => (await http(base, "GET", "/app/chats", { cookie })).res.status === 200;
  if (session.cookie && (await works(session.cookie))) return session.cookie;
  const url = new URL(base);
  if (session.passkey) {
    const key = await softAuthenticator(url.origin, url.hostname, session.passkey);
    const o = await http(base, "POST", "/login/options");
    if (o.res.status === 200) {
      const done = await http(base, "POST", "/login/verify", { body: { challengeId: o.body.challengeId, credential: await key.get(o.body.options as { challenge: string }) } });
      if (done.res.status === 200) {
        const cookie = cookieOf(done.res);
        saveSession(file, { ...session, cookie, passkey: await key.export() });
        return cookie;
      }
    }
  }
  const setup = lease.setupToken;
  if (setup && setup !== session.spentSetup) {
    const key = await softAuthenticator(url.origin, url.hostname);
    const o = await http(base, "POST", "/login/register/options", { body: { setup } });
    if (o.res.status === 200) {
      const done = await http(base, "POST", "/login/register/verify", { body: { setup, challengeId: o.body.challengeId, credential: await key.create(o.body.options as { challenge: string }) } });
      if (done.res.status === 200 && done.body.ok === true) {
        const cookie = cookieOf(done.res);
        saveSession(file, { slot: lease.slot, cookie, passkey: await key.export(), spentSetup: setup });
        return cookie;
      }
    }
    saveSession(file, { ...session, spentSetup: setup });
  }
  throw new InfraError("SESSION_UNAVAILABLE", `no session on slot ${lease.slot}: the saved cookie and passkey are not accepted and the lease's setup token is ${setup ? "spent" : "not kept"}; a fresh lease (\`pnpm preview down\`, then \`up\`) gives a new one`);
}

/** The chat's history as a fresh socket's first frame carries it (`connectFrame`, type `history`): what the page draws. */
export function history(base: string, chatId: string, cookie: string, timeoutMs = 30_000): Promise<SlotEntry[]> {
  const wsUrl = `${base.replace(/^http/, "ws")}/chats/${chatId}/ws`;
  const Socket = WebSocket as unknown as new (url: string, init: { headers: Record<string, string> }) => WebSocket;
  const ws = new Socket(wsUrl, { headers: { cookie } });
  return new Promise<SlotEntry[]>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => fail(new InfraError("SLOT_UNREACHABLE", `no history frame in ${Math.round(timeoutMs / 1000)} s`)), timeoutMs);
    const end = () => {
      settled = true;
      clearTimeout(timer);
      ws.close();
    };
    const fail = (error: Error) => {
      if (settled) return;
      end();
      reject(error);
    };
    ws.addEventListener("error", () => fail(new InfraError("SLOT_UNREACHABLE", `the chat socket failed: ${wsUrl}`)));
    ws.addEventListener("close", () => fail(new InfraError("SLOT_UNREACHABLE", "the chat socket closed before its history frame")));
    ws.addEventListener("message", (event) => {
      let frame: { type: string; code?: string; entries?: SlotEntry[] };
      try {
        frame = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (frame.type === "history") {
        if (settled) return;
        end();
        resolve(frame.entries ?? []);
      } else if (frame.type === "refused") fail(new InfraError("SESSION_UNAVAILABLE", `the history read was refused ${frame.code ?? ""}`));
    });
  });
}

/** One turn over the chat socket, as the live exit test does it: resolves with the reply on `turn_done`, rejects with a TurnError otherwise. */
export function turn(base: string, chatId: string, cookie: string, text: string, timeoutMs = TURN_TIMEOUT_MS, timeZone = "UTC"): Promise<string> {
  const wsUrl = `${base.replace(/^http/, "ws")}/chats/${chatId}/ws`;
  // Node's WebSocket (undici) takes request headers in its init object; the session is the cookie.
  const Socket = WebSocket as unknown as new (url: string, init: { headers: Record<string, string> }) => WebSocket;
  const ws = new Socket(wsUrl, { headers: { cookie } });
  const id = randomUUID();
  return new Promise<string>((resolve, reject) => {
    let reply = "";
    const named: string[] = [];
    let settled = false;
    const timer = setTimeout(() => fail(new TurnError("TURN_TIMEOUT", `the turn did not end in ${Math.round(timeoutMs / 1000)} s`)), timeoutMs);
    const end = () => {
      settled = true;
      clearTimeout(timer);
      ws.close();
    };
    const fail = (error: Error) => {
      if (settled) return;
      end();
      reject(error);
    };
    ws.addEventListener("error", () => fail(new InfraError("SLOT_UNREACHABLE", `the chat socket failed: ${wsUrl}`)));
    ws.addEventListener("close", () => fail(new TurnError("SOCKET_CLOSED", "the chat socket closed before the turn ended")));
    ws.addEventListener("open", () => ws.send(JSON.stringify({ type: "send", text, id, timeZone })));
    ws.addEventListener("message", (event) => {
      let frame: { type: string; text?: string; code?: string; messages?: { who: string; text: string }[] };
      try {
        frame = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (frame.type === "delta" || frame.type === "message") reply += frame.text ?? "";
      else if (frame.type === "named") {
        for (const m of frame.messages ?? []) if (m.who === "agent") named.push(m.text);
      } else if (frame.type === "refused") fail(new TurnError(`REFUSED:${frame.code ?? "UNKNOWN"}`));
      else if (frame.type === "turn_failed") fail(new TurnError(`TURN_FAILED:${frame.code ?? "UNKNOWN"}`));
      else if (frame.type === "turn_stopped") fail(new TurnError("TURN_STOPPED"));
      else if (frame.type === "turn_done") {
        if (settled) return;
        end();
        resolve(reply || named.join("\n"));
      }
    });
  });
}

/** How far into a minute a P7 trial's first prompt may be sent before it waits for the next minute. */
const MINUTE_EARLY_MS = 15_000;

/** How long a decision may take to start the turn it continues before the runner reads on without one. */
const CONTINUE_START_MS = 20_000;

/**
 * A decision on a card, as the page posts it (`/chats/<id>/cards/decide`), with a socket open first so the turn the
 * decision continues is seen to its end: resolves when that turn is done, or when none started within
 * CONTINUE_START_MS; rejects with a TurnError when the decision is refused or the continued turn fails.
 */
export function decide(base: string, chatId: string, cookie: string, card: string, choice: string, timeoutMs = TURN_TIMEOUT_MS): Promise<void> {
  const wsUrl = `${base.replace(/^http/, "ws")}/chats/${chatId}/ws`;
  const Socket = WebSocket as unknown as new (url: string, init: { headers: Record<string, string> }) => WebSocket;
  const ws = new Socket(wsUrl, { headers: { cookie } });
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let started = false;
    let quiet: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => finish(new TurnError("TURN_TIMEOUT", `the decided turn did not end in ${Math.round(timeoutMs / 1000)} s`)), timeoutMs);
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (quiet) clearTimeout(quiet);
      ws.close();
      if (error) reject(error);
      else resolve();
    };
    ws.addEventListener("error", () => finish(new InfraError("SLOT_UNREACHABLE", `the chat socket failed: ${wsUrl}`)));
    ws.addEventListener("close", () => finish(started ? new TurnError("SOCKET_CLOSED", "the chat socket closed before the decided turn ended") : undefined));
    ws.addEventListener("message", async (event) => {
      let frame: { type: string; code?: string };
      try {
        frame = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (frame.type === "history") {
        const r = await http(base, "POST", `/chats/${chatId}/cards/decide`, { cookie, body: { ids: [card], choice } }).catch((e: Error) => e);
        if (r instanceof Error) return finish(r);
        const answer = (r.body.results as Array<{ ok: boolean; code?: string }> | undefined)?.[0];
        if (r.res.status !== 200 || !answer?.ok) return finish(new TurnError(`DECIDE_REFUSED:${answer?.code ?? String(r.body.code ?? r.res.status)}`));
        quiet = setTimeout(() => finish(), CONTINUE_START_MS);
      } else if (frame.type === "turn_started") {
        started = true;
        if (quiet) clearTimeout(quiet);
      } else if (frame.type === "turn_done") finish();
      else if (frame.type === "turn_failed") finish(new TurnError(`TURN_FAILED:${frame.code ?? "UNKNOWN"}`));
      else if (frame.type === "turn_stopped") finish(new TurnError("TURN_STOPPED"));
    });
  });
}

/** How often a tick's run is read again while it runs, and how long it may take. */
const TICK_POLL_MS = 2_000;

/**
 * A P7 tick (F30): with a socket open first, the job's next alarm fired by the test host, then its state read until a
 * new run is done and its notices delivered, then the turn a notice wakes (F24) seen to its end, or none started within
 * CONTINUE_START_MS. Rejects with a TurnError when no run is done within the turn's time.
 */
export function settleTick(base: string, chatId: string, cookie: string, p7: P7Slot, title: string | undefined, timeoutMs = TURN_TIMEOUT_MS): Promise<void> {
  const wsUrl = `${base.replace(/^http/, "ws")}/chats/${chatId}/ws`;
  const Socket = WebSocket as unknown as new (url: string, init: { headers: Record<string, string> }) => WebSocket;
  const ws = new Socket(wsUrl, { headers: { cookie } });
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let started = false;
    let ran = false;
    let quiet: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => finish(new TurnError("TURN_TIMEOUT", `the tick's run and its turn did not end in ${Math.round(timeoutMs / 1000)} s`)), timeoutMs);
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (quiet) clearTimeout(quiet);
      ws.close();
      if (error) reject(error);
      else resolve();
    };
    const runDone = async () => {
      const { id, before } = await p7.tick(title);
      while (!settled) {
        await new Promise((r) => setTimeout(r, TICK_POLL_MS));
        await p7.refresh();
        const runs = p7.runsOf(id);
        const outbox = p7.readers.outbox().filter((o) => o.state === "pending" || o.state === "delivering");
        if (runs.length > before && runs.every((r) => r.phase === "done") && !outbox.length) break;
      }
      ran = true;
      if (!started) quiet = setTimeout(() => finish(), CONTINUE_START_MS);
    };
    ws.addEventListener("error", () => finish(new InfraError("SLOT_UNREACHABLE", `the chat socket failed: ${wsUrl}`)));
    ws.addEventListener("close", () => finish(started ? new TurnError("SOCKET_CLOSED", "the chat socket closed before the woken turn ended") : undefined));
    ws.addEventListener("message", (event) => {
      let frame: { type: string; code?: string };
      try {
        frame = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (frame.type === "history") runDone().catch((e: Error) => finish(e));
      else if (frame.type === "turn_started") {
        started = true;
        if (quiet) clearTimeout(quiet);
      } else if (frame.type === "turn_done" && ran) finish();
      else if (frame.type === "turn_failed") finish(new TurnError(`TURN_FAILED:${frame.code ?? "UNKNOWN"}`));
      else if (frame.type === "turn_stopped") finish(new TurnError("TURN_STOPPED"));
    });
  });
}

/** The test-host op as the lease's holder; null when the slot serves no test host. */
async function testHostOp(base: string, lease: Lease, body: Record<string, unknown>): Promise<Json | null> {
  const r = await http(base, "POST", "/__preview/test-host", { body, headers: { "x-preview-tag": lease.tag, "x-preview-key": lease.key } });
  if (r.res.status === 404) return null;
  if (r.res.status !== 200) throw new InfraError("LEASE_LAPSED", `the test host answered ${r.res.status} to this worktree's key`);
  return r.body;
}

/** The fixture login T-P15-15 reads: saved once on the slot through the capture form as its owner, for login.example.test. */
export const FIXTURE_LOGIN = { ref: "cred://site-login", host: "login.example.test" } as const;

/** A form posted to the slot's capture route as its owner, from the page's own origin: the status it answered. */
async function postCapture(base: string, cookie: string, fields: Record<string, string>): Promise<number> {
  const res = await fetch(`${base}/vault/capture`, { method: "POST", headers: { cookie, origin: new URL(base).origin, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }).catch((e: Error) => e);
  if (res instanceof Error) throw new InfraError("SLOT_UNREACHABLE", `POST /vault/capture: ${res.message}`);
  if (res.status >= 500) throw new InfraError("SLOT_5XX", `POST /vault/capture answered ${res.status}`);
  return res.status;
}

async function ensureFixtureLogin(base: string, cookie: string): Promise<void> {
  const listed = await http(base, "GET", "/vault", { cookie });
  if (((listed.body.credentials as Array<{ ref: string }> | undefined) ?? []).some((c) => c.ref === FIXTURE_LOGIN.ref)) return;
  // A value made here and never kept: the fixture login is not a secret anyone holds.
  const form = new URLSearchParams({ ref: FIXTURE_LOGIN.ref, host: FIXTURE_LOGIN.host, methods: "GET", header: "authorization", prefix: "", fills: "on", kind: "login", permission: "grant", value: randomUUID() });
  const res = await fetch(`${base}/vault/capture`, { method: "POST", headers: { cookie, origin: new URL(base).origin, "content-type": "application/x-www-form-urlencoded" }, body: form, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }).catch((e: Error) => e);
  if (res instanceof Error || res.status !== 201) throw new InfraError("SLOT_5XX", `the fixture login was not saved: ${res instanceof Error ? res.message : res.status}`);
}

/** The worktree's slot as a `Slot`, resolved lazily: a slot that cannot be resolved is named `none` and every `open` rejects with the reason. */
export function previewSlot(cwd: string, env: NodeJS.ProcessEnv, log: (line: string) => void): Slot & { resolve(): Promise<void> } {
  let resolved: { dir: string; lease: Lease; name: string; base: string } | null = null;
  let failure: InfraError | null = null;
  const slot = {
    name: "none",
    async resolve() {
      if (resolved || failure) return;
      try {
        resolved = await resolveLease(cwd, env);
        slot.name = resolved.name;
        log(`evals: slot ${resolved.lease.slot} (${resolved.name}) is this worktree's; owner ${OWNER}`);
      } catch (error) {
        if (!(error instanceof InfraError)) throw error;
        failure = error;
      }
    },
    async open(task?: { id: string; cluster: string }): Promise<SlotWorld> {
      await slot.resolve();
      if (failure) throw failure;
      const { dir, lease, base } = resolved as NonNullable<typeof resolved>;
      const cookie = await signIn(base, lease, sessionPath(dir, lease.tag));
      const openChat = async () => {
        const opened = await http(base, "POST", "/chats", { cookie });
        if (opened.res.status === 401) throw new InfraError("SESSION_UNAVAILABLE", "the session was refused when opening a chat");
        if (opened.res.status !== 201) throw new InfraError("SLOT_5XX", `POST /chats answered ${opened.res.status} ${String(opened.body.code ?? "")}`);
        return opened.body.chatId as string;
      };
      // A task's chats by label (F28): `c1` opened now, another on its first prompt.
      const chats = new Map<ChatLabel, string>([["c1", await openChat()]]);
      const chatId = chats.get("c1") as string;
      const replies: string[] = [];
      const histories = new Map<ChatLabel, SlotEntry[]>();
      const entriesOf = (label: ChatLabel = "c1") => histories.get(label) ?? [];
      // The test host, when the slot serves one (F26): its fixture sites reopened in the owner's browse memory, the
      // fixture login saved, and what the Vault held before this trial, so the readers count only the trial's own.
      const hosted = (await testHostOp(base, lease, { op: "reset", person: OWNER })) !== null;
      let state: TestHostState | null = null;
      const refresh = async () => {
        if (hosted) state = (await testHostOp(base, lease, { op: "state", person: OWNER, chatId })) as unknown as TestHostState;
      };
      if (hosted) await ensureFixtureLogin(base, cookie);
      await refresh();
      const before = state as TestHostState | null;
      const baseline = { audit: (before?.audit ?? []).map((a) => JSON.stringify(a)), grants: (before?.grants ?? []).map((g) => g.nonce) };
      // A memory task (F28): Sam's memory emptied and seeded before the turns, and read again after each.
      const p6 =
        task?.cluster === "P6"
          ? p6Slot(
              async (call, ids) => {
                const r = await testHostOp(base, lease, { op: "p6", person: OWNER, call, chats: ids });
                if (!r) throw new InfraError("SLOT_MISSING", "this slot serves no test host; `pnpm preview up` deploys one");
                return r as unknown as Awaited<ReturnType<P6Call>>;
              },
              () => chats,
              entriesOf,
            )
          : null;
      if (p6 && task) await p6.begin(task.id);
      // A scheduling task (F30): Sam's jobs reset and the task's made, read again after each turn; the page in Chromium.
      const page = task?.cluster === "P7" ? p7Page(base, cookie) : null;
      const p7 =
        task?.cluster === "P7" && page
          ? p7Slot(
              async (call) => {
                const r = await testHostOp(base, lease, { op: "p7", person: OWNER, chat: chatId, call });
                if (!r) throw new InfraError("SLOT_MISSING", "this slot serves no test host; `pnpm preview up` deploys one");
                return r.answer as Record<string, unknown>;
              },
              () => chatId,
              () => entriesOf(),
              async (path) => {
                const r = await http(base, "GET", path, { cookie });
                return { status: r.res.status, body: r.body };
              },
              page,
            )
          : null;
      if (p7 && task) await p7.begin(task.id, Date.now());
      // An activity task (F32), or a delegation task beside it (F34): chat c1's tasks over the app's routes, read once
      // each turn's task settled; the page in Chromium.
      const p5 =
        task?.cluster === "P5" || task?.cluster === "P3" || task?.cluster === "P9" || task?.cluster === "P12"
          ? p5Slot(
              () => chatId,
              () => entriesOf(),
              async (path) => {
                const r = await http(base, "GET", path, { cookie });
                return { status: r.res.status, body: r.body };
              },
              async () => {
                const r = await testHostOp(base, lease, { op: "p5", person: OWNER, chat: chatId });
                if (!r) throw new InfraError("SLOT_MISSING", "this slot serves no test host; `pnpm preview up` deploys one");
                return (r.prompts as string[] | undefined) ?? [];
              },
              p5Page(base, cookie),
            )
          : null;
      // A delegation task (F34): chat c1's sub-agent rows, mailbox and model requests through the `p3` op, settled when
      // nothing it started is out; the drawer's sections and the thread in Chromium.
      const p3 =
        task?.cluster === "P3"
          ? p3Slot(
              () => chatId,
              () => entriesOf(),
              async (path, method = "GET") => {
                const r = await http(base, method, path, { cookie });
                return { status: r.res.status, body: r.body };
              },
              async () => {
                const r = await testHostOp(base, lease, { op: "p3", person: OWNER, chat: chatId });
                if (!r) throw new InfraError("SLOT_MISSING", "this slot serves no test host; `pnpm preview up` deploys one");
                return r as unknown as P3State;
              },
              p3Page(base, cookie),
            )
          : null;
      // A credentials task (F37): Sam's credential rows reset and the task's set up, chat c1's cards, messages and
      // requests and her Vault's rows through the `p9` op, read again after each turn; the tabs and reloads in Chromium.
      const p9 =
        (task?.cluster === "P9" || task?.cluster === "P12") && p5
          ? p9Slot(
              () => chatId,
              async (call) => {
                const r = await testHostOp(base, lease, { op: "p9", person: OWNER, chat: chatId, call });
                if (!r) throw new InfraError("SLOT_MISSING", "this slot serves no test host; `pnpm preview up` deploys one");
                return call === "read" ? (r as unknown as P9State) : null;
              },
              (fields) => postCapture(base, cookie, fields),
              () => p5.readers.prompts(),
              new URL(base).origin,
              p9Page(base, cookie),
              () => randomUUID(),
            )
          : null;
      // A payments task (F39), over P9's: Sam's grant rows reset, chat c1's cards with their words, her grants, journal
      // rows and jobs through the `p12` op, read again after each turn; the reloads and `/settings` in Chromium.
      const p12 =
        task?.cluster === "P12" && p5
          ? p12Slot(
              () => chatId,
              async (call) => {
                const r = await testHostOp(base, lease, { op: "p12", person: OWNER, chat: chatId, call });
                if (!r) throw new InfraError("SLOT_MISSING", "this slot serves no test host; `pnpm preview up` deploys one");
                return call === "read" ? (r as unknown as P12State) : null;
              },
              () => (state as TestHostState | null)?.log.egress ?? [],
              p5.readers,
              new URL(base).origin,
              p12Page(base, cookie),
            )
          : null;
      // An identity task (F41): Sam's standing files reset and a second passkey seeded, then her memory, the objects'
      // table counts, the chat model calls, her mail rows and the chat's requests through the `p14` op, read again after
      // each turn; the drawn name, the reloads and `/settings` in Chromium.
      const p14 =
        task?.cluster === "P14"
          ? p14Slot(
              () => chatId,
              () => entriesOf(),
              () => history(base, chatId, cookie),
              async (call) => {
                const r = await testHostOp(base, lease, { op: "p14", person: OWNER, chat: chatId, call });
                if (!r) throw new InfraError("SLOT_MISSING", "this slot serves no test host; `pnpm preview up` deploys one");
                return call === "read" ? (r as unknown as P14State) : null;
              },
              p14Page(base, cookie),
              new URL(base).origin,
              OWNER,
            )
          : null;
      const settled = (deadline: number) => async () => {
        await p3?.settle(deadline);
        await p5?.settle(deadline);
      };
      let prompted = false;
      const after = async (label: ChatLabel, turn = `prompt:${label}`) => {
        histories.set(label, await history(base, chats.get(label) as string, cookie));
        await refresh();
        await p3?.refresh();
        await p9?.refresh();
        await p12?.refresh();
        await p14?.refresh();
        await p6?.refresh(`prompt:${label}`);
        await p7?.refresh(turn.startsWith("prompt") ? "prompt" : turn);
      };
      const world: SlotWorld = {
        chatId,
        replies,
        snapshot: () => EMPTY_SNAPSHOT,
        reactions: () => reactionsOf(entriesOf(), OWNER),
        ...testHostReaders(() => entriesOf(), () => state, baseline),
        ...(p6?.readers ?? {}),
        entries: (label?: ChatLabel) => (p6 ? p6.readers.entries(label) : entriesOf(label)) as SlotEntry[],
        async send(text, label = "c1", wait = false) {
          const chat = label as ChatLabel;
          if (!chats.has(chat)) chats.set(chat, await openChat());
          // A P7 prompt is sent early in a minute, so a time it asks for "in five minutes" resolves in the minute it was
          // asked (a turn's first tool call comes seconds later); the trial starts when it is sent.
          if (p7 && !prompted) {
            const into = Date.now() % 60_000;
            if (into > MINUTE_EARLY_MS) await new Promise((r) => setTimeout(r, 60_000 - into + 500));
            p7.started(Date.now());
          }
          prompted = true;
          const sent = Date.now();
          const reply = await turn(base, chats.get(chat) as string, cookie, text, TURN_TIMEOUT_MS, p7 ? ZONE : "UTC");
          replies.push(reply);
          // A P5 request is over when its task is: the sub-agents it launched handed off and the turn they woke ended; a P3
          // one when nothing it started is out (F34). A `prompt` event with `wait` leaves its sub-agents running.
          if (!wait)
            await settled(sent + TURN_TIMEOUT_MS)().catch((e: Error) => {
              throw e instanceof InfraError ? e : new TurnError("TURN_TIMEOUT", e.message);
            });
          await after(chat);
          return reply;
        },
        async event(name, payload) {
          // A P14 event (F41, scripts/evals/p14-slot.ts): the chat looked at or reloaded at a width, a settings route opened.
          if (p14 && (await p14.event(name, payload))) {
            await after("c1", `event:${name}`);
            return;
          }
          // A P12 event (F39, scripts/evals/p12-slot.ts): the chat reloaded at a width, `/settings` opened and reloaded.
          if (p12 && (await p12.event(name, payload))) {
            await after("c1", `event:${name}`);
            return;
          }
          // A P9 event (F37, scripts/evals/p9-slot.ts): two tabs on one send, a reload at a width, a settings page opened.
          if (p9) {
            const deadline = Date.now() + TURN_TIMEOUT_MS;
            // A turn that never settles is the trial's failure, as a prompt's is, not a crash of the run (F39).
            const played = await p9.event(name, payload, settled(deadline)).catch((e: Error) => {
              throw e instanceof InfraError || e instanceof TurnError ? e : new TurnError("TURN_TIMEOUT", e.message);
            });
            if (played) {
              await after("c1", `event:${name}`);
              return;
            }
          }
          if (p7 && name === "tick") {
            await settleTick(base, chatId, cookie, p7, payload.job);
            await after("c1", "event:tick");
            return;
          }
          if (p7 && name === "reload") {
            await after("c1", "event:reload");
            return;
          }
          // A P5 `open` (F32): Sam opens the tab or the row again; every read of the world is fresh, so it is a re-read.
          if (p5 && name === "open") {
            await after("c1", "event:open");
            return;
          }
          // A `prompt` event (F34): Sam's message, as a prompt turn is sent; with `wait`, its sub-agents left running.
          if (name === "prompt") {
            await world.send(payload.text ?? "", payload.chat ?? "c1", payload.wait === "yes");
            return;
          }
          // A P3 event (F34, scripts/evals/p3-slot.ts): a steer or a Stop while a child runs, the children waited out, a reload.
          if (p3) {
            const deadline = Date.now() + TURN_TIMEOUT_MS;
            const played = await p3
              .event(name, payload, (text) => world.send(text, "c1", true), deadline)
              .catch((e: Error) => {
                throw e instanceof InfraError ? e : new TurnError("TURN_TIMEOUT", e.message);
              });
            if (played) {
              await settled(deadline)();
              await after("c1", `event:${name}`);
              return;
            }
          }
          if (name !== "decide") throw new TurnError("EVENT_UNSUPPORTED", name);
          const cards = entriesOf().filter((e) => e.kind === "card" && e.card);
          // Unnamed (F30), the one pending card, as the tier-1 harnesses decide every pending card.
          const card = payload.card === "first" ? cards[0]?.card : payload.card === undefined ? cards.find((e) => e.card?.state === "pending")?.card : cards.find((e) => e.card?.id === payload.card)?.card;
          if (!card) throw new TurnError("DECIDE_NO_CARD", `the chat has no card ${payload.card ?? ""} to decide`);
          await decide(base, chatId, cookie, card.id, payload.choice ?? "");
          await after("c1", "event:decide");
        },
        async read(path) {
          const r = await http(base, "GET", path, { cookie });
          return { status: r.res.status, body: r.body };
        },
      };
      // The P7 readers keep their getters (an unread one throws when read, not when the world is made).
      if (p7) Object.defineProperties(world, Object.getOwnPropertyDescriptors(p7.readers));
      if (p5) {
        Object.defineProperties(world, Object.getOwnPropertyDescriptors(p5.readers));
        Object.defineProperties(world, { during: Object.getOwnPropertyDescriptor(p5, "during") as PropertyDescriptor, before: Object.getOwnPropertyDescriptor(p5, "before") as PropertyDescriptor });
      }
      if (p3) Object.defineProperties(world, Object.getOwnPropertyDescriptors(p3.readers));
      if (p9) {
        Object.defineProperties(world, Object.getOwnPropertyDescriptors(p9.readers));
        Object.defineProperties(world, { tabs: { get: () => p9.tabs }, marks: { get: () => p9.marks }, submitted: { get: () => p9.submitted } });
        if (task) await p9.begin(task.id, (text) => world.send(text));
      }
      if (p12) {
        Object.defineProperties(world, Object.getOwnPropertyDescriptors(p12.readers));
        if (task) await p12.begin(task.id, (text) => world.send(text));
      }
      if (p14) {
        Object.defineProperties(world, Object.getOwnPropertyDescriptors(p14.readers));
        await p14.begin();
      }
      return world;
    },
  };
  return slot;
}
