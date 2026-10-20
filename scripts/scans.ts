// The secret scan and the privacy scan (acceptance-checks.md steps 5 and 6). Both read the files git
// would commit: tracked files plus untracked files that are not ignored. Ignored paths are outside
// the scan. Findings name a file, a line and a rule, never the matched text.
//
//   node scripts/scans.ts secret|privacy
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { CREDENTIAL_NAME, SECRET_PATTERNS } from "./lib/secret-patterns.ts";

export interface Finding {
  file: string;
  line: number;
  rule: string;
}

export interface ScanResult {
  files: number;
  findings: Finding[];
}

/** The only place fake credentials may live, so tests can plant them. */
export const FAKE_SECRETS_DIR = "test/fixtures/fake-secrets/";
export const PEOPLE_FILE = "test/fixtures/people.json";
export const DENYLIST_FILE = "scripts/privacy-denylist.txt";
/** Built from parts so this file does not itself contain the marker it scans for. */
const DUMP_MARKER = ["harness", "dump"].join("-");

/** Where a scan reads from: the file list and each file's text (null for a binary file). */
export interface FileSource {
  files: string[];
  read(file: string): string | null;
}

/** Files git would commit, relative to `dir`. Submodule gitlinks and directories are skipped. */
export function candidateFiles(dir: string): string[] {
  const git = (args: string[]) => {
    const res = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    if (res.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`);
    return res.stdout.split("\0").filter(Boolean);
  };
  const files = new Set([...git(["ls-files", "-z"]), ...git(["ls-files", "-z", "--others", "--exclude-standard"])]);
  return [...files].filter((f) => existsSync(join(dir, f)) && statSync(join(dir, f)).isFile()).toSorted();
}

const text = (buf: Buffer): string | null => (buf.includes(0) ? null : buf.toString("utf8"));

/** The working tree: tracked files plus untracked files that are not ignored (accept steps 5 and 6). */
export function workingTree(dir: string): FileSource {
  return { files: candidateFiles(dir), read: (file) => text(readFileSync(join(dir, file))) };
}

/**
 * The index: exactly what the next commit would hold, read from the staged blobs, so a secret staged
 * and then removed from the working tree is still seen. Honours GIT_INDEX_FILE, which git sets for a
 * hook during `git commit <paths>`. Submodule gitlinks are skipped.
 */
export function stagedIndex(dir: string): FileSource {
  const ls = spawnSync("git", ["ls-files", "-s", "-z"], { cwd: dir, encoding: "utf8" });
  if (ls.status !== 0) throw new Error(`git ls-files -s failed: ${ls.stderr}`);
  const entries = ls.stdout
    .split("\0")
    .filter(Boolean)
    .map((line) => {
      const [meta, file] = line.split("\t");
      const [mode, sha] = meta.split(" ");
      return { mode, sha, file };
    })
    .filter((e) => e.mode !== "160000");
  const blobs = new Map<string, Buffer>();
  if (entries.length) {
    const cat = spawnSync("git", ["cat-file", "--batch"], { cwd: dir, input: entries.map((e) => e.sha).join("\n"), maxBuffer: 256 * 1024 * 1024 });
    if (cat.status !== 0) throw new Error(`git cat-file --batch failed: ${cat.stderr}`);
    const out = cat.stdout;
    let at = 0;
    for (const e of entries) {
      const nl = out.indexOf(10, at);
      const size = Number(out.subarray(at, nl).toString("utf8").split(" ")[2]);
      blobs.set(e.file, out.subarray(nl + 1, nl + 1 + size));
      at = nl + 1 + size + 1;
    }
  }
  return {
    files: entries.map((e) => e.file).toSorted(),
    read: (file) => {
      const blob = blobs.get(file);
      return blob === undefined ? null : text(blob);
    },
  };
}

/** Values of `.dev.vars` entries whose names end in TOKEN, SECRET, KEY or PASSWORD. */
export function devVarsSecrets(path: string): string[] {
  if (!existsSync(path)) return [];
  const values: string[] = [];
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const m = raw.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m || !CREDENTIAL_NAME.test(m[1])) continue;
    const value = m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
    // Short values would match by accident and are not credentials worth the name.
    if (value.length >= 8) values.push(value);
  }
  return values;
}

export function secretScan(dir: string, devVarsPath = join(dir, ".dev.vars"), source: FileSource = workingTree(dir)): ScanResult {
  const { files } = source;
  const devValues = devVarsSecrets(devVarsPath);
  const findings: Finding[] = [];
  for (const file of files) {
    if (file.startsWith(FAKE_SECRETS_DIR)) continue;
    const content = source.read(file);
    if (content === null) continue;
    content.split("\n").forEach((line, i) => {
      for (const p of SECRET_PATTERNS) if (p.re.test(line)) findings.push({ file, line: i + 1, rule: p.name });
      if (devValues.some((v) => line.includes(v))) findings.push({ file, line: i + 1, rule: "dev-vars-value" });
    });
  }
  return { files: files.length, findings };
}

interface People {
  companies: { id: string; name: string; domain: string }[];
  people: { name: string; email: string }[];
  /** An operator identity, when a fixture set has one; fletch's has none. */
  operator?: { email: string };
  /** Staging-only agent identities, when a fixture set has them; fletch's has none. */
  agents?: { email: string }[];
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
/** A person-shaped value (two or more capitalised words) under a name-like key in JSON, JSONC or TS. */
const PERSON_NAME = /["']?(?:name|displayName|fullName|personName|author)["']?\s*[:=]\s*["'`]([A-Z][a-z]+(?: [A-Z][a-z]+)+)["'`]/g;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Files where fixture identities may not appear unless they come from people.json. */
function identityScoped(file: string): boolean {
  return !file.startsWith("docs/") && file !== PEOPLE_FILE && file !== "pnpm-lock.yaml";
}

export function privacyScan(dir: string, source: FileSource = workingTree(dir)): ScanResult {
  const { files } = source;
  const findings: Finding[] = [];
  const peopleText = source.read(PEOPLE_FILE);
  if (peopleText === null) throw new Error(`privacy scan: ${PEOPLE_FILE} is missing from the files scanned`);
  const people = JSON.parse(peopleText) as People;
  const emails = new Set([...people.people.map((p) => p.email.toLowerCase()), ...(people.operator ? [people.operator.email.toLowerCase()] : []), ...(people.agents ?? []).map((a) => a.email.toLowerCase())]);
  const names = new Set([...people.people.map((p) => p.name), ...people.companies.map((c) => c.name)]);
  const companyIds = new Set(people.companies.map((c) => c.id));
  const denylistPath = join(dir, DENYLIST_FILE);
  const denylist = new Set(
    existsSync(denylistPath)
      ? readFileSync(denylistPath, "utf8").split("\n").map((l) => l.trim()).filter((l) => /^[0-9a-f]{64}$/.test(l))
      : [],
  );

  for (const file of files) {
    const content = source.read(file);
    if (content === null) continue;
    const lines = content.split("\n");
    lines.forEach((line, i) => {
      const at = { file, line: i + 1 };
      if (!file.startsWith("docs/plan-v2/") && line.includes(DUMP_MARKER)) findings.push({ ...at, rule: "dump-reference" });
      if ((file.startsWith("docs/") || file.startsWith("packages/")) && denylist.size && line.trim()) {
        if (denylist.has(sha256(line.trim()))) findings.push({ ...at, rule: "denylisted-line" });
      }
      if (!identityScoped(file)) return;
      for (const m of line.matchAll(EMAIL)) {
        if (!emails.has(m[0].toLowerCase())) findings.push({ ...at, rule: "identity-not-in-people-json:email" });
      }
      for (const m of line.matchAll(PERSON_NAME)) {
        if (!names.has(m[1])) findings.push({ ...at, rule: "identity-not-in-people-json:name" });
      }
    });
    const tenant = file.match(/^platform\/tenants\/([^/]+)\.jsonc$/);
    if (tenant && !companyIds.has(tenant[1])) findings.push({ file, line: 1, rule: "identity-not-in-people-json:company" });
  }
  return { files: files.length, findings };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const which = process.argv[2];
  const dir = process.cwd();
  const result = which === "secret" ? secretScan(dir) : which === "privacy" ? privacyScan(dir) : null;
  if (!result) {
    console.error("usage: node scripts/scans.ts secret|privacy");
    process.exitCode = 2;
  } else {
    for (const f of result.findings) console.log(`  ${f.file}:${f.line} ${f.rule}`);
    console.log(`${which} scan: ${result.files} files, ${result.findings.length} findings`);
    process.exitCode = result.findings.length ? 1 : 0;
  }
}
