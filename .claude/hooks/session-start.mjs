// On Claude Code on the web only: make `pnpm check`, `pnpm accept` and `pnpm dev` run at once. The web's image ships
// Node 22 (fletch needs the .tool-versions Node, 24.19 or newer), pnpm only for that Node, and a Playwright Chromium
// at another revision than playwright-core pins, so this installs the pinned Node through the image's nvm, pnpm for
// it, the dependencies (and, through `prepare`, the git hooks) and playwright-core's own Chromium, then puts that Node
// first on PATH and points Playwright at its default cache for the rest of the session ($CLAUDE_ENV_FILE). It is
// Node, not shell, so the repository keeps no shell script for `scripts/check-shell.mjs` to need shellcheck for.
// Every step is idempotent; output goes to stderr, out of the context. Local sessions manage their own install.
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

if (process.env.CLAUDE_CODE_REMOTE !== "true") process.exit(0);

const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const nvmDir = process.env.NVM_DIR ?? "/opt/nvm";
const node = readFileSync(join(root, ".tool-versions"), "utf8").match(/^nodejs\s+(\S+)/m)?.[1];
const pnpm = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).packageManager?.replace(/^pnpm@/, "");
const browsers = join(homedir(), ".cache/ms-playwright");
if (!node || !pnpm) throw new Error("session-start: .tool-versions names no nodejs, or package.json no packageManager");

const bin = join(nvmDir, "versions/node", `v${node}`, "bin");
const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, PLAYWRIGHT_BROWSERS_PATH: browsers };
delete env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD;

function run(cmd, args, what) {
  const res = spawnSync(cmd, args, { cwd: root, env, stdio: ["ignore", 2, 2] });
  if (res.status !== 0) {
    console.error(`session-start: ${what} failed (exit ${res.status})`);
    process.exit(1);
  }
}

if (!existsSync(join(bin, "node"))) run("bash", ["-c", `source "${nvmDir}/nvm.sh" --no-use; nvm install "${node}"`], `nvm install ${node}`);
if (!existsSync(join(bin, "pnpm"))) run(join(bin, "npm"), ["install", "-g", `pnpm@${pnpm}`], `npm install -g pnpm@${pnpm}`);
run(join(bin, "pnpm"), ["install", "--frozen-lockfile"], "pnpm install");
// The browser tests (test/workers/*browser*, m29-*) launch the Chromium playwright-core pins, not the image's.
run(join(bin, "pnpm"), ["exec", "playwright-core", "install", "chromium"], "playwright-core install chromium");

if (process.env.CLAUDE_ENV_FILE) {
  appendFileSync(process.env.CLAUDE_ENV_FILE, `export PATH="${bin}:$PATH"\nexport PLAYWRIGHT_BROWSERS_PATH="${browsers}"\nunset PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD\n`);
}
