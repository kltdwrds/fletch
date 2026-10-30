// `tool_search`: the discovery and loading path for deferred namespaces (muse-reference section
// 3's `tool_search.load_tool_namespace`). A search looks over every namespace, hidden ones
// included; a load injects the schemas into the live tool array and the engine records the
// namespace as loaded for the session.
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { type EffectBuffer, sendToUserTool } from "../chat/tools.ts";
import { type Namespace, specsOf, type ToolSession, type ToolSpec } from "./registry.ts";

const Params = Type.Object({
  query: Type.Optional(Type.String({ minLength: 1, description: "Words describing what you need to do; matched against tool names and descriptions." })),
  load: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 8, description: "Namespaces to load; their tools become callable from the next step and stay loaded." })),
});

/** `session` is read at call time: the core namespace is built before the session that holds it. */
export function toolSearchSpec(sessionRef: () => ToolSession, onLoaded: (loaded: ReadonlySet<string>) => void): ToolSpec<typeof Params> {
  return {
    name: "tool_search",
    kind: "observation",
    label: "Find and load tools",
    description: "Find tools by what they do, across every namespace, and load a namespace's schemas so its tools can be called. Use it before saying a capability is missing.",
    parameters: Params,
    execute: async (_id, p) => {
      const session = sessionRef();
      const lines: string[] = [];
      if (p.load?.length) {
        const r = session.load(p.load);
        if (!r.ok) throw new Error(`${r.code}: ${r.reason}`);
        if (r.loaded.length) {
          onLoaded(session.loaded);
          lines.push(`loaded ${r.loaded.join(", ")}: callable from your next step (${r.loaded.flatMap((n) => session.registry.namespace(n)?.tools.map((t) => t.name) ?? []).join(", ")})`);
        }
        if (r.already.length) lines.push(`already loaded: ${r.already.join(", ")}`);
      }
      if (p.query) {
        const hits = session.registry.search(p.query, session.loaded);
        lines.push(`${hits.length} tools match "${p.query}"`);
        for (const h of hits.slice(0, 20)) lines.push(`- ${h.tool} (${h.namespace}${h.loaded ? "" : ", not loaded"}, ${h.kind}): ${h.description}`);
      }
      if (!lines.length) throw new Error("TOOL_SEARCH_EMPTY: give a query, namespaces to load, or both");
      return { content: [{ type: "text", text: lines.join("\n") }], details: { loaded: [...session.loaded] } };
    },
  };
}

/** The `core` namespace of every chat: `send_to_user` and `react` (F10), which queue their own effects, and `tool_search`. */
export function coreNamespace(effects: EffectBuffer, sessionRef: () => ToolSession, onLoaded: (loaded: ReadonlySet<string>) => void, react: ToolSpec): Namespace {
  const send = specsOf([sendToUserTool(effects) as unknown as AgentTool<never>], "action")[0] as ToolSpec;
  return { name: "core", description: "this chat and the tool catalog", deferral: "eager", tools: [{ ...send, queues: "self" }, react, toolSearchSpec(sessionRef, onLoaded)] };
}
