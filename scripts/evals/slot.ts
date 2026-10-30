// The worktree's preview slot as the tier-2 runner's `Slot` (F19): the lease `pnpm preview up` left in
// <git common dir>/fletch-previews/, the slot's host from the pool's subdomain, a session obtained as the live exit
// test obtains one (test/live/f1-deploy.live.test.ts: the software passkey, test/support/soft-authenticator.ts), and
// one chat per trial driven over the chat socket. Every failure here is the slot's, an `InfraError` by code:
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
import { EMPTY_SNAPSHOT, InfraError, reactionsOf, type SlotEntry, type SlotWorld, TurnError } from "../../test/support/evals.ts";
import { type TestHostState, testHostReaders } from "./test-host.ts";
import { type SavedPasskey, softAuthenticator } from "../../test/support/soft-authenticator.ts";
import { origin as originOf, ownerTag, SLOT_OWNER, slotPlan } from "../preview-plan.mjs";
import { knownSubdomain, readJson } from "../preview-pool.mjs";
import type { Slot } from "./runner.ts";

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
export function turn(base: string, chatId: string, cookie: string, text: string, timeoutMs = TURN_TIMEOUT_MS): Promise<string> {
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
    ws.addEventListener("open", () => ws.send(JSON.stringify({ type: "send", text, id, timeZone: "UTC" })));
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

/** The test-host op as the lease's holder; null when the slot serves no test host. */
async function testHostOp(base: string, lease: Lease, body: Record<string, unknown>): Promise<Json | null> {
  const r = await http(base, "POST", "/__preview/test-host", { body, headers: { "x-preview-tag": lease.tag, "x-preview-key": lease.key } });
  if (r.res.status === 404) return null;
  if (r.res.status !== 200) throw new InfraError("LEASE_LAPSED", `the test host answered ${r.res.status} to this worktree's key`);
  return r.body;
}

/** The fixture login T-P15-15 reads: saved once on the slot through the capture form as its owner, for login.example.test. */
export const FIXTURE_LOGIN = { ref: "cred://site-login", host: "login.example.test" } as const;

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
    async open(): Promise<SlotWorld> {
      await slot.resolve();
      if (failure) throw failure;
      const { dir, lease, base } = resolved as NonNullable<typeof resolved>;
      const cookie = await signIn(base, lease, sessionPath(dir, lease.tag));
      const opened = await http(base, "POST", "/chats", { cookie });
      if (opened.res.status === 401) throw new InfraError("SESSION_UNAVAILABLE", "the session was refused when opening a chat");
      if (opened.res.status !== 201) throw new InfraError("SLOT_5XX", `POST /chats answered ${opened.res.status} ${String(opened.body.code ?? "")}`);
      const chatId = opened.body.chatId as string;
      const replies: string[] = [];
      let entries: SlotEntry[] = [];
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
      const after = async () => {
        entries = await history(base, chatId, cookie);
        await refresh();
      };
      return {
        chatId,
        replies,
        snapshot: () => EMPTY_SNAPSHOT,
        entries: () => entries,
        reactions: () => reactionsOf(entries, OWNER),
        ...testHostReaders(() => entries, () => state, baseline),
        async send(text) {
          const reply = await turn(base, chatId, cookie, text);
          replies.push(reply);
          await after();
          return reply;
        },
        async event(name, payload) {
          if (name !== "decide") throw new TurnError("EVENT_UNSUPPORTED", name);
          const cards = entries.filter((e) => e.kind === "card" && e.card);
          const card = payload.card === "first" ? cards[0]?.card : cards.find((e) => e.card?.id === payload.card)?.card;
          if (!card) throw new TurnError("DECIDE_NO_CARD", `the chat has no card ${payload.card ?? ""} to decide`);
          await decide(base, chatId, cookie, card.id, payload.choice ?? "");
          await after();
        },
        async read(path) {
          const r = await http(base, "GET", path, { cookie });
          return { status: r.res.status, body: r.body };
        },
      };
    },
  };
  return slot;
}
