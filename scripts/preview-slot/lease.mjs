// The Durable Object that holds a fletch preview slot's lease (docs/preview.md): one row under one name, decided by
// ./lease-rules.mjs. Both of the slot's entries export it and it is never tombstoned, so a release that wipes the
// agent's objects keeps the lease that decides who may release.
import { DurableObject } from 'cloudflare:workers';
import { decideClaim, mayEnd } from './lease-rules.mjs';

export class PreviewLease extends DurableObject {
  read() {
    return this.ctx.storage.kv.get('lease') ?? null;
  }

  claim(req, now) {
    const d = decideClaim(this.read(), req, now);
    if (d.conflict) return { conflict: true };
    this.ctx.storage.kv.put('lease', d.next);
    return { lease: d.next, fresh: d.fresh };
  }

  end(req, now) {
    if (!mayEnd(this.read(), req, now)) return false;
    this.ctx.storage.kv.delete('lease');
    return true;
  }
}

/** The slot's one lease object. */
export const leaseOf = (env) => env.PREVIEW_LEASE.getByName('lease');
