// The bin's arguments. The API token is read from CLOUDFLARE_API_TOKEN (or prompted for), never from a flag,
// so it stays out of the shell history and the process list. What is not given is left out for the prompts.
import { resolve } from "node:path";
import type { InitOptions } from "./init.ts";

export const USAGE = `usage: create-fletch [--name <name>] [--owner-email <email>] [--account-id <id>] [--dir <path>] [--paid]

  --name         the Worker and tenant name: a-z, 0-9 and -, 2 to 31 characters, starting with a letter
  --owner-email  the owner's email address, the one account that can sign in
  --account-id   the Cloudflare account id (default: CLOUDFLARE_ACCOUNT_ID)
  --dir          where wrangler.jsonc is written (default: the current directory)
  --paid         add the Worker Loader (Code Mode) and Images bindings, which need the Workers Paid plan

The API token is read from CLOUDFLARE_API_TOKEN, or asked for.`;

export type ParsedArgs = { ok: true; opts: Partial<InitOptions> } | { ok: false; reason: string };

const VALUE_FLAGS: Record<string, "name" | "ownerEmail" | "accountId" | "cwd"> = {
  "--name": "name",
  "--owner-email": "ownerEmail",
  "--account-id": "accountId",
  "--dir": "cwd",
};

export function parseArgs(argv: readonly string[], env: Record<string, string | undefined>, defaultCwd: string): ParsedArgs {
  const opts: Partial<InitOptions> = { paid: false, cwd: defaultCwd };
  if (env.CLOUDFLARE_API_TOKEN) opts.token = env.CLOUDFLARE_API_TOKEN;
  if (env.CLOUDFLARE_ACCOUNT_ID) opts.accountId = env.CLOUDFLARE_ACCOUNT_ID;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    const eq = arg.indexOf("=");
    const flag = eq > 0 ? arg.slice(0, eq) : arg;
    if (flag === "--paid" && eq < 0) {
      opts.paid = true;
      continue;
    }
    if (flag === "--token") return { ok: false, reason: "the API token is not taken as a flag; set CLOUDFLARE_API_TOKEN or enter it when asked" };
    const key = VALUE_FLAGS[flag];
    if (!key) return { ok: false, reason: `unknown argument ${flag}\n\n${USAGE}` };
    const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
    if (value === undefined || value === "" || (eq < 0 && value.startsWith("--"))) return { ok: false, reason: `${flag} needs a value` };
    opts[key] = key === "cwd" ? resolve(defaultCwd, value) : value;
  }
  return { ok: true, opts };
}
