#!/usr/bin/env node
// The boundary check, adapted from qyvr-co's scripts/check-boundaries.mjs. Three rules over packages/:
//   no-fletch       no import whose specifier is `fletch` or starts with `fletch/`.
//   no-deep-import  no import of a @qyvr/* package's internals: a `@qyvr/` specifier with a third path segment.
//   no-cloudflare-workers  nothing under packages/host/ imports a `cloudflare:` specifier (it stays platform-free).
// An import is held by its module: named, default, namespace, type-only, side-effect, dynamic, `require`
// and `export ... from` all count. Each file is read as written and with comments blanked; either reading
// may report. To add a rule, add a row here and a planted-violation case to the test beside this file.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { blankComments, lineAt } from './lib/blank.mjs';
import { repoFiles, repoRoot } from './lib/repo-files.mjs';

export const RULES = [
  {
    name: 'no-fletch',
    why: 'qyvr-js never imports from fletch; the dependency points the other way',
    scope: /^packages\//,
    banned: [/^fletch(?:\/|$)/],
  },
  {
    name: 'no-deep-import',
    why: "import a @qyvr/* package by its name only (@qyvr/<name>), never a path inside it",
    scope: /^packages\//,
    banned: [/^@qyvr\/[^/]+\/./],
  },
  {
    name: 'no-cloudflare-workers',
    why: '@qyvr/host is platform-free; cloudflare: modules belong in @qyvr/host-cloudflare',
    scope: /^packages\/host\//,
    banned: [/^cloudflare:/],
  },
];

const CODE = /\.(?:[cm]?[jt]sx?)$/;
/** `import ... from 'x'` and `export ... from 'x'`, the clause possibly over several lines. */
const FROM = /\b(?:import|export)\s+(?:type\s+)?(?:\{[^}]*\}|\*(?:\s+as\s+[\w$]+)?|[\w$]+(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+[\w$]+))?)\s*from\s*(['"])([^'"\n]+)\1/g;
/** `import 'x'`, `import('x')` and `require('x')`. */
const BARE = /\b(?:import\s*\(?|require\s*\()\s*(['"])([^'"\n]+)\1/g;

/** Each module specifier in `text` with its offset. */
function specifiers(text) {
  const out = [];
  for (const m of text.matchAll(FROM)) out.push({ spec: m[2], at: m.index });
  for (const m of text.matchAll(BARE)) out.push({ spec: m[2], at: m.index });
  return out;
}

/** Every banned import in every file a rule covers, as `{rule, file, line, spec, why}`, in file then line order. */
export function findViolations(cwd, rules = RULES) {
  const violations = [];
  for (const file of repoFiles(cwd)) {
    if (!CODE.test(file)) continue;
    const applicable = rules.filter((r) => r.scope.test(file) && !r.exempt?.test(file));
    if (applicable.length === 0) continue;
    const text = readFileSync(path.join(cwd, file), 'utf8');
    const found = new Map();
    for (const { spec, at } of [...specifiers(text), ...specifiers(blankComments(text))]) {
      for (const r of applicable) {
        if (!r.banned.some((re) => re.test(spec))) continue;
        const v = { rule: r.name, file, line: lineAt(text, at), spec, why: r.why };
        found.set(`${v.rule}\0${v.line}\0${v.spec}`, v);
      }
    }
    violations.push(...[...found.values()].sort((a, b) => a.line - b.line));
  }
  return violations;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const violations = findViolations(repoRoot());
  for (const v of violations) console.error(`${v.file}:${v.line}: ${v.rule}: ${v.spec}: ${v.why}`);
  console.log(`check-boundaries: ${RULES.length} rule(s), ${violations.length} violation(s)`);
  if (violations.length > 0) process.exit(1);
}
