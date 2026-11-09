// F80, delta 6 (D-0027 (b)): no merchant or travel provider API is on the egress allowlist or a connector manifest.
// The providers are the ones P16's evidence names (Duffel, Ticketmaster Discovery, Shopify UCP, Meta Catalog, OpenTable,
// Instacart, Expedia), each by its API host as its public documentation gives it and by its registrable domain, written
// once here. A person binding their own key to their own host stays theirs (P9's host card); this holds the product's
// own lists only. Planted: a provider host added to `PUBLIC_HOSTS`, or a provider id to `CONNECTOR_MANIFESTS`, fails it.
import { describe, expect, it } from "vitest";
import { CONNECTOR_MANIFESTS, type ConnectorManifest } from "../../packages/agent/src/connectors/manifest.ts";
import { type HostRule, PUBLIC_HOSTS } from "../../packages/agent/src/egress/policy.ts";

/** Each provider: its id words and the domains its APIs answer on. */
const PROVIDERS = [
  { id: "duffel", domains: ["api.duffel.com", "duffel.com"] },
  { id: "ticketmaster", domains: ["app.ticketmaster.com", "ticketmaster.com"] },
  { id: "shopify", domains: ["shopify.com", "myshopify.com", "shopifyapps.com"] },
  { id: "meta-catalog", domains: ["graph.facebook.com", "facebook.com"] },
  { id: "opentable", domains: ["platform.opentable.com", "opentable.com"] },
  { id: "instacart", domains: ["connect.instacart.com", "instacart.com"] },
  { id: "expedia", domains: ["api.ean.com", "expedia.com", "expediagroup.com"] },
] as const;

const under = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);
/** Each provider the product's lists name, as `<list>: <entry>`. */
function providersListed(hosts: readonly HostRule[], manifests: readonly ConnectorManifest[]): string[] {
  const h = hosts.filter((r) => PROVIDERS.some((p) => p.domains.some((d) => under(r.host.toLowerCase(), d)))).map((r) => `PUBLIC_HOSTS: ${r.host}`);
  const m = manifests.filter((c) => PROVIDERS.some((p) => p.id.split("-").some((w) => w.length > 3 && c.id.toLowerCase().includes(w)))).map((c) => `CONNECTOR_MANIFESTS: ${c.id}`);
  return [...h, ...m];
}

describe("[F80] no provider host or connector (delta 6, D-0027 (b))", () => {
  it("PUBLIC_HOSTS and CONNECTOR_MANIFESTS name no merchant or travel provider", () => {
    expect(providersListed(PUBLIC_HOSTS, CONNECTOR_MANIFESTS)).toEqual([]);
  });

  it("planted: a provider host added to PUBLIC_HOSTS, or a provider id to CONNECTOR_MANIFESTS, fails it", () => {
    const hosts = PUBLIC_HOSTS as HostRule[];
    const manifests = CONNECTOR_MANIFESTS as ConnectorManifest[];
    hosts.push({ host: "api.duffel.com", methods: ["GET"], credentials: [] });
    manifests.push({ id: "ticketmaster", placements: [] });
    try {
      expect(providersListed(PUBLIC_HOSTS, CONNECTOR_MANIFESTS)).toEqual(["PUBLIC_HOSTS: api.duffel.com", "CONNECTOR_MANIFESTS: ticketmaster"]);
    } finally {
      hosts.pop();
      manifests.pop();
    }
    expect(providersListed(PUBLIC_HOSTS, CONNECTOR_MANIFESTS)).toEqual([]);
  });
});
