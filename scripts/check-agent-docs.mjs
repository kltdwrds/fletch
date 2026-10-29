#!/usr/bin/env node
// The agent-docs check (AGENTS.md, "Keep this file true"): the instruction files an agent follows must not rot.
// Files in scope: every AGENTS.md and SKILL.md, VISION.md files, the root CONTRIBUTING.md, docs/runbooks/*.md,
// docs/plan-v2/*.md and packages/agent/docs/platform/*.md. CLAUDE.md is a link to the AGENTS.md beside it, read once
// through that file. Rules, each with a code:
//   - broken-link:    a relative markdown link `](path)` whose target (fragment and query removed,
//                     resolved from the file's directory) does not exist; http(s), mailto and bare
//                     `#anchor` links are not checked;
//   - unknown-script: a line in a fenced block that runs `pnpm <name>` where <name> is neither a script
//                     in package.json nor one of pnpm's own commands used here (install, i, add, exec,
//                     dlx, run <script>), nor a flag;
//   - dump:           any mention of the dump's directory name (off limits);
//   - runbook-shape:  a runbook (docs/runbooks/*.md) that does not start with an H1 title or has
//                     neither a `## Steps` nor a `## When` section (the index, README.md, needs only
//                     the title);
//   - docs-frontmatter: a platform doc (packages/agent/docs/platform/*.md, M24.1) without `summary` and
//                     `read_when` frontmatter; the folder is also checked for the rules above;
//   - secret-shape:   a string shaped like a credential (scripts/lib/secret-patterns.ts), reported by
//                     rule name, never by value;
// and, ported from qyvr's scripts/check-agent-docs.mjs:
//   - line-budget:    the root AGENTS.md, docs/plan-v2/KICKOFF.md and every SKILL.md over MAX_LINES, a package
//                     AGENTS.md over PACKAGE_MAX_LINES: point to the code or the plan instead of copying it;
//   - missing-path:   a binding file (BINDING) names in backticks a repository path git does not know (tracked,
//                     or untracked and not ignored), resolved from the file's directory, else the root;
//   - missing-identifier: a binding file names in backticks a code identifier (`camelCase`, `SCREAMING_CASE`,
//                     `Dotted.Name`, `call()`) that no tracked source file mentions, so a rename cannot leave an
//                     instruction pointing at nothing;
//   - claude-link:    an AGENTS.md without a CLAUDE.md beside it that is a symlink to it (Claude Code reads a
//                     CLAUDE.md, never an AGENTS.md);
//   - skill-name:     a skills/<name>/ without a SKILL.md whose frontmatter `name` is <name>;
//   - harness-link:   an entry in a harness directory (HARNESS_DIRS) that is not a symlink to skills/<entry>:
//                     skills have one source.
// Plans and ledgers (docs/plan-v2/parts.md and the rest of docs/plan-v2/ but KICKOFF.md and VERIFIER-PROMPT.md) may name
// paths a part has not made yet, so the path and identifier rules skip them. Every violation fails the check; there
// is no allowlist.
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchSecret } from './lib/secret-patterns.ts';
import { git, repoFiles, repoRoot } from './lib/repo-files.mjs';

export const MAX_LINES = 200;
export const PACKAGE_MAX_LINES = 80;
export const HARNESS_DIRS = ['.claude/skills', '.agents/skills'];
const PNPM_OWN = new Set(['install', 'i', 'add', 'exec', 'dlx', 'run', 'update', 'up', 'remove', 'rm']);
const DUMP = ['harness', 'dump'].join('-');

const isPlatformDoc = (file) => /^packages\/agent\/docs\/platform\/[^/]+\.md$/.test(file);
const isRunbook = (file) => /^docs\/runbooks\/[^/]+\.md$/.test(file);
const isPlan = (file) => /^docs\/plan-v2\/[^/]+\.md$/.test(file);
const isDecision = (file) => /^docs\/decisions\/[^/]+\.md$/.test(file);
const base = (file) => path.posix.basename(file);

export const inScope = (file) =>
  base(file) === 'AGENTS.md' || base(file) === 'SKILL.md' || base(file) === 'VISION.md' || file === 'CONTRIBUTING.md' || isPlatformDoc(file) || isRunbook(file) || isPlan(file) || isDecision(file);

/** The files whose backticked paths and identifiers must exist: what an agent is told to do, not a plan or a ledger. */
export const BINDING = (file) => inScope(file) && !isPlatformDoc(file) && !isDecision(file) && (!isPlan(file) || file === 'docs/plan-v2/KICKOFF.md' || file === 'docs/plan-v2/VERIFIER-PROMPT.md');

/** The line budget of `file`, or null when it has none. */
export function budgetOf(file) {
  if (file === 'AGENTS.md' || file === 'docs/plan-v2/KICKOFF.md' || base(file) === 'SKILL.md') return MAX_LINES;
  if (base(file) === 'AGENTS.md') return PACKAGE_MAX_LINES;
  return null;
}

/** Lines inside fenced code blocks, as `{line, text}`. */
function fenced(text) {
  const out = [];
  let inside = false;
  text.split('\n').forEach((t, i) => {
    if (/^\s*(?:```|~~~)/.test(t)) inside = !inside;
    else if (inside) out.push({ line: i + 1, text: t });
  });
  return out;
}

/** File extensions that make a backticked token a path even when its first directory does not exist. */
const PATH_EXTENSIONS = /\.(?:ts|tsx|mts|cts|mjs|js|json|jsonc|md|yml|yaml|sh|css|sql|toml|txt)$/;

/** Backticked tokens of one line, as written. */
const ticked = (line) => [...line.matchAll(/`([^`\s]+)`/g)].map((m) => m[1]);

/**
 * Whether a backticked token is a repository path: it has a `/` and no placeholder or glob, and ends in a file
 * extension or `/`, or `isDir` says its first segment is a directory here (so `origin/main` is not). A URL path
 * (`/api`), a URL and a package name (`@qyvr/host`) never are. Returns the path, `:line` suffix removed, or null.
 */
export function asPath(token, isDir) {
  const p = token.replace(/:\d+(-\d+)?$/, '');
  if (/[<>*{}$"]/.test(p) || !p.includes('/') || p.startsWith('/') || p.startsWith('@') || p.includes('://')) return null;
  return PATH_EXTENSIONS.test(p) || p.endsWith('/') || isDir(p.split('/')[0]) ? p : null;
}

/** Whether a backticked token is shaped like code: camelCase, compound PascalCase, SCREAMING_CASE, a capitalised dotted name or a call. */
export function asIdentifier(token) {
  if (!/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*(?:\(\))?$/.test(token)) return null;
  const bare = token.replace(/\(\)$/, '');
  if (PATH_EXTENSIONS.test(bare)) return null;
  const code = token.endsWith('()') || /[a-z][A-Z]/.test(bare) || /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/.test(bare) || (bare.includes('.') && /^[A-Z]/.test(bare));
  return code ? token : null;
}

/** The `name` in a SKILL.md's leading frontmatter block, or null. */
export function frontmatterName(text) {
  const block = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1];
  return block === undefined ? null : (/^name:\s*(\S+)\s*$/m.exec(block)?.[1] ?? null);
}

/**
 * Violations of one file as `{code, line, why}`. `exists(relPath)` answers for repository-relative paths and
 * `scripts` is the set of package.json script names. With `known(relPath)` (git knows the path), `isDir(segment)`
 * and `mentioned(word)` (a tracked source file has the word), the path and identifier rules run on binding files.
 */
export function violationsIn(file, text, { exists, scripts, known, isDir, mentioned }) {
  const out = [];
  const lines = text.split('\n');
  const dir = path.posix.dirname(file);
  const binding = BINDING(file) && known && isDir && mentioned;
  const candidates = (p) => (dir === '.' ? [p] : [path.posix.join(dir, p), p]);
  lines.forEach((l, i) => {
    for (const m of l.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = m[1].split('#')[0].split('?')[0];
      if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
      const resolved = path.posix.normalize(target.startsWith('/') ? target.slice(1) : path.posix.join(dir, target));
      if (!exists(resolved)) out.push({ code: 'broken-link', line: i + 1, why: `link target ${target} does not exist` });
    }
    if (l.includes(DUMP)) out.push({ code: 'dump-reference', line: i + 1, why: 'the dump is off limits and is not referenced' });
    const secret = matchSecret(l);
    if (secret) out.push({ code: 'secret-shape', line: i + 1, why: `matches ${secret}` });
    if (!binding) return;
    for (const token of ticked(l)) {
      const p = asPath(token, (first) => first !== 'node_modules' && first !== '.git' && candidates(first).some((c) => isDir(c)));
      if (p !== null) {
        if (!candidates(p).some((c) => known(c))) out.push({ code: 'missing-path', line: i + 1, why: `names \`${p}\`, which does not exist` });
        continue;
      }
      const id = asIdentifier(token);
      if (id === null) continue;
      const parts = id.replace(/\(\)$/, '').split('.');
      // A member of a built-in global (`JSON.stringify`) exists whether or not our code calls it.
      if (parts.length > 1 && (parts[0] ?? '') in globalThis) continue;
      if (!mentioned(parts.at(-1) ?? id)) out.push({ code: 'missing-identifier', line: i + 1, why: `names \`${id}\`, which no source file mentions` });
    }
  });
  for (const { line, text: t } of fenced(text)) {
    for (const m of t.matchAll(/(?:^|[\s;&|(])pnpm\s+((?:-[\w-]+(?:=\S+)?\s+)*)([\w:.-]+)(?:\s+([\w:.-]+))?/g)) {
      let name = m[2];
      if (name === 'run' && m[3]) name = m[3];
      else if (PNPM_OWN.has(name)) continue;
      if (!scripts.has(name)) out.push({ code: 'unknown-script', line, why: `pnpm ${name} is not a package.json script` });
    }
  }
  if (isPlatformDoc(file) && !/^---\r?\nsummary:[ \t]*\S[^\n]*\nread_when:[ \t]*\S[^\n]*\n---\r?\n/.test(text)) {
    out.push({ code: 'docs-frontmatter', line: 1, why: 'a platform doc starts with frontmatter holding summary and read_when' });
  }
  if (isRunbook(file)) {
    if (!/^\s*# \S/.test(text.replace(/^\s*\n/gm, '').split('\n')[0] ?? '')) out.push({ code: 'runbook-shape', line: 1, why: 'a runbook starts with an H1 title' });
    if (!file.endsWith('/README.md') && !/^## (?:Steps|When)\b/m.test(text)) out.push({ code: 'runbook-shape', line: 1, why: 'a runbook has a "## Steps" or "## When" section' });
  }
  const budget = budgetOf(file);
  const count = lines.length - (text.endsWith('\n') ? 1 : 0);
  if (budget !== null && count > budget) out.push({ code: 'line-budget', line: budget + 1, why: `${count} lines; the budget is ${budget}. Point to the code or the plan instead of copying it` });
  return out;
}

/** Files whose words count as "mentioned in source" for a named identifier. The lockfile is data, not source. */
const SOURCE_FILE = /\.(?:ts|tsx|mts|cts|mjs|js|json|jsonc|yml|yaml|toml|sh)$/;

/** Repository-wide rules: the CLAUDE.md links, the skills' names and the harness directories' links. */
function structural(cwd, files) {
  const out = [];
  for (const doc of files.filter((f) => base(f) === 'AGENTS.md')) {
    const claude = path.posix.join(path.posix.dirname(doc), 'CLAUDE.md');
    let link = null;
    try {
      link = lstatSync(path.join(cwd, claude)).isSymbolicLink() ? readlinkSync(path.join(cwd, claude)) : 'a copy';
    } catch {
      // Missing: reported below.
    }
    if (link !== 'AGENTS.md') out.push({ file: claude, code: 'claude-link', line: 1, why: `must be a symlink to AGENTS.md (found ${link ?? 'nothing'})` });
  }
  const skillsDir = path.join(cwd, 'skills');
  for (const name of existsSync(skillsDir) ? readdirSync(skillsDir).sort() : []) {
    const file = path.join(skillsDir, name, 'SKILL.md');
    const declared = existsSync(file) ? frontmatterName(readFileSync(file, 'utf8')) : null;
    if (declared !== name) out.push({ file: `skills/${name}/SKILL.md`, code: 'skill-name', line: 1, why: `frontmatter name is ${declared ?? 'missing'}, not ${name}` });
  }
  for (const dir of HARNESS_DIRS) {
    const full = path.join(cwd, dir);
    for (const entry of existsSync(full) ? readdirSync(full).sort() : []) {
      let ok = false;
      try {
        const link = path.join(full, entry);
        ok = lstatSync(link).isSymbolicLink() && existsSync(path.join(skillsDir, entry)) && realpathSync(link) === realpathSync(path.join(skillsDir, entry));
      } catch {
        // Not a link into skills/.
      }
      if (!ok) out.push({ file: `${dir}/${entry}`, code: 'harness-link', line: 1, why: `must be a symlink to skills/${entry}; skills have one source` });
    }
  }
  return out;
}

/** Every violation in the repository at `cwd`, as `{file, code, line, why}`. */
export function findViolations(cwd) {
  const pkg = JSON.parse(readFileSync(path.join(cwd, 'package.json'), 'utf8'));
  const scripts = new Set(Object.keys(pkg.scripts ?? {}));
  const exists = (p) => existsSync(path.join(cwd, p));
  const files = repoFiles(cwd);
  // repoFiles lists files only; a link to a directory (.claude/skills/handoff) is a path git knows too.
  const listed = git(['ls-files', '-z', '--cached', '--others', '--exclude-standard'], cwd).split('\0').filter(Boolean);
  const tracked = new Set(listed);
  const dirs = new Set(listed.flatMap((f) => f.split('/').slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join('/'))));
  const known = (p) => tracked.has(p.replace(/\/$/, '')) || dirs.has(p.replace(/\/$/, ''));
  let words = null;
  const mentioned = (w) => {
    words ??= new Set(files.filter((f) => SOURCE_FILE.test(f) && f !== 'pnpm-lock.yaml').flatMap((f) => readFileSync(path.join(cwd, f), 'utf8').match(/[A-Za-z_$][\w$]*/g) ?? []));
    return words.has(w);
  };
  const out = [];
  for (const file of files) {
    if (!inScope(file)) continue;
    for (const v of violationsIn(file, readFileSync(path.join(cwd, file), 'utf8'), { exists, scripts, known, isDir: (d) => dirs.has(d), mentioned })) out.push({ file, ...v });
  }
  return [...out, ...structural(cwd, files)];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const violations = findViolations(repoRoot());
  for (const v of violations) console.error(`${v.file}:${v.line}: ${v.code}: ${v.why}`);
  console.log(`check-agent-docs: ${violations.length} violation(s)`);
  if (violations.length > 0) process.exit(1);
}
