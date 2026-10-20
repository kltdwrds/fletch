// `create-fletch` init: one owner's fletch on one Cloudflare account. It checks the token's scopes, writes the
// deploy's wrangler.jsonc from the template, ensures the bucket and the memory index, runs `wrangler deploy`,
// and sets the MASTER_KEY and SETUP_TOKEN Worker secrets only when the script lacks them, so a second run with
// the same inputs creates nothing, rotates nothing and returns the same URL. The setup link (`/login?setup=`)
// is printed only by the run that minted the token; the token cannot be read back later.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CloudflareApi,
  ensureBucket,
  ensureVectorIndex,
  listSecrets,
  mintMasterKey,
  mintSetupToken,
  putSecret,
  statusOf,
  tokenScopes,
  workersDevUrl,
} from "@qyvr/host-cloudflare";

export interface InitOptions {
  accountId: string;
  token: string;
  name: string;
  ownerEmail: string;
  paid: boolean;
  cwd: string;
}

export type InitResult = { ok: true; url: string } | { ok: false; code: string; reason: string };

/** Runs `wrangler deploy --config <configPath>` with the token and account in `env`. */
export type DeployRunner = (configPath: string, env: { CLOUDFLARE_API_TOKEN: string; CLOUDFLARE_ACCOUNT_ID: string }) => Promise<{ ok: boolean; output: string }>;

export interface InitDeps {
  fetch?: typeof globalThis.fetch;
  deploy?: DeployRunner;
  log?: (line: string) => void;
  /** The agent's entry module; by default the one in this checkout, packages/agent/src/index.ts. */
  agentMain?: string;
}

/** The tenant id rule keyService holds (`TENANT_ID` in @qyvr/host-cloudflare's keys.ts). */
export const NAME = /^[a-z][a-z0-9-]{1,30}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ACCOUNT_ID = /^[0-9a-f]{32}$/;

const HERE = dirname(fileURLToPath(import.meta.url));
export const TEMPLATE = join(HERE, "template", "wrangler.jsonc");
/** The first line of every wrangler.jsonc this tool writes; a file without it is the owner's own and is never overwritten. */
export const CONFIG_HEADER = "// Written by create-fletch for this deploy. Secrets (MASTER_KEY, SETUP_TOKEN) are Worker secrets, never here.\n";
export const AGENT_MAIN = join(HERE, "..", "..", "agent", "src", "index.ts");

/** JSON with `//` and `/* *\/` comments, as wrangler.jsonc is written. Strings are kept whole. */
export function parseJsonc(text: string): unknown {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      const start = i;
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === "\\") i++;
      out += text.slice(start, i + 1);
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      i = text.indexOf("*/", i + 2);
      if (i < 0) throw new Error("unterminated comment");
      i++;
    } else out += c;
  }
  return JSON.parse(out);
}

/** The deploy's config: the template with this deploy's names, and the paid-plan bindings when asked for. */
export function renderConfig(opts: InitOptions, main: string): Record<string, unknown> {
  // One pass with function replacers: a value is inserted as typed (`$&` and `$1` mean nothing) and a value
  // that itself contains a placeholder is not substituted again.
  const values: Record<string, string> = { NAME: opts.name, MAIN: main, ACCOUNT_ID: opts.accountId, OWNER_EMAIL: opts.ownerEmail };
  const fill = (v: unknown): unknown => {
    if (typeof v === "string") return v.replace(/__(NAME|MAIN|ACCOUNT_ID|OWNER_EMAIL)__/g, (_m, key: string) => values[key] as string);
    if (Array.isArray(v)) return v.map(fill);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)]));
    return v;
  };
  const config = fill(parseJsonc(readFileSync(TEMPLATE, "utf8"))) as Record<string, unknown>;
  if (opts.paid) {
    config.worker_loaders = [{ binding: "LOADER" }];
    config.images = { binding: "IMAGES" };
  }
  return config;
}

/** wrangler's output when Cloudflare refuses the deploy for the token: HTTP 403 or API code 10000 (Authentication error). */
const DENIED = /\b403\b|\[code: 10000\]|Authentication error/;
const scopeReason = (scope: string, accountId: string) => `the API token can read but not change ${scope.replace(" (Edit)", "")}: give it the ${scope} permission for account ${accountId} and run again`;

const refuse = (code: string, reason: string): InitResult => ({ ok: false, code, reason });

function validate(opts: InitOptions): InitResult | null {
  if (!NAME.test(opts.name ?? "")) return refuse("NAME_INVALID", `the name "${opts.name ?? ""}" must be 2 to 31 characters of a-z, 0-9 and -, starting with a letter`);
  if (!EMAIL.test(opts.ownerEmail ?? "")) return refuse("OWNER_EMAIL_INVALID", opts.ownerEmail ? `"${opts.ownerEmail}" is not an email address` : "the owner's email address is required: it names the one account that can sign in");
  if (!ACCOUNT_ID.test(opts.accountId ?? "")) return refuse("ACCOUNT_ID_INVALID", "the Cloudflare account id is 32 hexadecimal characters (dashboard, Workers & Pages, right-hand column)");
  if (!opts.token) return refuse("TOKEN_MISSING", "a Cloudflare API token is required: set CLOUDFLARE_API_TOKEN");
  return null;
}

export async function init(input: InitOptions, deps: InitDeps = {}): Promise<InitResult> {
  const opts = { ...input, name: input.name?.trim(), ownerEmail: input.ownerEmail?.trim(), accountId: input.accountId?.trim() };
  const invalid = validate(opts);
  if (invalid) return invalid;
  const log = deps.log ?? ((line: string) => console.log(line));
  const deploy = deps.deploy ?? (await import("./deploy.ts")).wranglerDeploy;
  const cf = new CloudflareApi(opts.token, deps.fetch ? { fetch: deps.fetch } : {});
  const { accountId, name } = opts;
  const scrub = (text: string) => text.replaceAll(opts.token, "[token]");
  const configPath = join(opts.cwd, "wrangler.jsonc");
  if (existsSync(configPath) && !readFileSync(configPath, "utf8").startsWith(CONFIG_HEADER.split("\n")[0] as string)) {
    return refuse("INIT_CONFIG_EXISTS", `${configPath} exists and was not written by create-fletch; move it aside or run in another directory (--dir) so it is not overwritten`);
  }
  // The scope probes prove read access only. Creating a bucket or an index, and the deploy, can still be
  // refused with 403 for a token that holds "Read" without "Edit"; that is mapped to the scope of the step.
  let step: { scope: string } | null = null;

  try {
    const scopes = await tokenScopes(cf, accountId);
    if (!scopes.ok && scopes.invalid) return refuse("TOKEN_INVALID", "Cloudflare does not accept the API token, as a user token or as an account token for this account");
    if (!scopes.ok) return refuse("TOKEN_SCOPE_MISSING", `the API token is missing ${scopes.missing.join(", ")}; add ${scopes.missing.length > 1 ? "those permissions" : "that permission"} to the token for account ${accountId} and run again`);
    log("API token: every needed permission is present.");

    const url = await workersDevUrl(cf, accountId, name);
    if (!url) return refuse("WORKERS_DEV_SUBDOMAIN_MISSING", "the account has no workers.dev subdomain yet; open Workers & Pages in the Cloudflare dashboard once to choose one, then run again");

    const main = relative(opts.cwd, deps.agentMain ?? AGENT_MAIN).split(sep).join("/");
    writeFileSync(configPath, `${CONFIG_HEADER}${JSON.stringify(renderConfig(opts, main), null, 2)}\n`);
    log(`Wrote ${configPath}`);

    step = { scope: "R2" };
    log(`R2 bucket ${await ensureBucket(cf, accountId, `${name}-agent`)}: ready.`);
    step = { scope: "Vectorize" };
    log(`Vectorize index ${await ensureVectorIndex(cf, accountId, `${name}-memory`)}: ready.`);

    step = { scope: "Workers Scripts" };
    const deployed = await deploy(configPath, { CLOUDFLARE_API_TOKEN: opts.token, CLOUDFLARE_ACCOUNT_ID: accountId });
    if (!deployed.ok && DENIED.test(deployed.output)) return refuse("TOKEN_SCOPE_MISSING", scopeReason("Workers Scripts (Edit)", accountId));
    if (!deployed.ok) return refuse("DEPLOY_FAILED", `wrangler deploy failed: ${scrub(deployed.output.trim().split("\n").slice(-20).join("\n")) || "no output"}`);

    step = { scope: "Workers Scripts" };
    const present = new Set(await listSecrets(cf, accountId, name));
    if (!present.has("MASTER_KEY")) {
      await putSecret(cf, accountId, name, "MASTER_KEY", mintMasterKey());
      log("MASTER_KEY: set (a new random key; it is never shown).");
    } else log("MASTER_KEY: already set, kept.");
    let setupToken: string | null = null;
    if (!present.has("SETUP_TOKEN")) {
      setupToken = mintSetupToken();
      await putSecret(cf, accountId, name, "SETUP_TOKEN", setupToken);
    }

    log("");
    log("fletch is deployed:");
    log(url);
    if (setupToken) {
      log("");
      log("Open this link to register your passkey. It is shown only now, so keep it until you have signed in:");
      log(`${url}/login?setup=${setupToken}`);
    } else {
      log("Setup was already done by an earlier run, and its link cannot be shown again. If no passkey was registered,");
      log("set a new SETUP_TOKEN with `wrangler secret put SETUP_TOKEN` and open /login with it as the setup parameter.");
    }
    return { ok: true, url };
  } catch (error) {
    const message = scrub(String((error as Error)?.message ?? error));
    if (message.startsWith("MEMORY_INDEX_SHAPE")) return refuse("MEMORY_INDEX_SHAPE", message.replace(/^MEMORY_INDEX_SHAPE:\s*/, ""));
    const status = statusOf(error);
    if (status === 403 && step) return refuse("TOKEN_SCOPE_MISSING", scopeReason(`${step.scope} (Edit)`, accountId));
    // Only a failed Cloudflare API call carries an HTTP status; a file-system or network error does not.
    return refuse(status === undefined ? "INIT_FAILED" : "CLOUDFLARE_API_ERROR", message);
  }
}
