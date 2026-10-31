// `pnpm dev`: the agent Worker under `wrangler dev`, with no deploy and no `pnpm self-host`. Durable Objects and R2 run
// locally; Vectorize has no local mode (semantic memory search is off) and Workers AI has none either, so by default
// the `AI` binding is left out and the model routes fail while the login page, passkeys, the recovery code, files and
// memory work. `--remote-ai` keeps the binding, which wrangler then proxies to the account in CLOUDFLARE_API_TOKEN and
// CLOUDFLARE_ACCOUNT_ID (a token with Workers Scripts Edit and Workers AI Read; usage counts against that account).
// The base config's model vars come with it, so chat goes to Muse Spark through the gateway they name, which must
// exist on that account with its Meta key stored.
//
//   pnpm dev [--port 8787] [--owner-email sam@solo-sam.example] [--remote-ai]
//
// It writes two git-ignored files beside the agent: `wrangler.dev.jsonc` (the base config with this run's owner) and
// `.wrangler/dev.vars` (MASTER_KEY and SETUP_TOKEN, minted once and kept beside the local state they unlock, so the
// passkeys and data survive a restart), passed with --env-file. Not `.dev.vars`: `wrangler types` reads that file, and
// the secrets it adds to Env break the agent's typecheck. Local state is in packages/agent/.wrangler/; delete it to
// start over. Without --remote-ai, every CLOUDFLARE_ variable
// is dropped from wrangler's environment, so nothing reaches an account.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { root } from "./accept.ts";

const AGENT = join(root, "packages/agent");
/** 32 random bytes, base64url: the shape `pnpm self-host` mints MASTER_KEY and SETUP_TOKEN in (`mintSecrets` in scripts/preview-plan.mjs). */
const random32 = () => randomBytes(32).toString("base64url");

/** The base wrangler.jsonc as this run's config: its own name and owner, and the AI binding only when asked. */
export function devConfig(base: string, opts: { ownerEmail: string; remoteAi: boolean }): Record<string, unknown> {
  const config = JSON.parse(base.replace(/^\s*\/\/.*$/gm, "")) as Record<string, unknown> & { vars: Record<string, string> };
  if (!opts.remoteAi) delete config.ai;
  return { ...config, name: "fletch-dev", vars: { ...config.vars, OWNER_EMAIL: opts.ownerEmail } };
}

/** The dev vars file with MASTER_KEY and SETUP_TOKEN: the ones already there are kept, a missing one is minted. */
export function devVars(existing: string, mint: { master: () => string; setup: () => string }): { text: string; setupToken: string } {
  const vars = new Map(existing.split("\n").flatMap((line) => (/^\w+=/.test(line) ? [[line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)] as const] : [])));
  if (!vars.get("MASTER_KEY")) vars.set("MASTER_KEY", mint.master());
  if (!vars.get("SETUP_TOKEN")) vars.set("SETUP_TOKEN", mint.setup());
  return { text: `${[...vars].map(([k, v]) => `${k}=${v}`).join("\n")}\n`, setupToken: vars.get("SETUP_TOKEN") ?? "" };
}

function read(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({ options: { port: { type: "string", default: "8787" }, "owner-email": { type: "string", default: "sam@solo-sam.example" }, "remote-ai": { type: "boolean", default: false } } });
  const config = devConfig(readFileSync(join(AGENT, "wrangler.jsonc"), "utf8"), { ownerEmail: values["owner-email"], remoteAi: values["remote-ai"] });
  writeFileSync(join(AGENT, "wrangler.dev.jsonc"), `${JSON.stringify(config, null, 2)}\n`);
  const varsFile = join(AGENT, ".wrangler/dev.vars");
  const vars = devVars(read(varsFile), { master: random32, setup: random32 });
  mkdirSync(dirname(varsFile), { recursive: true });
  writeFileSync(varsFile, vars.text, { mode: 0o600 });

  const env: NodeJS.ProcessEnv = { ...process.env, WRANGLER_BUILD_CONDITIONS: "development", WRANGLER_SEND_METRICS: "false" };
  if (!values["remote-ai"]) for (const name of Object.keys(env)) if (name.startsWith("CLOUDFLARE_")) delete env[name];
  console.log(`fletch dev: owner ${values["owner-email"]}, AI ${values["remote-ai"] ? "remote" : "off (pass --remote-ai)"}`);
  console.log(`fletch dev: first passkey at http://localhost:${values.port}/login?setup=${vars.setupToken}`);
  const child = spawn("pnpm", ["exec", "wrangler", "dev", "-c", "wrangler.dev.jsonc", "--env-file", varsFile, "--port", values.port], { cwd: AGENT, env, stdio: "inherit" });
  child.on("exit", (code) => process.exit(code ?? 1));
}
