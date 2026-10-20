// A sub-agent (M7.2): a facet of its parent `Chat`, loaded from this script's own class through
// `ctx.exports` with no Worker Loader (measured on staging, DECISIONS-LOG M7.2). A facet has the
// script's env and its own SQLite, which the parent cannot read and which cannot read the
// parent's; it holds the sub-agent's transcript. Its parent decides everything else.
import { DurableObject } from "cloudflare:workers";
import { egressFor, type VaultEgress } from "../connectors/egress.ts";
import { personMemory } from "../memory/rpc.ts";
import { runSubAgent, type SubAgentInput, type SubAgentResult } from "../subagents/run.ts";
import { subAgentReads } from "../subagents/namespaces.ts";
import { migrateObject, probeObject } from "../migrations/catalog.ts";
import { modelConfig } from "../model/routes.ts";

export class SubAgent extends DurableObject<Env> {
  private readonly schema = migrateObject(this.ctx, "subagent");

  /** The sweep's wake (M25.3); sub-agent facets are per run and not enumerable, so the sweep does not call it. */
  async migrationProbe() { return probeObject(this.ctx.storage, this.schema); }

  async run(input: SubAgentInput): Promise<SubAgentResult> {
    const env = this.env;
    const vault = env.VAULT.get(env.VAULT.idFromName(env.TENANT_ID)) as unknown as VaultEgress;
    return runSubAgent(this.ctx.storage, {
      ai: env.AI,
      models: modelConfig(env),
      ledger: env.LEDGER.get(env.LEDGER.idFromName(env.TENANT_ID)),
      tenant: env.TENANT_ID,
      namespaces: (person) => subAgentReads({ person, memory: personMemory(env, person), egress: egressFor(vault, person), source: `subagent:${input.id}` }),
      now: () => Date.now(),
      wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    }, input);
  }
}
