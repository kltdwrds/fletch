// The tools a sub-agent reads with (M7.2), by allowlist: the public Hacker News reads. Nothing that writes, sends or
// touches a company resource is offered, and the sub-agent gate refuses anything but a plain observation besides. A
// sub-agent gets no memory tools (P6 delta 5, F27): what it needs of the person's memory rides in its brief, and the
// gate refuses a memory tool by code even when one is offered.
import type { Egress } from "../connectors/egress.ts";
import { hackerNewsNamespace } from "../connectors/hackernews.ts";
import type { Namespace } from "../tools/registry.ts";

export const SUBAGENT_READS = new Set(["hn_top", "hn_item"]);

export function subAgentReads(o: { egress?: Egress }): Namespace[] {
  const out: Namespace[] = [];
  if (o.egress) {
    const hn = hackerNewsNamespace(o.egress);
    out.push({ ...hn, tools: hn.tools.filter((t) => SUBAGENT_READS.has(t.name)) });
  }
  return out;
}
