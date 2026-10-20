// A published package must not carry the workspace's `development` export condition: it points at ./src, which is
// not in `files`. `publishConfig.exports` replaces `exports` at pack time (pnpm publish, which changesets uses
// here), so that is the shape consumers get. This reads each publishable package and checks it.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, normalize } from "node:path";
import { test } from "node:test";

const root = join(import.meta.dirname, "..", "packages");
const publishable = readdirSync(root)
  .map((dir) => ({ dir, manifest: JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8")) }))
  .filter(({ manifest }) => manifest.private !== true && manifest.publishConfig);

const targets = (value) => (typeof value === "string" ? [value] : Object.values(value).flatMap(targets));
const keys = (value) => (typeof value === "string" ? [] : Object.entries(value).flatMap(([k, v]) => [k, ...keys(v)]));

test("[F1] the publishable packages are found", () => {
  assert.deepEqual(publishable.map((p) => p.manifest.name).toSorted(), ["@qyvr/host", "@qyvr/host-cloudflare"]);
});

for (const { dir, manifest } of publishable) {
  test(`[F1] ${manifest.name}: publishConfig.exports has no development condition and points only inside files`, () => {
    const published = manifest.publishConfig.exports;
    assert.ok(published, "publishConfig.exports is required: the workspace exports point at src");
    assert.ok(!keys(published).includes("development"), "no development key");
    const files = manifest.files.map((f) => normalize(f));
    for (const target of targets(published)) {
      const path = normalize(target);
      assert.ok(!path.startsWith("src"), `${target} is in src`);
      assert.ok(files.some((f) => path === f || path.startsWith(`${f}/`)), `${target} is outside files (${dir})`);
    }
  });
}
