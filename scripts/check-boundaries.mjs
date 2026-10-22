#!/usr/bin/env node
// The boundary check, merged from qyvr-co's scripts/check-boundaries.mjs and the primitives' own; it holds decision D-0003
// (docs/decisions/0003-primitives-never-depend-on-the-app.md). Rules over packages/:
//   no-fletch              nothing under packages/host/ or packages/host-cloudflare/ imports the app: packages/agent/,
//                          packages/create-fletch/ (by path) or the agent's package name. Primitives never depend on the app.
//   no-deep-import         no import of a @qyvr/* package's internals: a `@qyvr/` specifier with a third path segment.
//   no-cloudflare-workers  nothing under packages/host/ imports a `cloudflare:` specifier (it stays platform-free).
//   file-vocabulary*       the agent has one file vocabulary (M24.3).
//   agent-fetch            the agent reaches the network only through egress/outbound.ts and named bindings (M25.1).
// An import is held by its module: named, default, namespace, type-only, side-effect, dynamic, `require` and
// `export ... from` all count, and a relative path is resolved from its file so `../../agent/src/x.ts` is caught as
// surely as a package name. Each file is read twice, as written and with its comments blanked, and what either
// reading finds is reported: blanking catches an import a `}` in a comment would hide, and a comment it misreads can
// hide nothing the raw reading sees. A name rule reads the code with comments blanked only.
//
// `agent-fetch` (M25.1, spec P4) holds the agent script's network to the egress module and named bindings:
// a global `fetch` (called, aliased or read off `globalThis`) appears only in egress/outbound.ts. A binding's or a
// stub's `.fetch(` is not global and passes. The pages' browser scripts, which the agent serves but never runs, are
// exempt by file. To add a rule, add a row here and a planted-violation case to the test beside this file.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { blankComments, lineAt } from './lib/blank.mjs';
import { repoFiles, repoRoot } from './lib/repo-files.mjs';

export const RULES = [
  {
    name: 'no-fletch',
    why: 'the primitives (@qyvr/host, @qyvr/host-cloudflare) never import the app: not packages/agent, packages/create-fletch, nor the agent package (fletch-agent)',
    scope: /^packages\/host(?:-cloudflare)?\//,
    banned: [/^fletch-agent(?:\/|$)/, /^create-fletch(?:\/|$)/, /(?:^|\/)packages\/(?:agent|create-fletch)(?:\/|$)/],
  },
  {
    name: 'no-deep-import',
    why: 'import a @qyvr/* package by its name only (@qyvr/<name>), never a path inside it',
    scope: /^packages\//,
    banned: [/^@qyvr\/[^/]+\/./],
  },
  {
    name: 'no-cloudflare-workers',
    why: '@qyvr/host is platform-free; cloudflare: modules belong in @qyvr/host-cloudflare',
    scope: /^packages\/host\//,
    banned: [/^cloudflare:/],
  },
  // One file vocabulary (M24.3, spec P3). The agent's file tools are defined in files/tools.ts alone;
  // only tree/ holds the Agents SDK Workspace; the home store keeps read, write, list and delete and
  // implements no edit, grep or find, so no second vocabulary grows beside the working tree.
  {
    name: 'file-vocabulary',
    why: 'the agent has one file vocabulary: a file tool (file_*, fs_*, tree_*, work_*, or any *_edit, *_grep, *_find) is defined only in packages/agent/src/files/tools.ts (M24.3)',
    scope: /^packages\/agent\/src\//,
    exempt: /^packages\/agent\/src\/files\/tools\.ts$/,
    names: [/\bname\s*:\s*['"`](?:file|files|fs|tree|work|dir)_\w+['"`]/, /\bname\s*:\s*['"`]\w+_(?:edit|grep|find)['"`]/],
  },
  {
    name: 'file-vocabulary-workspace',
    why: 'only packages/agent/src/tree/ holds the Agents SDK Workspace (@cloudflare/computer), the working tree work/ (M24.3)',
    scope: /^packages\/agent\/src\//,
    exempt: /^packages\/agent\/src\/tree\//,
    banned: [/^@cloudflare\/computer(?:\/|$)/],
  },
  {
    name: 'file-vocabulary-store',
    why: 'the home store (files/store.ts) keeps read, write, list and delete; edit, grep and find are the working tree\'s alone (M24.3)',
    scope: /^packages\/agent\/src\/files\/store\.ts$/,
    names: [/^[ \t]*(?:(?:private|public|async|static)\s+)*(?:edit|grep|find|search|replace)\w*\s*[(<]/m, /\b(?:edit|grep|find)\w*\s*[:=]\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>/],
  },
  {
    name: 'agent-fetch',
    why: "the agent script reaches the network only through the egress module and named bindings: a global fetch stands only in packages/agent/src/egress/outbound.ts (M25.1)",
    scope: /^packages\/agent\/src\//,
    exempt: /^packages\/agent\/src\/(?:egress\/outbound\.ts$|http\/(?:page|admin-page|app\/(?:settings|chat|shell))\.ts$|design\/fletch\/prototype\/)/,
    // A call, not a method's declaration (`async fetch(`, `fetch(request: Request)`) nor prose (`fetch()`).
    names: [/(?<![\w$.'"`]|\basync\s+)\bfetch\s*\((?!\s*\)|\s*[\w$]+\s*\??\s*:)/, /\b(?:globalThis|self|window)\s*\.\s*fetch\b/, /(?<![\w$.'"`?])\bfetch(?=\s*[,;)\]}])/],
  },
];

const CODE = /\.(?:[cm]?[jt]sx?)$/;
/** `import … from 'x'` and `export … from 'x'`, the clause possibly over several lines. */
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

/** A relative specifier as the repository path it names from `file`; any other as written. */
const resolved = (file, spec) => (spec.startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(file), spec)) : spec);

/** Every banned import in every file a rule covers, as `{rule, file, line, spec, why}`, in file then line order. */
export function findViolations(cwd, rules = RULES) {
  const violations = [];
  for (const file of repoFiles(cwd)) {
    if (!CODE.test(file)) continue;
    const applicable = rules.filter((r) => r.scope.test(file) && !r.exempt?.test(file));
    if (applicable.length === 0) continue;
    const text = readFileSync(path.join(cwd, file), 'utf8');
    const found = new Map();
    const note = (r, at, spec) => {
      const v = { rule: r.name, file, line: lineAt(text, at), spec, why: r.why };
      found.set(`${v.rule}\0${v.line}\0${v.spec}`, v);
    };
    const blanked = blankComments(text);
    for (const { spec, at } of [...specifiers(text), ...specifiers(blanked)]) {
      const target = resolved(file, spec);
      for (const r of applicable) {
        if (!r.banned?.some((re) => re.test(target)) || r.allow?.some((re) => re.test(target))) continue;
        note(r, at, spec);
      }
    }
    // A name rule reads the code with its comments blanked, so only what the code says counts.
    for (const r of applicable) {
      for (const re of r.names ?? []) {
        for (const m of blanked.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`))) note(r, m.index, m[0]);
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
