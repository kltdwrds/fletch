#!/usr/bin/env node
// The agent-docs check (harness-conventions.md, M15.5): the instruction files an agent follows must
// not rot. Files in scope: CLAUDE.md, docs/runbooks/*.md, packages/agent/docs/platform/*.md and every SKILL.md. Rules, each with a code:
//   - broken-link:    a relative markdown link `](path)` whose target (fragment and query removed,
//                     resolved from the file's directory) does not exist; http(s), mailto and bare
//                     `#anchor` links are not checked;
//   - unknown-script: a line in a fenced block that runs `pnpm <name>` where <name> is neither a script
//                     in package.json nor one of pnpm's own commands used here (install, i, add, exec,
//                     dlx, run <script>), nor a flag;
//   - dump:           any mention of the dump's directory name (KICKOFF.md: off limits);
//   - runbook-shape:  a runbook (docs/runbooks/*.md) that does not start with an H1 title or has
//                     neither a `## Steps` nor a `## When` section (the index, README.md, needs only
//                     the title);
//   - docs-frontmatter: a platform doc (packages/agent/docs/platform/*.md, M24.1) without `summary` and
//                     `read_when` frontmatter; the folder is also checked for the rules above;
//   - secret-shape:   a string shaped like a credential (scripts/lib/secret-patterns.ts), reported by
//                     rule name, never by value.
// Every violation fails the check; there is no allowlist.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchSecret } from './lib/secret-patterns.ts';
import { repoFiles, repoRoot } from './lib/repo-files.mjs';

const PNPM_OWN = new Set(['install', 'i', 'add', 'exec', 'dlx', 'run', 'update', 'up', 'remove', 'rm']);
const DUMP = ['harness', 'dump'].join('-');

export const inScope = (file) => file === 'CLAUDE.md' || isPlatformDoc(file) || /^docs\/runbooks\/[^/]+\.md$/.test(file) || /(?:^|\/)SKILL\.md$/.test(file);
const isPlatformDoc = (file) => /^packages\/agent\/docs\/platform\/[^/]+\.md$/.test(file);
const isRunbook = (file) => /^docs\/runbooks\/[^/]+\.md$/.test(file);

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

/**
 * Violations of one file as `{code, line, why}`. `exists(relPath)` answers for repository-relative
 * paths and `scripts` is the set of package.json script names.
 */
export function violationsIn(file, text, { exists, scripts }) {
  const out = [];
  const lines = text.split('\n');
  const dir = path.posix.dirname(file);
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
  return out;
}

/** Every violation in the repository at `cwd`, as `{file, code, line, why}`. */
export function findViolations(cwd) {
  const pkg = JSON.parse(readFileSync(path.join(cwd, 'package.json'), 'utf8'));
  const scripts = new Set(Object.keys(pkg.scripts ?? {}));
  const exists = (p) => existsSync(path.join(cwd, p));
  const out = [];
  for (const file of repoFiles(cwd)) {
    if (!inScope(file)) continue;
    for (const v of violationsIn(file, readFileSync(path.join(cwd, file), 'utf8'), { exists, scripts })) out.push({ file, ...v });
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const violations = findViolations(repoRoot());
  for (const v of violations) console.error(`${v.file}:${v.line}: ${v.code}: ${v.why}`);
  console.log(`check-agent-docs: ${violations.length} violation(s)`);
  if (violations.length > 0) process.exit(1);
}
