// The credential an action names (M14.2, Q24): a fill whose subject is `credential:<name>`, with the
// site the proposal named. When the `Person` commits such an action under a one-shot grant (an
// allow-once card), it asks the `Vault` for a matching one-shot credential grant, so a `grant`-
// permission credential or a typed secret is used exactly once on the person's say-so.
import type { Descriptor } from "./types.ts";

export type CredentialMint = (input: { ref: string; site: string | null; card: string }) => Promise<{ ok: true } | { ok: false; code: string; reason: string }>;

/** The credential and site an action uses, or null when it names none. */
export function credentialUse(d: Descriptor, args: Record<string, unknown> | undefined): { ref: string; site: string | null } | null {
  const resource = d.subject.resource ?? "";
  if (d.actionKind !== "browse.fill" || !resource.startsWith("credential:")) return null;
  const ref = `cred://${resource.slice("credential:".length)}`;
  // The arguments travel with the descriptor they were built from; a mismatch is not this credential's use.
  if (args && args.credential !== undefined && args.credential !== ref) return null;
  return { ref, site: typeof args?.site === "string" && args.site ? args.site : null };
}
