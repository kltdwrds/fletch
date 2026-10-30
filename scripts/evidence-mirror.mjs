// A best-effort, one-way mirror of the git-ignored evidence folder (design §4.4, D-0014) to a folder outside every
// worktree, so a worktree cleanup cannot delete the only copy of a capture a contract cites. Never overwrites, never
// deletes, never fails: the folder is append-only with one writer, so there is nothing to merge. Exit code is 0 always.
//
//   node scripts/evidence-mirror.mjs [--from <dir>] [--to <dir>]
//
// Defaults: from `docs/plan-v2/evidence/` of this checkout, to `$FLETCH_EVIDENCE_MIRROR` or `~/fletch-evidence/`.
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const root = fileURLToPath(new URL('..', import.meta.url));
const from = path.resolve(arg('--from') ?? path.join(root, 'docs/plan-v2/evidence'));
const to = path.resolve(arg('--to') ?? process.env.FLETCH_EVIDENCE_MIRROR ?? path.join(homedir(), 'fletch-evidence'));

/** Copies every file under `from` that is not yet under `to`; returns the counts. Throws only on a broken source. */
export function mirror(from, to) {
  let copied = 0;
  let kept = 0;
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const src = path.join(dir, entry);
      const dst = path.join(to, path.relative(from, src));
      if (statSync(src).isDirectory()) {
        walk(src);
        continue;
      }
      if (existsSync(dst)) {
        kept++;
        continue;
      }
      mkdirSync(path.dirname(dst), { recursive: true });
      copyFileSync(src, dst);
      copied++;
    }
  };
  walk(from);
  return { copied, kept };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (!existsSync(from)) throw new Error(`no evidence folder at ${from}`);
    const { copied, kept } = mirror(from, to);
    console.log(`evidence-mirror: copied ${copied}, kept ${kept}, at ${to}`);
  } catch (err) {
    console.error(`evidence-mirror: skipped (${err instanceof Error ? err.message : String(err)})`);
  }
  process.exit(0);
}
