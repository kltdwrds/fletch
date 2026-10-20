// The tenant's credential host registry (M13): where each credential may go, written only by a person
// through the capture form or settings and never by the model, and capped by the platform policy
// (https only, a DNS name rather than an IP literal, no private names, no platform hosts). Pure: the
// `Vault` stores the entries and checks them again on every use, so an entry that reached the table
// some other way is still refused at egress.
import { type ConnectorManifest, CONNECTOR_MANIFESTS, manifestFor } from "../connectors/manifest.ts";
import { CRED_REF, type CredentialSlot, type HostRule, PUBLIC_HOSTS, type PublicHost } from "../egress/policy.ts";

export type HostCode = "VAULT_HOST_INVALID" | "VAULT_HOST_SCHEME_DENIED" | "VAULT_HOST_IP_LITERAL" | "VAULT_HOST_PRIVATE" | "VAULT_HOST_PLATFORM";
export type EntryCode = HostCode | "VAULT_REF_INVALID" | "VAULT_METHODS_INVALID" | "VAULT_HEADER_INVALID" | "VAULT_HOST_WRITER_DENIED";
export type Checked<T, C extends string> = { ok: true; value: T } | { ok: false; code: C; reason: string };

/** The platform's own zones and the services its sessions live on: no credential is ever sent there. */
export const PLATFORM_SUFFIXES = ["qyvr.ai", "qyvr-staging.dev", "workers.dev", "cloudflareaccess.com"] as const;
/** Names that resolve inside a network, never on the internet. */
const PRIVATE_SUFFIXES = ["localhost", "local", "internal", "intranet", "lan", "home", "corp", "home.arpa", "localdomain"] as const;
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const IPV4ISH = /^[0-9.]+$|^0x[0-9a-f.x]+$/i;
const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"] as const;
const HEADER = /^[a-z][a-z0-9-]{0,63}$/;
/** Headers a credential may not ride in: they route or frame the request rather than authenticate it. */
const RESERVED_HEADERS = new Set(["host", "content-length", "content-type", "transfer-encoding", "connection", "cookie2", "te", "upgrade"]);
const PREFIX = /^(?:[A-Za-z][A-Za-z0-9-]{0,31} )?$/;

const endsWith = (host: string, suffix: string) => host === suffix || host.endsWith(`.${suffix}`);

/** The policy cap on one host, as a person typed it: a bare name or an https URL with no path. */
export function checkHost(input: unknown): Checked<string, HostCode> {
  let raw = String(input ?? "").trim().toLowerCase();
  const scheme = raw.match(/^([a-z][a-z0-9+.-]*):\/\//);
  if (scheme) {
    if (scheme[1] !== "https") return { ok: false, code: "VAULT_HOST_SCHEME_DENIED", reason: `only https hosts take a credential, not ${scheme[1]}` };
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return { ok: false, code: "VAULT_HOST_INVALID", reason: "the address does not parse" };
    }
    if (url.username || url.password || url.port || (url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) return { ok: false, code: "VAULT_HOST_INVALID", reason: "name the host alone, with no port, path or login" };
    raw = url.hostname;
  }
  if (raw.endsWith(".")) raw = raw.slice(0, -1);
  if (raw.startsWith("[") || raw.includes(":") || IPV4ISH.test(raw)) return { ok: false, code: "VAULT_HOST_IP_LITERAL", reason: "a credential goes to a named host, never an IP address" };
  const labels = raw.split(".");
  if (raw.length > 253 || labels.length < 2 || !labels.every((l) => LABEL.test(l)) || /^[0-9]+$/.test(labels.at(-1) as string)) return { ok: false, code: "VAULT_HOST_INVALID", reason: "a host is a DNS name such as login.example.com" };
  if (PRIVATE_SUFFIXES.some((s) => endsWith(raw, s))) return { ok: false, code: "VAULT_HOST_PRIVATE", reason: `${raw} is a private name` };
  if (PLATFORM_SUFFIXES.some((s) => endsWith(raw, s))) return { ok: false, code: "VAULT_HOST_PLATFORM", reason: `${raw} is a platform host` };
  return { ok: true, value: raw };
}

/**
 * What a job's reads may reach (M25.6, 2026-10-17): any host the policy cap passes, as chat's page
 * reads already do. A job's purpose is `job:<id>`, set by the harness and never by the model; every other
 * caller (the connectors, chat) reaches only the listed hosts.
 */
export function publicHostFor(purpose: string): PublicHost | undefined {
  if (!purpose.startsWith("job:")) return undefined;
  return (host) => {
    const checked = checkHost(host);
    return checked.ok && checked.value === host ? null : checked.ok ? "the name is not in its plain form" : checked.reason;
  };
}

/** One registry entry: a credential's place on one host. */
export interface HostEntry {
  ref: string;
  host: string;
  methods: string[];
  header: string;
  prefix: string;
  fills: boolean;
}

/** Who writes the registry: a person, in person, through one of the two surfaces. Nothing else. */
export type Writer = { kind: "person"; person: string; via: "capture-form" | "settings" };
/** A host the agent proposed, written by the person's approval of its card (M25.1): the card and when they approved. */
export type CardWriter = { kind: "person"; person: string; via: "card"; card: string; approvedAt: number };

export function checkWriter(writer: unknown): Checked<Writer, "VAULT_HOST_WRITER_DENIED"> {
  const w = writer as Partial<Writer> | null;
  if (w?.kind !== "person" || typeof w.person !== "string" || !w.person || (w.via !== "capture-form" && w.via !== "settings")) {
    return { ok: false, code: "VAULT_HOST_WRITER_DENIED", reason: "only a person writes the credential host registry, through the capture form or settings" };
  }
  return { ok: true, value: { kind: "person", person: w.person, via: w.via } };
}

/** A card's approval as a writer: it names the person who approved, the card and the time; the model's word is none of these. */
export function checkCardWriter(writer: unknown): Checked<CardWriter, "VAULT_HOST_WRITER_DENIED"> {
  const w = writer as Partial<CardWriter> | null;
  if (w?.kind !== "person" || w.via !== "card" || typeof w.person !== "string" || !w.person || typeof w.card !== "string" || !w.card || typeof w.approvedAt !== "number" || !Number.isFinite(w.approvedAt)) {
    return { ok: false, code: "VAULT_HOST_WRITER_DENIED", reason: "a proposed host is written only by the person's approval of its card" };
  }
  return { ok: true, value: { kind: "person", person: w.person, via: "card", card: w.card, approvedAt: w.approvedAt } };
}

export function checkEntry(input: unknown): Checked<HostEntry, EntryCode> {
  const e = (input ?? {}) as Record<string, unknown>;
  const ref = String(e.ref ?? "");
  if (!CRED_REF.test(ref)) return { ok: false, code: "VAULT_REF_INVALID", reason: "a reference is cred://<name>" };
  const host = checkHost(e.host);
  if (!host.ok) return host;
  const methods = [...new Set((Array.isArray(e.methods) ? e.methods : ["GET"]).map((m) => String(m).toUpperCase()))];
  if (!methods.length || methods.some((m) => !(METHODS as readonly string[]).includes(m))) return { ok: false, code: "VAULT_METHODS_INVALID", reason: `methods are some of ${METHODS.join(", ")}` };
  const header = String(e.header ?? "authorization").trim().toLowerCase();
  const prefix = String(e.prefix ?? "");
  if (!HEADER.test(header) || RESERVED_HEADERS.has(header) || !PREFIX.test(prefix)) return { ok: false, code: "VAULT_HEADER_INVALID", reason: "a header name, and an optional scheme word followed by one space such as `Bearer `" };
  return { ok: true, value: { ref, host: host.value, methods, header, prefix, fills: e.fills === true } };
}

/**
 * The host rules egress plans against: the public hosts, then each registry entry that still passes
 * the policy cap, grouped by host. An entry the cap refuses is left out, so its host is refused. A
 * connector's credential stands only where its manifest places it; any other credential only in the
 * header its registry entry names.
 */
export function rulesFor(entries: readonly HostEntry[], manifests: readonly ConnectorManifest[] = CONNECTOR_MANIFESTS): HostRule[] {
  const byHost = new Map<string, { methods: readonly string[]; credentials: CredentialSlot[] }>();
  for (const r of PUBLIC_HOSTS) byHost.set(r.host, { methods: r.methods, credentials: [...r.credentials] });
  for (const e of entries) {
    const host = checkHost(e.host);
    if (!host.ok || host.value !== e.host) continue;
    const rule = byHost.get(e.host) ?? { methods: [], credentials: [] };
    const placements = manifestFor(e.ref, manifests)?.placements ?? [{ in: "header" as const, name: e.header, prefix: e.prefix }];
    rule.credentials.push({ ref: e.ref, placements, methods: e.methods, fill: e.fills });
    byHost.set(e.host, rule);
  }
  return [...byHost].map(([host, r]) => ({ host, methods: r.methods, credentials: r.credentials }));
}
