// The F1 exit test: a scripted deploy into a throwaway Cloudflare account, then the ten-minute path as a user
// walks it. Run it only by hand or from .github/workflows/live-deploy.yml:
//
//   QYVR_LIVE=1 CF_LIVE_ACCOUNT_ID=... CF_LIVE_TOKEN=... pnpm vitest run test/live/f1-deploy.live.test.ts
//
// `init()` from create-fletch deploys a Worker named `fletch-ci-<run id>` (free plan, so `paid: false`), the file
// then drives it over HTTPS: health, the refused and open pages, a software passkey, the setup token, the recovery
// code, a memory round trip through the chat socket, the last-passkey rule and the single-use recovery code.
// `afterAll` deletes the Worker, the bucket `<name>-agent` and the index `<name>-memory`, whatever happened, and only
// names that start with `fletch-ci-` (lib.ts). The wall-clock time of the whole path is printed, not asserted.
//
// The vitest config collects this file only when QYVR_LIVE=1; the hermetic lane never sees it, and
// the hermetic setup (which refuses any credential variable) is not loaded for it.
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CloudflareApi, statusOf } from "@qyvr/host-cloudflare";
import { afterAll, describe, expect, it } from "vitest";
import { init } from "../../packages/create-fletch/src/init.ts";
import { softAuthenticator } from "../support/soft-authenticator.ts";
import { parseSetupLink, planCleanup, runIdFrom, workerNameFor } from "./lib.ts";

const ACCOUNT_ID = process.env.CF_LIVE_ACCOUNT_ID ?? "";
const TOKEN = process.env.CF_LIVE_TOKEN ?? "";
const NAME = workerNameFor(runIdFrom(process.env, Date.now()));
const OWNER_EMAIL = "sam@solo-sam.example";
const OBJECTS = 7;

const MINUTE = 60_000;
const t0 = Date.now();

type Json = Record<string, unknown>;
const state: { dir: string; url: string; setup: string; cookie: string; recovery: string; keyA?: Awaited<ReturnType<typeof softAuthenticator>>; keyB?: Awaited<ReturnType<typeof softAuthenticator>> } = {
  dir: "",
  url: "",
  setup: "",
  cookie: "",
  recovery: "",
};
const lines: string[] = [];

/** A pause that ends when a timeout signal aborts: the live lane waits on Cloudflare, the hermetic lane never runs this. */
const pause = (ms: number) => new Promise<void>((done) => AbortSignal.timeout(ms).addEventListener("abort", () => done()));

async function http(method: string, path: string, opts: { body?: unknown; cookie?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (method !== "GET") headers.origin = new URL(state.url).origin;
  if (opts.cookie) headers.cookie = opts.cookie;
  const res = await fetch(state.url + path, { method, headers, ...(method === "GET" ? {} : { body: JSON.stringify(opts.body ?? {}) }), signal: AbortSignal.timeout(60_000), redirect: "manual" });
  const text = await res.text();
  let body: Json = {};
  try {
    body = text ? (JSON.parse(text) as Json) : {};
  } catch {
    body = {};
  }
  return { res, text, body };
}

const cookieOf = (res: Response) => {
  const m = (res.headers.get("set-cookie") ?? "").match(/fletch_session=([^;]+)/);
  return m ? `fletch_session=${m[1]}` : "";
};

/** Registers a passkey through the real routes. The first needs the setup token; later ones the owner's session. */
async function registerPasskey(key: NonNullable<typeof state.keyA>, auth: { setup: string } | { cookie: string }) {
  const setup = "setup" in auth ? { setup: auth.setup } : {};
  const cookie = "cookie" in auth ? auth.cookie : undefined;
  const o = await http("POST", "/login/register/options", { body: setup, ...(cookie ? { cookie } : {}) });
  expect(o.res.status, o.text).toBe(200);
  const done = await http("POST", "/login/register/verify", { body: { ...setup, challengeId: o.body.challengeId, credential: await key.create(o.body.options as { challenge: string }) }, ...(cookie ? { cookie } : {}) });
  expect(done.res.status, done.text).toBe(200);
  expect(done.body.ok).toBe(true);
  return { cookie: cookieOf(done.res), recoveryCode: done.body.recoveryCode as string | undefined };
}

/** One turn over the chat socket: sends `text`, resolves with the reply once the turn is done, rejects on a failed or refused one. */
function turn(chatId: string, cookie: string, text: string): Promise<string> {
  const wsUrl = `${state.url.replace(/^http/, "ws")}/chats/${chatId}/ws`;
  // Node's WebSocket (undici) takes request headers in its init object; the session is the cookie.
  const Socket = WebSocket as unknown as new (url: string, init: { headers: Record<string, string> }) => WebSocket;
  const ws = new Socket(wsUrl, { headers: { cookie } });
  const id = randomUUID();
  return new Promise<string>((resolve, reject) => {
    let reply = "";
    const named: string[] = [];
    const fail = (why: string) => {
      ws.close();
      reject(new Error(why));
    };
    AbortSignal.timeout(4 * MINUTE).addEventListener("abort", () => fail(`the turn did not finish in 4 minutes (reply so far: ${reply.slice(0, 200)})`));
    ws.addEventListener("error", () => fail(`the chat socket failed: ${wsUrl}`));
    ws.addEventListener("open", () => ws.send(JSON.stringify({ type: "send", text, id, timeZone: "UTC" })));
    ws.addEventListener("message", (event) => {
      const frame = JSON.parse(String(event.data)) as { type: string; text?: string; code?: string; reason?: string; messages?: { who: string; text: string }[] };
      if (frame.type === "delta" || frame.type === "message") reply += frame.text ?? "";
      else if (frame.type === "named") {
        for (const m of frame.messages ?? []) if (m.who === "agent") named.push(m.text);
      } else if (frame.type === "refused" || frame.type === "turn_failed") fail(`${frame.type}: ${frame.code ?? ""} ${frame.reason ?? frame.text ?? ""}`);
      else if (frame.type === "turn_done") {
        ws.close();
        resolve(reply || named.join("\n"));
      }
    });
  });
}

describe("[F1] the ten-minute path", () => {
  it("has the account and token it needs", () => {
    expect(ACCOUNT_ID, "set CF_LIVE_ACCOUNT_ID").toMatch(/^[0-9a-f]{32}$/);
    expect(TOKEN, "set CF_LIVE_TOKEN").not.toBe("");
  });

  it("init deploys a Worker named fletch-ci-<run id> and prints the setup link", { timeout: 15 * MINUTE }, async () => {
    state.dir = mkdtempSync(join(tmpdir(), "fletch-live-"));
    const result = await init({ accountId: ACCOUNT_ID, token: TOKEN, name: NAME, ownerEmail: OWNER_EMAIL, paid: false, cwd: state.dir }, { log: (line) => lines.push(line) });
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
    if (!result.ok) return;
    const link = parseSetupLink(lines.join("\n"));
    expect(link, "init printed no /login?setup= link").not.toBeNull();
    expect(link?.url).toBe(result.url);
    state.url = result.url;
    state.setup = link?.token ?? "";
  });

  it("GET /health is 200 and lists seven objects", { timeout: 5 * MINUTE }, async () => {
    // A fresh workers.dev route can take a little while to answer; wait for the first 200, never loop on a failing assertion.
    let last = "";
    for (let waited = 0; waited < 3 * MINUTE; waited += 5_000) {
      const r = await http("GET", "/health").catch((e: Error) => ({ res: { status: 0 } as Response, text: e.message, body: {} as Json }));
      last = `${r.res.status} ${r.text.slice(0, 200)}`;
      if (r.res.status === 200) {
        expect(r.body.ok).toBe(true);
        expect(r.body.objects).toHaveLength(OBJECTS);
        return;
      }
      await pause(5_000);
    }
    throw new Error(`/health never answered 200: ${last}`);
  });

  it("GET /app/chats without a session is 401 SESSION_MISSING", async () => {
    const r = await http("GET", "/app/chats");
    expect(r.res.status).toBe(401);
    expect(r.body.code).toBe("SESSION_MISSING");
  });

  it("GET /login?setup=... is 200 HTML in the register state", async () => {
    const r = await http("GET", `/login?setup=${state.setup}`);
    expect(r.res.status).toBe(200);
    expect(r.res.headers.get("content-type")).toMatch(/text\/html/);
    expect(r.text).toContain('data-state="register"');
    const bare = await http("GET", "/login");
    expect(bare.text).toContain('data-state="setup"');
  });

  it("registers a passkey with the setup token and receives a recovery code", async () => {
    const origin = new URL(state.url);
    state.keyA = await softAuthenticator(origin.origin, origin.hostname);
    const first = await registerPasskey(state.keyA, { setup: state.setup });
    expect(first.cookie).not.toBe("");
    expect(first.recoveryCode?.replaceAll("-", "")).toHaveLength(20);
    state.cookie = first.cookie;
    state.recovery = first.recoveryCode as string;
    const signedIn = await http("GET", "/app/chats", { cookie: state.cookie });
    expect(signedIn.res.status, signedIn.text).toBe(200);
  });

  it("remembers that the favourite colour is teal, and says so in a new chat", { timeout: 10 * MINUTE }, async () => {
    const opened = async () => {
      const r = await http("POST", "/chats", { cookie: state.cookie });
      expect(r.res.status, r.text).toBe(201);
      return r.body.chatId as string;
    };
    await turn(await opened(), state.cookie, "remember that my favourite colour is teal");
    const answer = await turn(await opened(), state.cookie, "what is my favourite colour");
    expect(answer.toLowerCase()).toContain("teal");
  });

  it("refuses to delete the only passkey, then deletes one of two and signs in with the recovery code once", { timeout: 5 * MINUTE }, async () => {
    const keyA = state.keyA as NonNullable<typeof state.keyA>;
    const only = await http("DELETE", `/login/passkeys/${encodeURIComponent(keyA.id)}`, { cookie: state.cookie });
    expect(only.res.status).toBe(409);
    expect(only.body.code).toBe("LOGIN_LAST_PASSKEY");

    const origin = new URL(state.url);
    state.keyB = await softAuthenticator(origin.origin, origin.hostname);
    const second = await registerPasskey(state.keyB, { cookie: state.cookie });
    state.cookie = second.cookie;
    expect(second.recoveryCode).toBeUndefined();
    const listed = await http("GET", "/login/passkeys", { cookie: state.cookie });
    expect((listed.body.passkeys as { id: string }[]).map((p) => p.id).toSorted()).toEqual([keyA.id, state.keyB.id].toSorted());

    const removed = await http("DELETE", `/login/passkeys/${encodeURIComponent(keyA.id)}`, { cookie: state.cookie });
    expect(removed.res.status, removed.text).toBe(204);
    const after = await http("GET", "/login/passkeys", { cookie: state.cookie });
    expect((after.body.passkeys as { id: string }[]).map((p) => p.id)).toEqual([state.keyB.id]);

    // The recovery code: a session good only under /login, and good once.
    const recovered = await http("POST", "/login/recover", { body: { email: OWNER_EMAIL, code: state.recovery } });
    expect(recovered.res.status, recovered.text).toBe(200);
    expect(recovered.body).toEqual({ ok: true, needsPasskey: true });
    const gated = await http("GET", "/app/chats", { cookie: cookieOf(recovered.res) });
    expect([gated.res.status, gated.body.code]).toEqual([403, "PASSKEY_REQUIRED"]);
    const spent = await http("POST", "/login/recover", { body: { email: OWNER_EMAIL, code: state.recovery } });
    expect(spent.res.status).toBe(403);
    expect(spent.body.code).toBe("RECOVERY_CODE_SPENT");
  });

  it("prints the wall-clock time", () => {
    const seconds = Math.round((Date.now() - t0) / 1000);
    console.log(`F1 live: ${NAME} took ${Math.floor(seconds / 60)} min ${seconds % 60} s from the first step to here (the ten-minute claim is measured, not asserted)`);
  });
});

afterAll(async () => {
  if (state.dir) rmSync(state.dir, { recursive: true, force: true });
  if (!ACCOUNT_ID || !TOKEN) return;
  const plan = planCleanup(ACCOUNT_ID, NAME);
  if (!plan.ok) throw new Error(`cleanup refused: ${plan.reason}`);
  const cf = new CloudflareApi(TOKEN);
  const leaked: string[] = [];
  for (const step of plan.steps) {
    try {
      await cf.call(step.method, step.path);
      console.log(`cleanup: deleted ${step.kind} ${step.name}`);
    } catch (error) {
      // 404: it was never created, or already gone. Anything else is left behind and said so.
      if (statusOf(error) === 404) console.log(`cleanup: ${step.kind} ${step.name} was not there`);
      else leaked.push(`${step.kind} ${step.name}: ${(error as Error).message.replaceAll(TOKEN, "[token]")}`);
    }
  }
  if (leaked.length) throw new Error(`cleanup left resources behind, delete them by hand:\n${leaked.join("\n")}`);
}, 5 * MINUTE);
