// Runs one model-written script as a Dynamic Worker from the person's `Chat` object (D2, AD-8 as
// amended at M25.5): the Worker Loader is bound on the tenant agent script, and the loader is called
// from the object, the one path M25.1 measured to take a stub as `globalOutbound`. Every Dynamic
// Worker's `globalOutbound` is the agent script's `Egress` entrypoint with this tenant and person in
// its props (`code/egress.ts`), so each fetch() and connect() of the code reaches only the Vault's
// egress module, for this person. The script is wrapped into a module, the module and its config are
// hashed into the loader id with the tenant and the person, so the same script for the same person
// reuses one Dynamic Worker and no two people ever share one (each is bound to its own person's
// egress). Credentials the script asks for arrive as surrogates the Vault mints for the person; its
// result comes back as JSON, bounded.
import type { HostFailure } from "@qyvr/host";

export const COMPATIBILITY_DATE = "2026-10-01";
export const WRAPPER_VERSION = "2";
export const SCRIPT_MAX = 64 * 1024;
export const INPUT_MAX = 256 * 1024;
export const RESULT_MAX = 64 * 1024;
export const CREDENTIALS_MAX = 8;
export const LIMITS = { cpuMs: 5_000, subRequests: 20 };
export const MAIN_MODULE = "index.js";

export interface RunRequest {
  /** JavaScript: the body of an async function `(input, console, credentials)` that returns a JSON value. */
  script: string;
  /** JSON passed to the script as `input`. */
  input?: unknown;
  /** References (`cred://…`) of the person's credentials; the script gets a surrogate for each, by reference. */
  credentials?: string[];
}

export type RunFailure = {
  ok: false;
  code:
    | "CODE_SCRIPT_EMPTY"
    | "CODE_SCRIPT_TOO_LARGE"
    | "CODE_INPUT_TOO_LARGE"
    | "CODE_INPUT_INVALID"
    | "CODE_CREDENTIAL_REFUSED"
    | "CODE_LOAD_FAILED"
    | "CODE_SCRIPT_THREW"
    | "CODE_RESULT_NOT_JSON"
    | "CODE_RESULT_TOO_LARGE"
    | "CODE_RESULT_UNREADABLE";
  reason: string;
  workerId?: string;
  logs?: string[];
};

export type RunResult =
  | {
      ok: true;
      /** The script's return value, JSON. */
      result: unknown;
      logs: string[];
      /** `<tenant>:<sha256 of the person, the module and its config>`: the Dynamic Worker's cache id. */
      workerId: string;
      /** True when this call compiled the Worker; false when the loader reused one. */
      loaded: boolean;
    }
  | RunFailure
  /** HOST_CODE_UNAVAILABLE: the deploy has no Worker Loader binding (`codeFor`). */
  | HostFailure;

/** What the runner needs of the loader; the real `LOADER` binding and a test fake both fit. */
export interface LoaderLike {
  get(id: string, getCode: () => Promise<WorkerLoaderWorkerCode>): { getEntrypoint(): { fetch(request: Request): Promise<Response> } };
}

export interface RunDeps {
  loader: LoaderLike;
  tenant: string;
  person: string;
  /** The `Egress` entrypoint with this tenant and person in its props: the code's only network. */
  outbound: Fetcher;
  /** A surrogate for one of the person's credentials (`Vault.surrogate`); a refusal carries its code. */
  surrogate(ref: string): Promise<{ ok: true; token: string } | { ok: false; code: string; reason: string }>;
}

/** Code Mode for one person, as `code_execute` calls it. */
export interface CodeApi {
  run(req: RunRequest): Promise<RunResult>;
}

/** The module around the script: a function body with `input`, a capturing `console` and the surrogates by reference. */
export function wrapScript(script: string): string {
  return [
    "export default {",
    "  async fetch(request) {",
    "    const logs = [];",
    '    const log = (...a) => { logs.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")); };',
    "    const console = { log, info: log, warn: log, error: log, debug: log };",
    "    let input, credentials;",
    '    try { ({ input, credentials } = await request.json()); } catch { return Response.json({ ok: false, code: "CODE_INPUT_INVALID", reason: "input is not JSON", logs }); }',
    "    let result;",
    "    try {",
    "      result = await (async (input, console, credentials) => {",
    script,
    "      })(input, console, credentials);",
    '    } catch (err) { return Response.json({ ok: false, code: "CODE_SCRIPT_THREW", reason: String((err && err.message) || err), logs }); }',
    "    let text;",
    '    try { text = JSON.stringify(result === undefined ? null : result); } catch (err) { return Response.json({ ok: false, code: "CODE_RESULT_NOT_JSON", reason: String((err && err.message) || err), logs }); }',
    '    if (text === undefined) text = "null";',
    '    return new Response(JSON.stringify({ ok: true, resultText: text, logs }), { headers: { "content-type": "application/json" } });',
    "  },",
    "};",
    "",
  ].join("\n");
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The loader id: the tenant, then a hash of the person and everything that shapes the Worker. */
export async function workerId(tenant: string, person: string, moduleText: string): Promise<string> {
  const config = JSON.stringify({ v: WRAPPER_VERSION, compatibilityDate: COMPATIBILITY_DATE, limits: LIMITS, main: MAIN_MODULE, person });
  return `${tenant}:${await sha256Hex(`${config}\n${moduleText}`)}`;
}

const fail = (code: RunFailure["code"], reason: string, extra: Partial<RunFailure> = {}): RunFailure => ({ ok: false, code, reason, ...extra });

export async function runScript(deps: RunDeps, req: RunRequest): Promise<RunResult> {
  const script = typeof req?.script === "string" ? req.script : "";
  if (!script.trim()) return fail("CODE_SCRIPT_EMPTY", "the script is empty");
  if (script.length > SCRIPT_MAX) return fail("CODE_SCRIPT_TOO_LARGE", `${script.length} characters; the limit is ${SCRIPT_MAX}`);
  const refs = [...new Set(Array.isArray(req.credentials) ? req.credentials.map(String) : [])];
  if (refs.length > CREDENTIALS_MAX) return fail("CODE_CREDENTIAL_REFUSED", `at most ${CREDENTIALS_MAX} credentials a run`);
  const credentials: Record<string, string> = {};
  for (const ref of refs) {
    const minted = await deps.surrogate(ref);
    if (!minted.ok) return fail("CODE_CREDENTIAL_REFUSED", `${ref}: ${minted.code}: ${minted.reason}`);
    credentials[ref] = minted.token;
  }
  let inputText: string;
  try {
    inputText = JSON.stringify({ input: req.input === undefined ? null : req.input, credentials }) ?? "null";
  } catch (err) {
    return fail("CODE_INPUT_INVALID", String(err instanceof Error ? err.message : err));
  }
  if (inputText.length > INPUT_MAX) return fail("CODE_INPUT_TOO_LARGE", `${inputText.length} characters; the limit is ${INPUT_MAX}`);

  const moduleText = wrapScript(script);
  const id = await workerId(deps.tenant, deps.person, moduleText);
  let loaded = false;
  const stub = deps.loader.get(id, async () => {
    loaded = true;
    return {
      compatibilityDate: COMPATIBILITY_DATE,
      mainModule: MAIN_MODULE,
      modules: { [MAIN_MODULE]: moduleText },
      // The code's fetch() and connect() reach only the egress module, for this person.
      globalOutbound: deps.outbound,
      limits: LIMITS,
    };
  });

  let response: Response;
  try {
    response = await stub.getEntrypoint().fetch(new Request("https://code.invalid/run", { method: "POST", headers: { "content-type": "application/json" }, body: inputText }));
  } catch (err) {
    return fail("CODE_LOAD_FAILED", String(err instanceof Error ? err.message : err), { workerId: id });
  }
  let body: { ok?: boolean; code?: RunFailure["code"]; reason?: string; resultText?: string; logs?: string[] };
  try {
    body = (await response.json()) as typeof body;
  } catch {
    return fail("CODE_RESULT_UNREADABLE", "the Worker's reply was not JSON", { workerId: id });
  }
  const logs = Array.isArray(body.logs) ? body.logs.map(String).slice(0, 200) : [];
  if (!body.ok) return fail(body.code ?? "CODE_SCRIPT_THREW", body.reason ?? "the script failed", { workerId: id, logs });
  const text = typeof body.resultText === "string" ? body.resultText : "null";
  if (text.length > RESULT_MAX) return fail("CODE_RESULT_TOO_LARGE", `${text.length} characters; the limit is ${RESULT_MAX}`, { workerId: id, logs });
  return { ok: true, result: JSON.parse(text), logs, workerId: id, loaded };
}

export function codeApi(deps: RunDeps): CodeApi {
  return { run: (req) => runScript(deps, req) };
}
