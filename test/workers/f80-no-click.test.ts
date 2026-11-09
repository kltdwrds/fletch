// F80, delta 3 (P16 B-P16-08, B-P16-09; D-0027 (a)): the browse lane holds no action that clicks, checks, types free
// text or submits, so no cart, hold, terms box, cookie banner or account can be touched by the agent. The guard iterates
// `browseNamespace`'s tools as the chat is given them (with the saved-login api, so `browse_keep_site` is there too) and
// fails on any tool outside open, live, handoff, fill and keep_site, or whose name, label or description says it acts on
// a page. Planted: a click tool added to the namespace fails it.
import { describe, expect, it } from "vitest";
import { browseNamespace } from "../../packages/agent/src/browse/tools.ts";
import type { Namespace, ToolSpec } from "../../packages/agent/src/tools/registry.ts";

const LANE = ["browse_open", "browse_live", "browse_handoff", "browse_fill", "browse_keep_site"];
/** Words of a tool that acts on a page; `browse_fill`'s own words are a stored credential typed by reference, read apart. */
const ACTS = /\b(click|clicks|tick|ticks|press|presses|submit|submits|check (a|the) box|accept|agree|add to cart|checkout|select an option|type (text|free text|into))\b/i;

const namespace = (): Namespace =>
  browseNamespace({
    port: {} as never,
    memory: { get: async () => null, record: async () => {} } as never,
    urls: {} as never,
    session: { get: () => null, set: () => {} },
    logins: { save: async () => ({ ok: false, code: "X", reason: "x" }), restore: async () => ({ ok: false, code: "X", reason: "x" }) },
    now: () => 0,
  });

/** Each tool the lane must not hold, by name, with why. */
function clickTools(ns: Namespace): string[] {
  return ns.tools.flatMap((t) => {
    if (!LANE.includes(t.name)) return [`${t.name}: not in the lane`];
    const words = t.name === "browse_fill" ? `${t.name} ${t.label}` : `${t.name} ${t.label} ${t.description}`;
    return ACTS.test(words) ? [`${t.name}: acts on the page`] : [];
  });
}

describe("[F80] the browse lane has no click (delta 3, D-0027 (a))", () => {
  it("holds open, live, handoff, fill and keep_site, and none of them clicks, checks, types or submits", () => {
    const ns = namespace();
    expect(ns.tools.map((t) => t.name).sort()).toEqual([...LANE].sort());
    expect(clickTools(ns)).toEqual([]);
  });

  it("planted: a click tool added to the namespace, or a lane tool that says it submits, fails the guard", () => {
    const ns = namespace();
    const click = { ...ns.tools[0], name: "browse_click", label: "Click an element", description: "Click a button or link on the live page." } as ToolSpec;
    expect(clickTools({ ...ns, tools: [...ns.tools, click] })).toEqual(["browse_click: not in the lane"]);
    const live = ns.tools.find((t) => t.name === "browse_live") as ToolSpec;
    const submits = { ...live, description: `${live.description} It can also submit the form on the page.` } as ToolSpec;
    expect(clickTools({ ...ns, tools: ns.tools.map((t) => (t.name === "browse_live" ? submits : t)) })).toEqual(["browse_live: acts on the page"]);
  });
});
