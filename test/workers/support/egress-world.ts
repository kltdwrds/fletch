// M25.1's world: the tenant's real `VaultCore` (solo-sam, two members) behind a hostile vendor that
// echoes everything it was sent (the authorization header, the query and the body), and the chats of
// `authorityWorld` wired to that Vault as `objects/chat.ts` wires it: egress, the credentials the agent
// may see, and the card-approved host write. `code_fetch` is a test tool that stands in for code the
// agent runs (the network Code Mode would get): it sends a model-written request through egress for the
// chat's owner, so the hostile model can try every placement, host and surrogate on the production path.
import { Type } from "@earendil-works/pi-ai";
import { type CodeHost, codeFor, Egress } from "../../../packages/agent/src/code/egress.ts";
import { egressFor } from "../../../packages/agent/src/connectors/egress.ts";
import type { OutboundRequest } from "../../../packages/agent/src/egress/policy.ts";
import type { Namespace, ToolSpec } from "../../../packages/agent/src/tools/registry.ts";
import { VaultCore } from "../../../packages/agent/src/vault/core.ts";
import type { FakeStep } from "../../support/fake-model.ts";
import { ObjectHarness } from "../../support/object-harness.ts";
import { seededToken } from "../../support/vendors/index.ts";
import { ada, authorityWorld, TENANT } from "./authority-world.ts";
import { FakeLoader } from "./fake-loader.ts";
import { keysFor, testMasterKey } from "./vault-harness.ts";

export { ada, TENANT };
export const ADA_HOST = "api.shop.example";
export const ADA_REF = "cred://shop-api";

export interface Sent {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

/** A vendor that answers every host and echoes what it was sent, so a leak back to the caller is visible. */
export function echoVendor() {
  const sent: Sent[] = [];
  const fetch = async (url: string, init: RequestInit): Promise<Response> => {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => {
      headers[k] = v;
    });
    const body = typeof init.body === "string" ? init.body : null;
    sent.push({ url, method: String(init.method ?? "GET"), headers, body });
    return new Response(JSON.stringify({ ok: true, echo: { url, authorization: headers.authorization ?? null, body } }), { headers: { "content-type": "application/json", "x-ratelimit-remaining": headers.authorization ?? "" } });
  };
  return { sent, fetch };
}

export const by = (person: string) => ({ kind: "person" as const, person, via: "capture-form" as const });

export function vaultOf(name: string, fetch: (url: string, init: RequestInit) => Promise<Response>, now: () => number) {
  return new ObjectHarness(name, (ctx) => new VaultCore(ctx as never, { tenant: TENANT, keys: keysFor(TENANT, testMasterKey()), fetch, now }), {});
}

/** Ada's API key for the shop, standing, at its own host in the authorization header. */
export async function seedBoth(vault: VaultCore) {
  const tokens = { ada: seededToken() };
  const a = await vault.capture({ ref: ADA_REF, value: tokens.ada, hosts: [{ host: ADA_HOST, methods: ["GET", "POST"], header: "authorization", prefix: "Bearer " }] }, by(ada.email));
  if (!a.ok) throw new Error(`seed refused: ${JSON.stringify(a)}`);
  return tokens;
}

const FetchParams = Type.Object({
  url: Type.String(),
  method: Type.Optional(Type.String()),
  headers: Type.Optional(Type.Array(Type.Array(Type.String()))),
  body: Type.Optional(Type.String()),
});

/** The code-path stand-in: one request through egress for the chat's owner, its answer (or refusal) as the result. */
export function codeFetchNamespace(vault: () => VaultCore, owner: () => string): Namespace {
  const spec: ToolSpec<typeof FetchParams> = {
    name: "code_fetch",
    kind: "observation",
    label: "Fetch from code",
    description: "Send one HTTP request through egress, as code the agent runs would.",
    parameters: FetchParams,
    external: true,
    execute: async (_id, p) => {
      const r = await vault().egress({ url: p.url, method: p.method, headers: (p.headers ?? []) as Array<[string, string]>, body: p.body } as OutboundRequest, { person: owner(), purpose: "code_fetch" });
      const text = r.ok ? `status ${r.status}\n${r.headers.map(([k, v]) => `${k}: ${v}`).join("\n")}\n${r.body}` : `${r.code}: ${r.reason}`;
      return { content: [{ type: "text", text }], details: { ok: r.ok } };
    },
  };
  return { name: "codefetch", description: "send an HTTP request from code", deferral: "names", tools: [spec as ToolSpec] };
}

/**
 * Code Mode's host as `objects/chat.ts` builds it (M25.5): the tenant's Worker Loader (here the fake,
 * which honours `globalOutbound` for fetch() and connect()) and the script's own `Egress` entrypoint,
 * constructed with the props the Chat object names, over this world's real Vault.
 */
export function codeHost(vault: () => VaultCore, loader = new FakeLoader(), tenant = TENANT) {
  const env = { LOADER: loader, TENANT_ID: tenant, VAULT: { idFromName: (n: string) => ({ name: n }) as unknown as DurableObjectId, get: () => vault() } };
  const egresses: Array<{ props: { tenant: string; person: string } }> = [];
  const host: CodeHost = {
    env,
    exports: {
      Egress: (options) => {
        egresses.push(options);
        return new Egress({ props: options.props } as never, env as never) as unknown as Fetcher;
      },
    },
  };
  return { host, loader, egresses };
}

/** The chats of `authorityWorld` over one Vault, with `code_fetch` and the credentials namespace loaded by the script; with `code`, `code_execute` runs as the Chat object runs it. */
export function egressWorld(script: FakeStep[], o: { stores?: boolean; name?: string; extra?: (owner: () => string) => Namespace; code?: boolean } = {}) {
  const net = echoVendor();
  const clock = { now: Date.UTC(2026, 9, 16, 12, 0) };
  const vaultH = vaultOf(o.name ?? "vault-m25", net.fetch, () => clock.now);
  const vault = () => vaultH.instance;
  const code = codeHost(vault);
  const w = authorityWorld({
    script,
    ...(o.stores ? { stores: true } : {}),
    namespaces: (owner) => [codeFetchNamespace(vault, owner), ...(o.extra ? [o.extra(owner)] : [])],
    vault: {
      egress: (p) => egressFor(vault(), p),
      credentials: (p) => ({ list: async () => vault().list(p), addApprovedHost: async (input, writer) => vault().addApprovedHost(input, writer) }),
      ...(o.code ? { code: (p: string) => codeFor(code.host, p) } : {}),
    },
  });
  return { w, net, vault, vaultH, clock, code };
}

export const load = (...names: string[]): FakeStep => ({ toolCall: { name: "tool_search", arguments: { load: names } } });
export const call = (name: string, args: Record<string, unknown>, id?: string): FakeStep => ({ toolCall: { ...(id ? { id } : {}), name, arguments: args } });
