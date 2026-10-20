// The code's network (M25.5): the `Egress` entrypoint of the agent script is every Dynamic Worker's
// `globalOutbound` (`code/run.ts`), so each fetch() and connect() the code makes arrives here, with the
// tenant and the person in props that the `Chat` object set when it loaded the code. A fetch becomes
// one request to the Vault's egress module for that person (AD-12): the registry's hosts, the declared
// placements and the person's surrogates bound it exactly as they bound a connector tool, and the
// answer comes back redacted and scrubbed. A refusal is an answer with status 403 and its code, never
// a network error, so a script and a stock SDK both see what happened. A raw socket is refused: egress
// carries HTTP alone. Nothing the code sends names a person or a tenant; props alone do.
import { unavailable } from "@qyvr/host";
import { WorkerEntrypoint } from "cloudflare:workers";
import type { VaultEgress } from "../connectors/egress.ts";
import type { EgressResult } from "../egress/module.ts";
import { logObject } from "../obs/log.ts";
import { type CodeApi, codeApi, type LoaderLike } from "./run.ts";

export interface EgressProps {
  tenant: string;
  person: string;
}

export const CODE_PURPOSE = "code_execute";
/** Request bodies above this are refused rather than cut. */
export const REQUEST_BODY_MAX = 1_000_000;
/** The header a refusal carries beside its JSON body, so code can branch on it without parsing. */
export const REFUSAL_HEADER = "x-qyvr-egress-refused";
const NULL_BODY = new Set([101, 204, 205, 304]);

export interface CodeEgressDeps {
  tenant: string;
  vault: VaultEgress;
  log?: (event: Record<string, unknown>) => void;
}

export function refusal(code: string, reason: string): Response {
  return Response.json({ code, reason }, { status: 403, headers: { [REFUSAL_HEADER]: code } });
}

/** One fetch of the code, through the Vault's egress for the person in props. */
export async function codeEgress(request: Request, props: Partial<EgressProps> | undefined, deps: CodeEgressDeps): Promise<Response> {
  if (!props || props.tenant !== deps.tenant) return refusal("EGRESS_TENANT_MISMATCH", "this egress serves its own tenant's code alone");
  if (typeof props.person !== "string" || !props.person) return refusal("EGRESS_NO_PERSON", "the code's egress names no person");
  const method = request.method.toUpperCase();
  let body: string | undefined;
  if (method !== "GET" && method !== "HEAD") {
    body = await request.text();
    if (body.length > REQUEST_BODY_MAX) return refusal("EGRESS_REQUEST_TOO_LARGE", `${body.length} characters; the limit is ${REQUEST_BODY_MAX}`);
  }
  const headers: Array<[string, string]> = [];
  request.headers.forEach((value, name) => {
    headers.push([name, value]);
  });
  const r: EgressResult = await deps.vault.egress({ url: request.url, method, headers, ...(body !== undefined ? { body } : {}) }, { person: props.person, purpose: CODE_PURPOSE });
  if (!r.ok) {
    deps.log?.({ event: "code.egress.refused", code: r.code, host: r.host ?? null });
    return refusal(r.code, r.reason);
  }
  return new Response(NULL_BODY.has(r.status) || method === "HEAD" ? null : r.body, { status: r.status, headers: r.headers });
}

/** The agent script's `Egress` entrypoint: what `ctx.exports.Egress({ props })` names as a Dynamic Worker's outbound. */
export class Egress extends WorkerEntrypoint<Env, EgressProps> {
  async fetch(request: Request): Promise<Response> {
    const vault = this.env.VAULT.get(this.env.VAULT.idFromName(this.env.TENANT_ID)) as unknown as VaultEgress;
    return codeEgress(request, this.ctx.props, { tenant: this.env.TENANT_ID, vault, log: (e) => logObject({ ...e, tenant: this.env.TENANT_ID }) });
  }

  /**
   * A raw socket from the code: egress carries no sockets. Measured on staging (DECISIONS-LOG M25.5):
   * the code's `opened` resolves before this runs, and when it throws the code's first write or read
   * fails with "Network connection lost." and no byte reaches the host. So it logs the refusal's code
   * and throws, writing nothing into the socket: an answer written there hangs the code's request.
   */
  connect(_socket: Socket): void {
    logObject({ event: "code.egress.refused", code: SOCKET_REFUSED, tenant: this.env.TENANT_ID });
    throw new Error(`${SOCKET_REFUSED}: code reaches the network through egress, over HTTP alone; raw sockets are refused`);
  }
}

export const SOCKET_REFUSED = "EGRESS_SOCKET_REFUSED";

/** What `codeFor` needs of the Chat object: its env and its own `ctx.exports`. */
export interface CodeHost {
  env: { LOADER?: LoaderLike; TENANT_ID: string; VAULT: { get(id: DurableObjectId): unknown; idFromName(name: string): DurableObjectId } };
  exports: { Egress(options: { props: EgressProps }): Fetcher };
}

/**
 * Code Mode for one person, from the `Chat` object: the loader on the agent script, the outbound
 * this script's `Egress` entrypoint with the tenant and the person in props, and the person's own
 * surrogates. Only an object reaches this: from the dispatched handler the loader refuses the stub.
 */
export function codeFor(host: CodeHost, person: string): CodeApi {
  const tenant = host.env.TENANT_ID;
  const loader = host.env.LOADER;
  // A deploy without the Worker Loader binding refuses every run in words; nothing is loaded or sent.
  if (!loader) return { run: async () => unavailable("code", "Code Mode needs the Worker Loader binding, which this deploy does not have") };
  const vault = () => host.env.VAULT.get(host.env.VAULT.idFromName(tenant)) as { surrogate(person: string, ref: string): Promise<{ ok: true; token: string } | { ok: false; code: string; reason: string }> };
  return codeApi({
    loader,
    tenant,
    person,
    outbound: host.exports.Egress({ props: { tenant, person } }),
    surrogate: (ref) => vault().surrogate(person, ref),
  });
}
