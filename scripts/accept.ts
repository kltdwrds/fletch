// `pnpm accept <id>`: the acceptance contract, carried over from qyvr-co and cut to what fletch has. Prints
// the tree hash first, runs the steps in order, prints a count per step, stops at the first failure, and ends
// with exactly one line: `ACCEPT <id>: PASS` or `ACCEPT <id>: FAIL (<step>)`. Every run is a full run unless
// ACCEPT_PASS_CACHE=1 opts an interim run into the pass cache (scripts/lib/pass-cache.ts), which serves only a
// step that passed on the same tree hash. It never prints a secret: scans report file, line and rule only.
//
//   pnpm accept F0        a part of the fletch plan
//   pnpm accept F1.2      a split part
//
// The steps: lint, hermetic tests, the agent's dry-run bundle, the secret scan, the privacy scan, the harness
// checks, typecheck, and the live exit test (F1) when QYVR_LIVE=1 with CF_LIVE_ACCOUNT_ID and CF_LIVE_TOKEN set, which
// otherwise prints `live: skipped (no account)` and passes. The platform's steps (the generated-config bundle, the upstream pin check, the
// binding audit and provisioning, the adapter contract suite, the live lane and the milestone claims) stayed
// in qyvr-co with the platform.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { enabled as passCacheOn, lookup, record, toolVersions } from "./lib/pass-cache.ts";
import { privacyScan, secretScan } from "./scans.ts";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// --- part ids -------------------------------------------------------------------------------------

/** `F<n>` or `F<n>.<p>`, compared numerically so `[F1]` never matches `[F10]`. */
export type PartId = readonly [number, number];

export function parsePartId(id: string): PartId | null {
  const m = id.match(/^F(\d+)(?:\.(\d+))?$/);
  return m ? [Number(m[1]), m[2] === undefined ? 0 : Number(m[2])] : null;
}

export function comparePartIds(a: PartId, b: PartId): number {
  return a[0] - b[0] || a[1] - b[1];
}

/**
 * A test title's tag: `[F<n>]` for fletch's own parts, or `[M<n>]` for a test inherited from qyvr-co. The
 * inherited suite is the baseline every part keeps green, so an `[M..]` tag is in scope for every target.
 */
const TAG = /\[((?:F|M)\d+(?:\.\d+)?)\]/;
const inherited = (tag: string) => tag.startsWith("M");

/** Tags of a test file's describe/it/test titles, and top-level titles that carry no tag. */
export function fileTags(source: string): { tags: string[]; untagged: number } {
  const tags = new Set<string>();
  let untagged = 0;
  for (const m of source.matchAll(/^(\s*)(?:describe|it|test)(?:\.each\([^)]*\))?\(\s*(["'`])(.*?)\2/gm)) {
    const tag = m[3].match(TAG)?.[1];
    if (tag) tags.add(tag);
    else if (m[1] === "") untagged++;
  }
  return { tags: [...tags], untagged };
}

// --- output ---------------------------------------------------------------------------------------

interface StepOutcome {
  ok: boolean;
  count: string;
  detail?: string[];
}

const summary: { step: string; count: string }[] = [];

function sh(cmd: string, args: string[], env: NodeJS.ProcessEnv = process.env, cwd = root) {
  const res = spawnSync(cmd, args, { cwd, encoding: "utf8", env, maxBuffer: 64 * 1024 * 1024 });
  return { status: res.status ?? 1, out: `${res.stdout ?? ""}${res.stderr ?? ""}` };
}

function treeHash(): { tree: string; head: string; dirty: boolean } {
  const dir = mkdtempSync(join(tmpdir(), "fletch-accept-"));
  const index = join(dir, "index");
  try {
    if (existsSync(join(root, ".git/index"))) copyFileSync(join(root, ".git/index"), index);
    const env = { ...process.env, GIT_INDEX_FILE: index };
    sh("git", ["add", "-A"], env);
    const tree = sh("git", ["write-tree"], env).out.trim();
    const head = sh("git", ["rev-parse", "--short=12", "HEAD"]).out.trim();
    const dirty = sh("git", ["status", "--porcelain"]).out.trim() !== "";
    return { tree, head, dirty };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- the hermetic lane ----------------------------------------------------------------------------

/** No credential and no account: the hermetic lane's whole environment. */
export function hermeticEnv(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    LANG: process.env.LANG ?? "C.UTF-8",
    CI: "1",
    NO_COLOR: "1",
    QYVR_HERMETIC: "1",
    WRANGLER_SEND_METRICS: "false",
  };
}

/** Hermetic test files under each of `dirs`, repository-relative and sorted. */
function testFiles(dirs: string[]): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const path = join(d, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") walk(path);
      } else if (entry.name.endsWith(".test.ts") && !entry.name.endsWith(".live.test.ts")) out.push(relative(root, path));
    }
  };
  for (const dir of dirs) if (existsSync(dir)) walk(dir);
  return out.toSorted();
}

/** Where hermetic tests live: the agent's under test/, the primitives' and create-fletch's beside their packages. */
export function testDirs(base = root): string[] {
  const packages = join(base, "packages");
  const hosts = existsSync(packages) ? readdirSync(packages).filter((p) => p.startsWith("host") || p === "create-fletch").map((p) => join(packages, p, "test")) : [];
  return [join(base, "test"), ...hosts];
}

interface VitestCounts {
  passed: number;
  failed: number;
  skipped: number;
}

/** A test-name pattern matching exactly the given tags at the start of a test's full name. */
export function tagPattern(tags: string[]): string {
  return `^\\[(?:${tags.map((t) => t.replace(".", "\\.")).join("|")})\\]`;
}

function vitest(files: string[], pattern: string, env: NodeJS.ProcessEnv, label: string): VitestCounts {
  const report = join(mkdtempSync(join(tmpdir(), "fletch-vitest-")), "report.json");
  const res = sh("pnpm", ["exec", "vitest", "run", ...files, "--testNamePattern", pattern, "--reporter=default", "--reporter=json", `--outputFile.json=${report}`], env);
  const counts: VitestCounts = { passed: 0, failed: 0, skipped: 0 };
  if (existsSync(report)) {
    const json = JSON.parse(readFileSync(report, "utf8")) as {
      testResults: { assertionResults: { fullName: string; status: string }[] }[];
    };
    for (const file of json.testResults) {
      for (const t of file.assertionResults) {
        if (t.status === "passed") counts.passed++;
        else if (t.status === "failed") counts.failed++;
        else counts.skipped++;
      }
    }
    rmSync(join(report, ".."), { recursive: true, force: true });
  }
  if (res.status !== 0 && counts.failed === 0) counts.failed = 1;
  console.log(res.out.trim().split("\n").slice(-40).map((l) => `    ${l}`).join("\n"));
  console.log(`    ${label}: ${counts.passed} passed, ${counts.failed} failed, ${counts.skipped} skipped`);
  return counts;
}

// --- steps ----------------------------------------------------------------------------------------

/** The agent: the one Worker package, its config read by `wrangler types` and the dry-run bundle. */
export const AGENT_PACKAGE = "packages/agent";
/** Every TypeScript project: the Node side, the primitives over the Workers types, the agent, and create-fletch. */
export const TS_PROJECTS: readonly string[] = ["tsconfig.json", "tsconfig.hosts.json", AGENT_PACKAGE, "packages/create-fletch"];
const HARNESS_CHECKS = [
  "scripts/check-boundaries.mjs",
  "scripts/check-file-sizes.mjs",
  "scripts/check-test-hygiene.mjs",
  "scripts/check-agent-docs.mjs",
  "scripts/check-shell.mjs",
];

function typecheck(): StepOutcome {
  const types = sh("pnpm", ["exec", "wrangler", "types", "--strict-vars=false", "--config", "wrangler.jsonc"], hermeticEnv(), join(root, AGENT_PACKAGE));
  if (types.status !== 0) return { ok: false, count: `wrangler types failed in ${AGENT_PACKAGE}`, detail: [types.out] };
  const detail: string[] = [];
  for (const project of TS_PROJECTS) {
    const res = sh("pnpm", ["exec", "tsc", "--noEmit", "-p", project]);
    detail.push(`tsc -p ${project}: ${res.status === 0 ? "ok" : "errors"}`);
    if (res.status !== 0) return { ok: false, count: `${project} failed`, detail: [...detail, res.out] };
  }
  return { ok: true, count: `${TS_PROJECTS.length} projects, 0 errors`, detail };
}

function lint(): StepOutcome {
  const res = sh("pnpm", ["exec", "biome", "lint", "--max-diagnostics=50", "."]);
  const checked = res.out.match(/Checked (\d+) files?/)?.[1] ?? "?";
  return { ok: res.status === 0, count: `${checked} files`, detail: res.status === 0 ? [] : [res.out] };
}

export interface HermeticPlan {
  files: string[];
  tags: string[];
  untagged: string[];
  /** Files carrying a tag of the target's own part: `[F1]` or `[F1.<p>]` for F1, `[F1.2]` for F1.2. */
  own: string[];
}

/** Whether `tag` names the target's own part, never an inherited `[M..]` tag. */
export function ownTag(tag: string, target: PartId): boolean {
  const p = inherited(tag) ? null : parsePartId(tag);
  return p !== null && p[0] === target[0] && (target[1] === 0 || p[1] === target[1]);
}

/** Which hermetic test files and tags run for a target part: `[F..]` tags up to the target, and every inherited `[M..]` tag; and which files carry the part's own tag. */
export function planHermetic(target: PartId, dirs = testDirs()): HermeticPlan {
  const files: string[] = [];
  const tags = new Set<string>();
  const untagged: string[] = [];
  const ownFiles: string[] = [];
  for (const file of testFiles(dirs)) {
    const { tags: own, untagged: bare } = fileTags(readFileSync(join(root, file), "utf8"));
    if (bare > 0 || own.length === 0) untagged.push(file);
    const inScope = own.filter((t) => inherited(t) || comparePartIds(parsePartId(t) as PartId, target) <= 0);
    if (inScope.length) files.push(file);
    if (own.some((t) => ownTag(t, target))) ownFiles.push(file);
    for (const t of inScope) tags.add(t);
  }
  return { files, tags: [...tags].toSorted(), untagged, own: ownFiles };
}

function hermeticTests(target: PartId): StepOutcome {
  const plan = planHermetic(target);
  if (plan.untagged.length) return { ok: false, count: "untagged tests", detail: plan.untagged.map((f) => `untagged top-level test in ${f}`) };
  // The inherited [M..] suite is in scope for every target, so it alone must never pass a part with no tests of its own.
  if (!plan.own.length) return { ok: false, count: "0 tests of this part", detail: ["no hermetic test file carries a tag of this part's own"] };
  if (!plan.files.length) return { ok: false, count: "0 tests", detail: ["no hermetic test is tagged for this part or earlier"] };
  const all = vitest(plan.files, tagPattern(plan.tags), hermeticEnv(), "hermetic");
  let passed = all.passed;
  let failed = all.failed;
  // Scenario files run twice: a test that passes on retry is a bug.
  const scenarios = plan.files.filter((f) => f.startsWith("test/scenarios/"));
  if (scenarios.length) {
    const again = vitest(scenarios, tagPattern(plan.tags), hermeticEnv(), "scenarios, second run");
    passed += again.passed;
    failed += again.failed;
  }
  return { ok: failed === 0 && passed > 0, count: `${passed} tests passed, ${failed} failed (${plan.files.length} files, ${plan.own.length} of this part${scenarios.length ? `, ${scenarios.length} scenario files twice` : ""})` };
}

/** The agent script through `wrangler deploy --dry-run`: it bundles, and nothing is uploaded. */
function bundleStep(): StepOutcome {
  const out = mkdtempSync(join(tmpdir(), "fletch-bundle-"));
  try {
    // The workspace's @qyvr/* packages export their sources under the `development` condition (dist is built only
    // for publishing), so the bundle asks for it besides wrangler's own conditions.
    const env = { ...hermeticEnv(), WRANGLER_BUILD_CONDITIONS: "development,workerd,worker,browser" };
    const res = sh("pnpm", ["exec", "wrangler", "deploy", "--dry-run", "--config", "wrangler.jsonc", "--outdir", out], env, join(root, AGENT_PACKAGE));
    const bundled = res.status === 0 && readdirSync(out).some((f) => f.endsWith(".js"));
    return { ok: bundled, count: bundled ? "1/1 scripts bundled" : "0/1 scripts bundled", detail: bundled ? [`${AGENT_PACKAGE}: bundled`] : [`${AGENT_PACKAGE}: FAILED`, res.out.trim().split("\n").slice(-30).join("\n")] };
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

function secretStep(): StepOutcome {
  const r = secretScan(root);
  return { ok: r.findings.length === 0, count: `${r.files} files, ${r.findings.length} findings`, detail: r.findings.map((f) => `${f.file}:${f.line} ${f.rule}`) };
}

function privacyStep(): StepOutcome {
  const r = privacyScan(root);
  return { ok: r.findings.length === 0, count: `${r.files} files, ${r.findings.length} findings`, detail: r.findings.map((f) => `${f.file}:${f.line} ${f.rule}`) };
}

function harnessStep(): StepOutcome {
  const missing = HARNESS_CHECKS.filter((c) => !existsSync(join(root, c)));
  if (missing.length) return { ok: false, count: `missing ${missing.join(", ")}` };
  const detail: string[] = [];
  for (const check of HARNESS_CHECKS) {
    const res = sh("node", [check]);
    detail.push(`${check}: ${res.status === 0 ? "ok" : "FAILED"}`);
    if (res.status !== 0) return { ok: false, count: `${check} failed`, detail: [...detail, res.out] };
  }
  const gateTests = readdirSync(join(root, "scripts")).filter((f) => /\.test\.(mjs|ts)$/.test(f)).map((f) => join("scripts", f));
  if (gateTests.length) {
    const res = sh("node", ["--test", ...gateTests], hermeticEnv());
    const pass = res.out.match(/^(?:#|ℹ) pass (\d+)/m)?.[1] ?? "?";
    detail.push(`node --test: ${pass} passed`);
    if (res.status !== 0) return { ok: false, count: "gate tests failed", detail: [...detail, res.out] };
  }
  return { ok: true, count: `${HARNESS_CHECKS.length} checks, ${gateTests.length} gate test files`, detail };
}

// --- the live lane --------------------------------------------------------------------------------

/** The F1 exit test: a scripted deploy into a throwaway account (docs/DECISIONS.md, "F1 exit test"). */
export const LIVE_FILE = "test/live/f1-deploy.live.test.ts";

/** Whether the live lane runs: `QYVR_LIVE=1` and both account variables set (non-empty). */
export function liveEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.QYVR_LIVE === "1" && !!env.CF_LIVE_ACCOUNT_ID && !!env.CF_LIVE_TOKEN;
}

/** The live lane's environment: the account and token, and nothing else of the caller's but what a child needs. */
export function liveEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const { QYVR_HERMETIC: _hermetic, ...base } = hermeticEnv();
  return { ...base, QYVR_LIVE: "1", CF_LIVE_ACCOUNT_ID: env.CF_LIVE_ACCOUNT_ID, CF_LIVE_TOKEN: env.CF_LIVE_TOKEN, ...(env.GITHUB_RUN_ID ? { GITHUB_RUN_ID: env.GITHUB_RUN_ID } : {}) };
}

/** Output lines with the token and any setup link removed, so a log never carries either. */
export function scrubLive(out: string, token: string): string {
  return out.split("\n").map((l) => (l.includes("?setup=") ? "[setup link hidden]" : token ? l.replaceAll(token, "[token]") : l)).join("\n");
}

function liveStep(): StepOutcome {
  if (!liveEnabled(process.env)) return { ok: true, count: "live: skipped (no account)" };
  const res = sh("pnpm", ["exec", "vitest", "run", LIVE_FILE], liveEnv(process.env));
  const out = scrubLive(res.out, process.env.CF_LIVE_TOKEN as string).trim().split("\n").slice(-60);
  return { ok: res.status === 0, count: res.status === 0 ? "live: F1 exit test passed" : "live: F1 exit test failed", detail: out.map((l) => `  ${l}`) };
}

// --- main -----------------------------------------------------------------------------------------

async function main(id: string | undefined): Promise<number> {
  const target = parsePartId(id ?? "");
  if (!id || !target) {
    console.error("usage: pnpm accept <F<n>|F<n>.<p>>");
    return 2;
  }
  const { tree, head, dirty } = treeHash();
  console.log(`TREE ${tree} (HEAD ${head}${dirty ? ", uncommitted changes included" : ""})`);

  const steps: { n: number; name: string; run: () => StepOutcome | Promise<StepOutcome> }[] = [
    { n: 1, name: "lint", run: lint },
    { n: 2, name: "hermetic tests", run: () => hermeticTests(target) },
    { n: 3, name: "dry-run bundle", run: bundleStep },
    { n: 4, name: "secret scan", run: secretStep },
    { n: 5, name: "privacy scan", run: privacyStep },
    { n: 6, name: "harness checks", run: harnessStep },
    { n: 7, name: "typecheck", run: typecheck },
    { n: 8, name: "live", run: liveStep },
  ];

  for (const step of steps) {
    const label = `[${step.n}] ${step.name}`;
    console.log(`\n${label}`);
    let outcome: StepOutcome;
    const cacheDir = join(root, "node_modules/.cache/fletch-accept");
    const cacheInput = { tree, step: step.n, id, versions: toolVersions() };
    const hit = passCacheOn() ? lookup(cacheDir, cacheInput) : null;
    try {
      outcome = hit === null ? await step.run() : { ok: true, count: `${hit} (pass cache, same tree)` };
    } catch (error) {
      outcome = { ok: false, count: "error", detail: [(error as Error).message] };
    }
    if (passCacheOn() && hit === null && outcome.ok) record(cacheDir, cacheInput, outcome.count);
    for (const line of outcome.detail ?? []) console.log(`  ${line}`);
    console.log(`  STEP ${step.n} ${step.name}: ${outcome.count} -> ${outcome.ok ? "ok" : "FAIL"}`);
    summary.push({ step: label, count: outcome.count });
    if (!outcome.ok) {
      console.log("\nSteps:");
      for (const s of summary) console.log(`  ${s.step}: ${s.count}`);
      console.log(`\nACCEPT ${id}: FAIL (${step.name})`);
      return 1;
    }
  }
  console.log("\nSteps:");
  for (const s of summary) console.log(`  ${s.step}: ${s.count}`);
  console.log(`\nACCEPT ${id}: PASS`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await main(process.argv[2]).catch((error) => {
    console.error(error);
    console.log(`\nACCEPT ${process.argv[2]}: FAIL (crash)`);
    return 1;
  });
}
