// The real `wrangler deploy`: a child process running the wrangler this package depends on, with the token and
// account in its environment only. Its output is shown as it runs and kept for the refusal if it fails.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { DeployRunner } from "./init.ts";

// A checkout's @qyvr/* packages export their sources under `development` (dist exists only in a published package),
// so the bundle asks for that condition besides wrangler's own.
const BUILD_CONDITIONS = "development,workerd,worker,browser";

export const wranglerDeploy: DeployRunner = (configPath, env) => {
  const bin = join(dirname(createRequire(import.meta.url).resolve("wrangler/package.json")), "bin", "wrangler.js");
  return new Promise((done) => {
    const child = spawn(process.execPath, [bin, "deploy", "--config", configPath], { cwd: dirname(configPath), env: { ...process.env, ...env, WRANGLER_BUILD_CONDITIONS: BUILD_CONDITIONS }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const keep = (stream: NodeJS.WriteStream) => (chunk: Buffer) => {
      output += chunk.toString("utf8");
      stream.write(chunk);
    };
    child.stdout.on("data", keep(process.stdout));
    child.stderr.on("data", keep(process.stderr));
    child.on("error", (error) => done({ ok: false, output: `${output}\n${error.message}` }));
    child.on("close", (code) => done({ ok: code === 0, output }));
  });
};
