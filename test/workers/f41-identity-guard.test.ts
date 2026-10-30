// F41: the identity guard (F40's delta 5) over every tool production registers. On fletch-pv-1 every chat turn failed
// with `TOOL_IDENTITY_REFUSED: browse_save_login reaches "login"`: the site-login tool is registered only where a
// browser is bound, so no hermetic world built it. The browse namespace is built here with every dependency a deploy
// gives it, and every tool name in the sources is read against the guard, so a production tool the guard refuses
// fails here rather than on a deploy.
import { describe, expect, it } from "vitest";
import { browseNamespace } from "../../packages/agent/src/browse/tools.ts";
import { identityReach, SITE_LOGIN_TOOLS, ToolRegistry } from "../../packages/agent/src/tools/registry.ts";
import { sources } from "../evals/p14-identity/sources.ts";

const refused = () => {
  throw new Error("not called");
};
/** The browse namespace as a deploy with a browser binding builds it: the fill and the saved logins present. */
const browse = () =>
  browseNamespace({
    port: { goto: refused } as never,
    memory: { get: async () => null, record: async () => {} } as never,
    urls: { add: () => [], get: () => null } as never,
    session: { get: () => null, set: () => {} },
    fill: { fill: refused } as never,
    logins: { save: refused, restore: refused } as never,
    now: () => 0,
  });

describe("[F41] the identity guard over every production tool", () => {
  it("the browse namespace with a browser's every dependency builds a registry, the site-login tool in it", () => {
    const ns = browse();
    expect(ns.tools.map((t) => t.name)).toContain("browse_save_login");
    expect(() => new ToolRegistry([ns])).not.toThrow();
  });

  it("every tool named in the sources passes the guard by its name", () => {
    const names = sources().flatMap((f) => [...f.text.matchAll(/\bname: "([a-z][a-z0-9_]+)",\s*\n\s*kind: "/g)].map((m) => m[1] as string));
    expect(names).toContain("browse_save_login");
    expect(names.length).toBeGreaterThan(20);
    expect(names.filter((name) => identityReach({ name, description: "" }) !== null)).toEqual([]);
  });

  it("only the word login is let through, and only for a site-login tool: planted, the rest is refused", () => {
    expect(SITE_LOGIN_TOOLS).toEqual(["browse_save_login"]);
    // Planted: the same tool under another name, or the exemption leaning on a description that reaches sign-in.
    expect(identityReach({ name: "fletch_save_login", description: "Keep a login." })).toBe("login");
    expect(identityReach({ name: "browse_save_login", description: "Remove a passkey of the person's." })).toBe("passkey");
    const ns = browse();
    const save = ns.tools.find((t) => t.name === "browse_save_login")!;
    expect(() => new ToolRegistry([{ ...ns, tools: [{ ...save, name: "browse_login_reset" }] }])).toThrow('TOOL_IDENTITY_REFUSED: browse_login_reset reaches "login"');
  });
});
