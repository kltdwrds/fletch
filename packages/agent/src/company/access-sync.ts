// The Access half of an invitation (Q11, M14.3). The Company is the owning store of membership; after
// an invitation or a departure it sends its whole member list to the host's member sync
// (`hostOf(env).members`), which re-writes the tenant's access policy where the host keeps one.
// The membership change stands whatever the sync answers: a failed or refused sync is said with its
// code, never shown as admitted, and an admin can send the list again. A self-host deploy has no
// member sync and refuses it HOST_MEMBERS_UNAVAILABLE.
import type { HostFailure, MembersResult, MembersSync } from "@qyvr/host";
import { available } from "../host.ts";
import type { Member } from "./members.ts";

export type AccessSync = MembersResult | HostFailure | { ok: false; code: "ACCESS_SYNC_FAILED"; reason: string };

export async function syncAccess(api: MembersSync | HostFailure, members: Member[]): Promise<AccessSync> {
  if (!available(api)) return api;
  try {
    return await api.sync(members.map((m) => m.email));
  } catch (e) {
    return { ok: false, code: "ACCESS_SYNC_FAILED", reason: String(e).slice(0, 200) };
  }
}
