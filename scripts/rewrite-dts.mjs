// Declaration files keep the `.ts` extensions of the relative imports in the sources (tsc rewrites them in the
// emitted JavaScript only), so a consumer's compiler would look for modules that are not in the package. Run
// after `tsc -p tsconfig.build.json`: rewrites `./x.ts` to `./x.js` in every .d.ts under the given directory.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export function rewriteSpecifiers(text) {
  return text.replace(/(\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)(["'])(\.{1,2}\/[^"']*?)\.ts\2/g, "$1$2$3.js$2");
}

export function rewriteDirectory(dir) {
  let changed = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) changed += rewriteDirectory(path);
    else if (entry.name.endsWith(".d.ts")) {
      const before = readFileSync(path, "utf8");
      const after = rewriteSpecifiers(before);
      if (after !== before) {
        writeFileSync(path, after);
        changed++;
      }
    }
  }
  return changed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2];
  if (!dir) throw new Error("usage: node scripts/rewrite-dts.mjs <dist directory>");
  rewriteDirectory(dir);
}
