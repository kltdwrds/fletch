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
import { EMPTY_SNAPSHOT, InfraError, type SlotWorld, TurnError } from "../../test/support/evals.ts";
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
      return {
        chatId,
        replies,
        snapshot: () => EMPTY_SNAPSHOT,
        async send(text) {
          const reply = await turn(base, chatId, cookie, text);
          replies.push(reply);
          return reply;
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
