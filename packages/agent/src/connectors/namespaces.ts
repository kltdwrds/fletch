// The namespaces a chat gets through the tenant's Vault: the connectors over its egress module and,
// with them, what the agent may know of the person's credentials (M13).
import type { Namespace } from "../tools/registry.ts";
import { type CredentialsApi, credentialsNamespace, type ProposalDeps } from "../vault/tools.ts";

export type { CredentialsApi };
import type { Egress } from "./egress.ts";
import { githubNamespace } from "./github.ts";
import { hackerNewsNamespace } from "./hackernews.ts";

export function connectorNamespaces(egress: Egress, credentials?: CredentialsApi, approvals?: ProposalDeps): Namespace[] {
  return [githubNamespace(egress), hackerNewsNamespace(egress), ...(credentials ? [credentialsNamespace(credentials, approvals)] : [])];
}
