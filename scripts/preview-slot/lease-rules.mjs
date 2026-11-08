// The lease rules of a fletch preview slot (docs/preview.md), with no platform import so Node's tests run them as they
// are: the slot's PreviewLease Durable Object (./lease.mjs) applies them to its one stored row, and the tests' fake does
// the same to a variable. A Durable Object runs one call at a time, so each decision is a compare-and-set.

/** The longest a lease may be renewed for at once. */
export const MAX_TTL_SECONDS = 7 * 86400;
/** The tag of the staging lease: no worktree's (those are hex), and no Worker secret is ever set for it. */
export const STAGING_TAG = 'staging';
/** When the staging lease ends: never in practice (2100-01-01), so code that predates staging still reads it as live. */
export const STAGING_EXPIRES_AT = 4102444800;

export const publicLease = (l, now) => ({ leased: Boolean(l && l.expiresAt > now), expiresAt: l?.expiresAt ?? null, branchHash: l?.branchHash ?? null, ...(l?.staging ? { staging: true } : {}) });
export const fullLease = (l, now) => ({ ...publicLease(l, now), tag: l?.tag ?? null, owner: l?.owner ?? null, leasedAt: l?.leasedAt ?? null });

/**
 * A claim of the lease by `tag`: taken when it is free, expired or already `tag`'s, refused while another tag holds it
 * live, and always refused on the staging lease. `{ next, fresh }` on success (fresh: a lease this claim began, not a
 * renewal of the caller's live one), or `{ conflict: true }`.
 */
export function decideClaim(current, { tag, branchHash, owner, ttlSeconds }, now) {
  if (current?.staging) return { conflict: true };
  const live = Boolean(current && current.expiresAt > now);
  if (live && current.tag !== tag) return { conflict: true };
  const renewal = live && current.tag === tag;
  return { next: { tag, branchHash, owner, leasedAt: renewal ? current.leasedAt : now, expiresAt: now + Math.floor(ttlSeconds) }, fresh: !renewal };
}

/**
 * Whether `tag` may end the lease: it holds it live, or `force` names the tag gc judged, still the one stored. The
 * staging lease ends only by force naming it with `unstage` (`pnpm preview down --slot n --force`), never by gc.
 */
export function mayEnd(current, { tag, force = false, expectTag, unstage = false }, now) {
  if (!current) return true;
  if (current.staging) return force && unstage === true && expectTag === current.tag;
  if (force) return typeof expectTag === 'string' && current.tag === expectTag;
  return current.tag === tag && current.expiresAt > now;
}

/**
 * Marks the slot staging and keeps the rest of it: a compare-and-set on the tag the converter read (`expectTag`, null
 * for no lease), so a lease taken meanwhile is never taken over. `{ next }`, `{ already: true }` or `{ conflict: true }`.
 */
export function decideStage(current, { expectTag }, now) {
  if (current?.staging) return { already: true };
  if ((current?.tag ?? null) !== (expectTag ?? null)) return { conflict: true };
  return { next: { tag: STAGING_TAG, staging: true, branchHash: null, owner: 'staging: main, deployed on merge', leasedAt: now, expiresAt: STAGING_EXPIRES_AT } };
}

/** A lease store over a variable, applying these rules: the tests' stand-in for the Durable Object's RPC stub. */
export function memoryLease() {
  let row = null;
  return {
    read: async () => row,
    claim: async (req, now) => {
      const d = decideClaim(row, req, now);
      if (d.next) row = d.next;
      return d.conflict ? { conflict: true } : { lease: row, fresh: d.fresh };
    },
    end: async (req, now) => {
      if (!mayEnd(row, req, now)) return false;
      row = null;
      return true;
    },
    stage: async (req, now) => {
      const d = decideStage(row, req, now);
      if (!d.next) return d;
      row = d.next;
      return { lease: row };
    },
  };
}
