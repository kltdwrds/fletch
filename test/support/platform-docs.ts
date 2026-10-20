// The platform docs folder as rollout writes it (M24.1): `docs/platform/<slug>.md` keyed objects.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DOCS_PREFIX } from "../../packages/agent/src/skills/platform-docs.ts";

export const DOCS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../packages/agent/docs/platform/");

export function platformDocFiles(): Array<{ key: string; text: string }> {
  return readdirSync(DOCS_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => ({ key: `${DOCS_PREFIX}${f}`, text: readFileSync(`${DOCS_DIR}${f}`, "utf8") }));
}

export async function seedPlatformDocs(r2: { put(key: string, text: string): Promise<unknown> }): Promise<void> {
  for (const f of platformDocFiles()) await r2.put(f.key, f.text);
}
