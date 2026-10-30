// Types for ./test-host-child.mjs (F32), for the hermetic test that runs it.
import type { BrowserBinding } from "../../packages/agent/src/browse/binding.ts";
import type { Namespace } from "../../packages/agent/src/tools/registry.ts";
export declare function childBrowse(person: string, brief: string, binding: BrowserBinding, now?: () => number): Namespace;
