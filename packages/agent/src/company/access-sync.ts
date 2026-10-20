// The Access half of an invitation (Q11, M14.3). The Company is the owning store of membership; after
// an invitation or a departure it sends its whole member list to the dispatcher's `Members`
// entrypoint (ACCESS_MEMBERS, the tenant in props), which re-writes this tenant's Access policy.
// The membership change stands whatever Access answers: a failed sync is said with its code, never
// shown as admitted, and an admin can send the list again.
import type { MembersApi, MembersResult } from "../../../platform/dispatcher/src/members.ts";
import type { Member } from "./members.ts";

export type AccessSync = MembersResult | { ok: false; code: "ACCESS_MEMBERS_UNBOUND" | "ACCESS_SYNC_FAILED"; reason: string };

export async function syncAccess(api: MembersApi | undefined, members: Member[]): Promise<AccessSync> {
  if (!api) return { ok: false, code: "ACCESS_MEMBERS_UNBOUND", reason: "no Access members entrypoint is bound" };
  try {
    return await api.sync(members.map((m) => m.email));
  } catch (e) {
    return { ok: false, code: "ACCESS_SYNC_FAILED", reason: String(e).slice(0, 200) };
  }
}
