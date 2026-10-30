// The P9 world's Example API and its fixture connector (F35, moved here by F37 so a preview slot's test host serves the
// same ones as the tier-1 harness): `probeAnswer` is what `https://api.example.com/p9-probe` answers (its count is
// 657; an item created is 201), and `fixtureNamespace` the connector over it, reached through the Vault's egress with
// Sam's key. Imports no test support, so a slot's Worker bundles it (`scripts/preview-slot/test-host.mjs`).
import { Type } from "@earendil-works/pi-ai";
import { type egressFor, getJson } from "../../../packages/agent/src/connectors/egress.ts";
import type { Namespace, ToolSpec } from "../../../packages/agent/src/tools/registry.ts";
import { API_HOST, API_REF, COUNT, PROBE_API } from "./world.ts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** The Example API's answer to `method url` under `/p9-probe`, or null for any other address. */
export function probeAnswer(url: string, method: string, body?: string): Response | null {
  const u = new URL(url);
  if (u.hostname !== API_HOST) return null;
  if (u.pathname === "/p9-probe/count") return json({ count: COUNT, view: "all" });
  if (u.pathname === "/p9-probe/items" && method === "POST") return json({ id: "item-1", name: (JSON.parse(body ?? "{}") as { name?: string }).name }, 201);
  if (u.pathname === "/p9-probe") return new Response("p9 probe: the Example API answered.", { status: 200, headers: { "content-type": "text/plain" } });
  return null;
}

const Name = Type.Object({ name: Type.Optional(Type.String({ description: "The item's name." })) });
const Url = Type.Object({ url: Type.String({ description: "The https address to read with the Example API key." }), credential: Type.Optional(Type.String({ description: "Another of the person's keys by reference, in place of the Example API key." })) });
const None = Type.Object({});
const text = (t: string, details: Record<string, unknown> = {}) => ({ content: [{ type: "text" as const, text: t }], details });

/**
 * The fixture connector (B-P9-06): a library at the Example API reached through the Vault's egress with Sam's key.
 * `fixture_count` and `fixture_read` are observations; `fixture_create` is an action of kind `fixture.create`, so the
 * gate asks for it unless a grant Sam signed covers it. No method declares a default of its own.
 */
export function fixtureNamespace(egress: () => (req: { url: string; method?: string; headers?: Array<[string, string]>; body?: string }, purpose: string) => ReturnType<ReturnType<typeof egressFor>>): Namespace {
  const auth: Array<[string, string]> = [["authorization", `Bearer ${API_REF}`]];
  const count: ToolSpec<typeof None> = {
    name: "fixture_count", kind: "observation", label: "Count the fixture library", external: true, parameters: None,
    description: "Count every item in the person's fixture library. It counts the whole library only; it has no view by day or by folder.",
    execute: async () => {
      const r = (await getJson(egress(), "fixture_count", `${PROBE_API}/count`, auth)) as { count: number };
      return text(`The fixture library holds ${r.count} items in all (this tool counts the whole library; it has no view by day).`);
    },
  };
  const read: ToolSpec<typeof Url> = {
    name: "fixture_read", kind: "observation", label: "Read with the Example API key", external: true, parameters: Url,
    description: "Read an https address with the person's Example API key and return what it says.",
    execute: async (_id, p) => {
      const r = await egress()({ url: p.url, method: "GET", headers: p.credential ? [["authorization", `Bearer ${p.credential}`]] : auth }, "fixture_read");
      if (!r.ok) throw new Error(`${r.code}: ${r.reason}`);
      return text(`status ${r.status}\n${r.body}`);
    },
  };
  const create: ToolSpec<typeof Name> = {
    name: "fixture_create", kind: "action", label: "Create a fixture item", parameters: Name, actionKind: "fixture.create",
    description: "Create one item in the person's fixture library.",
    subject: () => ({ scope: "personal", connector: "fixture" }),
    cardLines: async (a) => [`Create an item named ${String(a.name ?? "")} in your fixture library`],
    execute: async (_id, p) => {
      const r = await egress()({ url: `${PROBE_API}/items`, method: "POST", headers: [...auth, ["content-type", "application/json"]], body: JSON.stringify({ name: p.name ?? "" }) }, "fixture_create");
      if (!r.ok) throw new Error(`${r.code}: ${r.reason}`);
      if (r.status !== 201) throw new Error(`CONNECTOR_HTTP_${r.status}: ${r.body.slice(0, 200)}`);
      return text(`Created item ${(JSON.parse(r.body) as { id: string }).id} named ${p.name ?? ""}.`);
    },
  };
  return { name: "fixture", description: "count, read and add items in the person's fixture library at the Example API", deferral: "names", tools: [count, read, create] as ToolSpec[] };
}
