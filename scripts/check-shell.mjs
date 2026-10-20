#!/usr/bin/env node
// The shell check (harness-conventions.md, M15.5): every git-tracked shell script (`*.sh`, or a file
// whose first line is a shell shebang) is run through `shellcheck`. Codes:
//   - none:                 no shell files, so there is nothing to check (passes);
//   - shellcheck-missing:   there are shell files and `shellcheck` is not installed (fails: a check
//                           that cannot run is never a pass);
//   - shellcheck-findings:  shellcheck reported findings in a file (fails, its output shown).
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoFiles, repoRoot } from './lib/repo-files.mjs';

const SHEBANG = /^#!\s*(?:\/usr\/bin\/env\s+)?(?:\S*\/)?(?:ba|z|da|k)?sh\b/;

/** Repository-relative shell scripts at `cwd`. */
export function shellFiles(cwd) {
  return repoFiles(cwd).filter((f) => {
    if (f.endsWith('.sh')) return true;
    if (/\.(?:[cm]?[jt]sx?|json|md|lock|ya?ml|png|jpe?g|svg|woff2?)$/.test(f)) return false;
    try {
      return SHEBANG.test(readFileSync(path.join(cwd, f), 'utf8').split('\n', 1)[0]);
    } catch {
      return false;
    }
  });
}

/** `{code, files, output}`: code is `none`, `ok`, `shellcheck-missing` or `shellcheck-findings`. */
export function check(cwd, env = process.env) {
  const files = shellFiles(cwd);
  if (files.length === 0) return { code: 'none', files, output: '' };
  const res = spawnSync('shellcheck', files, { cwd, encoding: 'utf8', env });
  if (res.error) return { code: 'shellcheck-missing', files, output: String(res.error.message) };
  const output = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  return { code: res.status === 0 ? 'ok' : 'shellcheck-findings', files, output };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = check(repoRoot());
  if (r.output) console.error(r.output.trim());
  console.log(`check-shell: ${r.code} (${r.files.length} shell file(s))`);
  if (r.code !== 'none' && r.code !== 'ok') process.exit(1);
}
