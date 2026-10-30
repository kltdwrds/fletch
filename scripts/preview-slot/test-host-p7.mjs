// The P7 tier-2 tasks' world on a preview slot (F30): what ./test-host.mjs's `Job`, `Person`, `Chat` and `Ledger` add so
// a scheduling grader reads Sam's jobs, their runs, the chat's notices and the job model's calls on a real slot with
// the real model. Deployed only to a slot, through ./app.mjs, and served only to the lease's holder (./ops.mjs,
// `/__preview/test-host`). Pure, so `scripts/preview-slot.test.mjs` runs it under plain Node.
//
// - The probe page. A job's gate and `page_read` reach `PROBE` through `probeGet` instead of the network: the page from
//   a fixture, every other url a 404, and each request kept with whether it carried a credential (nothing leaves the slot).
// - The clock. A job's engine reads `Date.now()` plus the object's skew, and every alarm it arms is moved back by the
//   same skew (`clockedStorage`), so the object keeps one consistent time. `tick` moves the skew to the job's next alarm
//   and sets the real alarm to now: the runtime fires it as it fires any alarm, and the run is the scheduled one.
// - `p7Op` answers the `p7` op: `reset` removes Sam's jobs and saves her home zone; `define` makes a job as its owner
//   (on at once, `off` turns it off); `tick` fires one job's next alarm; `state` reads the jobs, the chat's notices and
//   the job route's model calls.

export const PROBE = 'https://example.com/p7-probe';
/** The probe page's body: never changes on a slot, so every run reads "nothing changed". */
export const PROBE_PAGE = 'The p7 probe page. First paragraph. Second paragraph.';
const CREDENTIAL = /^(authorization|cookie|x-api-key|proxy-authorization)$/i;

/** The job network on a slot: `PROBE` from the fixture, every other url a 404; `record({ url, credentialed })` first. */
export function probeGet(record) {
  return async (url, headers = []) => {
    await record({ url, credentialed: headers.some(([h]) => CREDENTIAL.test(h)) });
    if (url !== PROBE) return { ok: true, status: 404, headers: [['content-type', 'text/plain']], body: 'not served here' };
    return { ok: true, status: 200, headers: [['content-type', 'text/plain']], body: PROBE_PAGE };
  };
}

/** The engine's storage with its alarms moved back by `skew()`: an alarm armed for the job's time fires at the real one. */
export function clockedStorage(storage, skew) {
  return {
    sql: storage.sql,
    transactionSync: (f) => storage.transactionSync(f),
    setAlarm: (t) => storage.setAlarm(t - skew()),
    deleteAlarm: () => storage.deleteAlarm(),
  };
}

/** The skew that makes the job's next alarm (`alarm`, real time, or null) due now: never less than `skew`. */
export function skewToNext(skew, alarm, now) {
  return alarm === null ? null : skew + Math.max(0, alarm - now) + 1;
}

const refused = (code, reason) => ({ ok: false, code, reason });
/** `JOB_ID` in `packages/agent/src/jobs/body.ts`. */
const JOB_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;

/**
 * One `p7` call as `owner`. `h`: `person` (the owner's `Person`), `job(id)` (the owner's `Job` by id), `chat(id)` (a promise of it) and
 * `ledger` (the tenant's `Ledger`), each a stub with the test host's methods.
 */
export async function p7Op(call, owner, h) {
  switch (call.do) {
    case 'reset': {
      const ids = (await h.person.jobIds(owner)) ?? [];
      for (const id of ids) await h.job(id).remove(owner);
      await h.person.testHostP7Reset(String(call.zone ?? 'Europe/London'));
      return { ok: true, removed: ids };
    }
    case 'define': {
      const def = call.def ?? {};
      if (typeof def.id !== 'string' || !JOB_ID.test(def.id)) return refused('P7_JOB_ID_INVALID', 'name the job');
      const made = await h.job(def.id).define({ owner, by: owner, def });
      if (!made.ok) return made;
      if (call.off) {
        const off = await h.job(def.id).disable(owner);
        if (!off.ok) return off;
      }
      return { ok: true, id: def.id };
    }
    case 'tick': {
      if (typeof call.id !== 'string' || !JOB_ID.test(call.id)) return refused('P7_JOB_ID_INVALID', 'name the job');
      return h.job(call.id).testHostTick();
    }
    case 'state': {
      const known = Array.isArray(call.ids) ? call.ids.filter((id) => typeof id === 'string' && JOB_ID.test(id)) : [];
      const ids = [...new Set([...known, ...((await h.person.jobIds(owner)) ?? [])])];
      const jobs = [];
      for (const id of ids) {
        const seen = await h.job(id).inspect(owner);
        if (!seen.ok || !seen.job) continue;
        jobs.push({ id, inspection: seen, ...(await h.job(id).testHostClock()) });
      }
      const notices = typeof call.chat === 'string' ? await (await h.chat(call.chat)).testHostNotices() : [];
      const calls = (await h.ledger.testHostCalls()).filter((c) => c.person === owner);
      return { ok: true, jobs, notices, calls };
    }
    default:
      return refused('P7_OP_UNKNOWN', String(call.do));
  }
}
