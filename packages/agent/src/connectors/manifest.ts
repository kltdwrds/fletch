// Connector manifests (M25.1, spec P4): each connector declares where its credential's value may stand
// on a request, a header after a scheme word, a query parameter or a JSON body field, so placement is
// the connector's own and nothing places a credential globally. A personal credential with no
// connector is placed by its registry entry, which the person wrote and which names a header alone.
// A reference used anywhere its declaration does not name is refused at egress (EGRESS_CRED_PLACEMENT).
import type { Placement } from "../egress/policy.ts";

export interface ConnectorManifest {
  /** The connector's id: a personal connector's reference is `cred://<id>`, a company one's `cred://company-<id>`. */
  id: string;
  /** Where its credential's value may stand; empty for a connector that carries no credential. */
  placements: readonly Placement[];
}

export const CONNECTOR_MANIFESTS: readonly ConnectorManifest[] = [
  { id: "github", placements: [{ in: "header", name: "authorization", prefix: "Bearer " }] },
  { id: "hackernews", placements: [] },
];

/** The manifest that declares a reference's placements, if a connector owns it. */
export function manifestFor(ref: string, manifests: readonly ConnectorManifest[] = CONNECTOR_MANIFESTS): ConnectorManifest | undefined {
  const name = ref.startsWith("cred://") ? ref.slice("cred://".length) : "";
  return manifests.find((m) => name === m.id || name === `company-${m.id}`);
}
