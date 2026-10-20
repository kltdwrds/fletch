// The disclosure gate (memory-and-learning.md "The disclosure gate", AD-23): which remembered item a
// reader may be shown, by scope and audience only, with no judgment. Company scope passes to a member;
// team scope passes to a member of the team; a personal item passes to its owner, or to someone in the
// audience of the shared setting it was learned in, and to nobody else. Each owning store applies it
// to every reader of a turn (the person, and the colleague a request turn answers), so what a model
// receives is only what every party to the turn could read themselves.

export type MemoryScope = "personal" | "company" | `team:${string}`;

/** What a remembered item says about itself: its scope, the person who owns a personal item, and its audience. */
export interface Tagged {
  scope: string;
  owner?: string | null;
  audience?: readonly string[] | null;
}

/** One reader as the owning store knows them, fresh on every call. */
export interface Reader {
  email: string;
  member: boolean;
  teams: readonly string[];
}

export const TEAM_ID = /^[a-z][a-z0-9-]{0,39}$/;

export function teamScope(team: string): MemoryScope {
  return `team:${team}`;
}

/** The team a `team:<id>` scope names; null for anything else. */
export function teamOf(scope: string): string | null {
  const m = /^team:(.+)$/.exec(scope);
  return m?.[1] && TEAM_ID.test(m[1]) ? m[1] : null;
}

export type Disclosure = { ok: true } | { ok: false; code: "DISCLOSURE_NOT_MEMBER" | "DISCLOSURE_NOT_IN_TEAM" | "DISCLOSURE_PERSONAL" | "DISCLOSURE_SCOPE_UNKNOWN" };

export function discloses(item: Tagged, reader: Reader): Disclosure {
  if (item.scope === "company") return reader.member ? { ok: true } : { ok: false, code: "DISCLOSURE_NOT_MEMBER" };
  const team = teamOf(item.scope);
  if (team) return reader.member && reader.teams.includes(team) ? { ok: true } : { ok: false, code: "DISCLOSURE_NOT_IN_TEAM" };
  if (item.scope === "personal") {
    if (item.owner && item.owner === reader.email) return { ok: true };
    return item.audience?.includes(reader.email) ? { ok: true } : { ok: false, code: "DISCLOSURE_PERSONAL" };
  }
  return { ok: false, code: "DISCLOSURE_SCOPE_UNKNOWN" };
}

/** Whether every reader of a turn may be shown the item; an empty reader list is shown nothing. */
export function disclosesToAll(item: Tagged, readers: readonly Reader[]): boolean {
  return readers.length > 0 && readers.every((r) => discloses(item, r).ok);
}

/** The readers of one memory call: the requester first, then anyone else the turn answers, deduplicated. */
export function readersOf(requester: string, also: readonly string[] = []): string[] {
  return [...new Set([requester, ...also].map((e) => e.trim().toLowerCase()).filter(Boolean))];
}
