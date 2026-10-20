// The tools a sub-agent reads with (M7.2), by allowlist: the person's memory reads and the public
// Hacker News reads. Nothing that writes, sends or touches a company resource is offered, and the
// sub-agent gate refuses anything but a plain observation besides.
import type { Egress } from "../connectors/egress.ts";
import { hackerNewsNamespace } from "../connectors/hackernews.ts";
import { type MemoryApi, memorySpecs } from "../memory/tools.ts";
import type { Namespace } from "../tools/registry.ts";

export const SUBAGENT_READS = new Set(["memory_search", "memory_get", "memory_explain", "hn_top", "hn_item"]);

export function subAgentReads(o: { person: string; memory?: MemoryApi; egress?: Egress; source: string }): Namespace[] {
  const out: Namespace[] = [];
  if (o.memory) {
    const tools = memorySpecs({ api: o.memory, requester: o.person, setting: { scope: "personal" }, source: o.source });
    out.push({ name: "memory", description: "the person's memory, read only", deferral: "eager", tools: tools.filter((t) => SUBAGENT_READS.has(t.name)) });
  }
  if (o.egress) {
    const hn = hackerNewsNamespace(o.egress);
    out.push({ ...hn, tools: hn.tools.filter((t) => SUBAGENT_READS.has(t.name)) });
  }
  return out;
}
