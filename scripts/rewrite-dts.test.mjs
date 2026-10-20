import assert from "node:assert/strict";
import { test } from "node:test";
import { rewriteSpecifiers } from "./rewrite-dts.mjs";

test("[F1] rewrite-dts: relative .ts specifiers become .js, package specifiers stay", () => {
  const src = [
    'export { a } from "./keys.ts";',
    'import { type B } from "../x/y.ts";',
    'import type { C } from "@qyvr/host";',
    'type D = import("./d.ts").D;',
    'export * from "./index.js";',
  ].join("\n");
  assert.equal(
    rewriteSpecifiers(src),
    ['export { a } from "./keys.js";', 'import { type B } from "../x/y.js";', 'import type { C } from "@qyvr/host";', 'type D = import("./d.js").D;', 'export * from "./index.js";'].join("\n"),
  );
});

test("[F1] rewrite-dts: a side-effect import and a multi-line from are rewritten; a .d.ts specifier is left alone", () => {
  const src = ['import "./side.ts";', "export {", "  a,", "  b,", '} from "./multi.ts";', 'export type { T } from "./types.d.ts";'].join("\n");
  assert.equal(rewriteSpecifiers(src), ['import "./side.js";', "export {", "  a,", "  b,", '} from "./multi.js";', 'export type { T } from "./types.d.ts";'].join("\n"));
});
