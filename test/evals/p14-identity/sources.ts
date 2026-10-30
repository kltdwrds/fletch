// The sources under `packages/agent/src`, read as text for the P14 graders that name a writer or a reach into sign-in
// (F40; split from harness.ts at F41 so the slot world reads them under plain Node, without the worker harnesses).
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { repoRoot } from "../../support/temp-repo.ts";

const SRC = join(repoRoot, "packages/agent/src");

/** Every `.ts` file under `packages/agent/src`, with its path relative to it. */
export const sources = (): Array<{ file: string; text: string }> => {
  const out: Array<{ file: string; text: string }> = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".ts")) out.push({ file: relative(SRC, p), text: readFileSync(p, "utf8") });
    }
  };
  walk(SRC);
  return out;
};

/** The calls of `writeStanding` in `files` (its definition aside), with the writer each passes. */
export const standingCallersIn = (files: Array<{ file: string; text: string }>) =>
  files.flatMap((f) => [...f.text.matchAll(/(?<!async )\bwriteStanding\(([^;]*?)\)/g)].map((m) => ({ file: f.file, writer: /"([^"]+)"\s*$/.exec(m[1] ?? "")?.[1] ?? "" })));
/** The files in `files` that call `loginCall` or a `passkey*` or `recovery*` operation. */
export const loginReachIn = (files: Array<{ file: string; text: string }>) => [...new Set(files.filter((f) => /\bloginCall\s*[<(]|\.\s*(passkey|recovery)\w*\s*\(/i.test(f.text)).map((f) => f.file))].sort();
