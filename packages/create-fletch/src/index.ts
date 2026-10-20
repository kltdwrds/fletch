#!/usr/bin/env node
// `create-fletch`: sets up one owner's fletch on their Cloudflare account. Run it from a fletch checkout with
// Node 24 (`node packages/create-fletch/src/index.ts`, or `pnpm create-fletch` at the checkout's root); it asks
// for anything the flags and the environment do not give. The work is in init.ts; this file only asks.
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { parseArgs } from "./args.ts";
import { type InitOptions, init } from "./init.ts";

async function ask(question: string, secret = false): Promise<string> {
  const muted = new Writable({ write: (_chunk, _enc, done) => done() });
  if (secret) process.stdout.write(question);
  const rl = createInterface({ input: process.stdin, output: secret ? muted : process.stdout, terminal: true });
  // Input that ends before an answer (a closed stdin) is an empty answer, which init then refuses in words.
  const ended = new Promise<string>((resolve) => rl.once("close", () => resolve("")));
  try {
    return (await Promise.race([rl.question(secret ? "" : question), ended])).trim();
  } finally {
    rl.close();
    if (secret) process.stdout.write("\n");
  }
}

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2), process.env, process.env.INIT_CWD ?? process.cwd());
  if (!parsed.ok) {
    console.error(parsed.reason);
    return 2;
  }
  const o = parsed.opts;
  o.name ??= await ask("Name for your agent (a-z, 0-9, -): ");
  o.ownerEmail ??= await ask("Your email address (the owner): ");
  o.accountId ??= await ask("Cloudflare account id: ");
  o.token ??= await ask("Cloudflare API token (input hidden): ", true);
  const result = await init(o as InitOptions);
  if (!result.ok) {
    console.error(`create-fletch: ${result.code}: ${result.reason}`);
    return 1;
  }
  return 0;
}

process.exitCode = await main();
