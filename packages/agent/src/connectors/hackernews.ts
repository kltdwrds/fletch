// Hacker News (D8): the credential-free control, through the same egress module as GitHub.
import { Type } from "@earendil-works/pi-ai";
import type { Namespace, ToolSpec } from "../tools/registry.ts";
import { type Egress, getJson } from "./egress.ts";

export const HN_API = "https://hacker-news.firebaseio.com/v0";

const TopParams = Type.Object({ limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 10, description: "How many top stories (default 5)." })) });
const ItemParams = Type.Object({ id: Type.Integer({ minimum: 1, description: "The story or comment id." }) });

type Item = { id?: number; title?: string; by?: string; score?: number; url?: string; text?: string; type?: string };
const line = (i: Item) => `${i.id}: ${i.title ?? i.text ?? "(untitled)"} (${i.score ?? 0} points by ${i.by ?? "?"})${i.url ? ` ${i.url}` : ""}`;
const text = (t: string) => ({ content: [{ type: "text" as const, text: t }], details: {} });

export function hackerNewsNamespace(egress: Egress): Namespace {
  const top: ToolSpec<typeof TopParams> = {
    name: "hn_top",
    kind: "observation",
    label: "Hacker News top stories",
    description: "Read the current top stories on Hacker News with their scores and links.",
    parameters: TopParams,
    execute: async (_id, p) => {
      const ids = (await getJson(egress, "hn_top", `${HN_API}/topstories.json`)) as number[];
      if (!Array.isArray(ids)) throw new Error("CONNECTOR_BAD_JSON: expected a list of ids");
      const items = await Promise.all(ids.slice(0, p.limit ?? 5).map((id) => getJson(egress, "hn_top", `${HN_API}/item/${Number(id)}.json`) as Promise<Item>));
      return text(items.map(line).join("\n"));
    },
  };
  const item: ToolSpec<typeof ItemParams> = {
    name: "hn_item",
    kind: "observation",
    label: "Hacker News item",
    description: "Read one Hacker News story or comment by id.",
    parameters: ItemParams,
    execute: async (_id, p) => text(line((await getJson(egress, "hn_item", `${HN_API}/item/${p.id}.json`)) as Item)),
  };
  return { name: "hackernews", description: "read Hacker News stories", deferral: "names", tools: [top, item] as ToolSpec[] };
}
