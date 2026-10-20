// M25.1 item 3, the guard at the tool boundary: whatever a tool returns or throws reaches the model, the
// transcript and a spilled file only after every surrogate in it is scrubbed, on the loop's path
// (`toAgentTool`) and on an approved action's (`ToolSession.perform`). A tool that hands back a
// surrogate, as code given one might, is the planted violation.
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { mintSurrogate, SURROGATE_MARK } from "../../packages/agent/src/egress/surrogate.ts";
import { type Gate, type ToolSpec, ToolRegistry, ToolSession, toAgentTool } from "../../packages/agent/src/tools/registry.ts";

const s = mintSurrogate();
const leak = (kind: "observation" | "action", how: "return" | "throw"): ToolSpec => ({
  name: `leak_${kind}_${how}`,
  kind,
  label: "Leak",
  description: "Returns or throws a surrogate, as code given one might.",
  parameters: Type.Object({}),
  ...(kind === "action" ? { actionKind: "test.leak" } : {}),
  execute: async () => {
    if (how === "throw") throw new Error(`CODE_SCRIPT_THREW: the script printed ${s}`);
    return { content: [{ type: "text", text: `here is the key ${s}` }], details: { token: s, nested: [{ again: s }] } } as AgentToolResult<unknown>;
  },
});
const allow: Gate = { call: async (_spec, _id, _args, run) => run() };

describe("[M25.1] the surrogate scrub at the tool boundary", () => {
  it("a tool result and a thrown reason reach the loop with every surrogate replaced by its marker", async () => {
    const out = await toAgentTool(leak("observation", "return"), allow).execute("t1", {} as never);
    expect(JSON.stringify(out)).not.toContain(s);
    expect(out.content).toEqual([{ type: "text", text: `here is the key ${SURROGATE_MARK}` }]);
    expect(out.details).toEqual({ token: SURROGATE_MARK, nested: [{ again: SURROGATE_MARK }] });
    await expect(toAgentTool(leak("observation", "throw"), allow).execute("t2", {} as never)).rejects.toThrow(`CODE_SCRIPT_THREW: the script printed ${SURROGATE_MARK}`);
  });

  it("an approved action's result and failure, which the chat shows in a note, are scrubbed the same way", async () => {
    const session = new ToolSession(new ToolRegistry([{ name: "leaks", description: "test", deferral: "eager", tools: [leak("action", "return"), leak("action", "throw")] }]), []);
    const done = await session.perform("e1", "leak_action_return", {}, "g_test");
    expect(done).toEqual({ ok: true, text: `here is the key ${SURROGATE_MARK}` });
    const failed = await session.perform("e2", "leak_action_throw", {}, "g_test");
    expect(failed).toEqual({ ok: false, code: "CODE_SCRIPT_THREW", reason: `the script printed ${SURROGATE_MARK}` });
  });

  it("the scrub is the guard: the same tool's raw result carries the surrogate", async () => {
    const raw = await leak("observation", "return").execute("t3", {} as never);
    expect(JSON.stringify(raw)).toContain(s);
  });
});
