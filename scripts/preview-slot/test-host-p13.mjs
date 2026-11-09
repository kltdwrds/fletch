// The P13 tier-2 task's world on a preview slot (F73, `docs/plan-v2/contracts/P13-voice-audio.md`, T-P13-14): what
// ./test-host.mjs adds so the live round trip is graded on a real slot with the real speech models. Deployed only to a
// slot, through ./app.mjs, and served only to the lease's holder (./ops.mjs, `/__preview/test-host`). Pure but for the
// stubs and the speech service it is handed, so a hermetic test runs it.
//
// - The probe. `p13-probe.mp3` is the fixture sentence (`TRANSCRIPT`, test/evals/p13-voice-audio/world.ts) spoken by the
//   slot's own `speak` (the speech service `speechOf` builds for every deploy, admitted and priced by the tenant's
//   Ledger on route `speech`) in the deploy's default voice, so no recording of a person exists. The runner uploads it
//   as Sam's voice note through the app's own route.
// - The rows. Sam's attachment rows with their transcripts and her audio records, from her `Person`'s own tables, and the
//   Ledger's speech calls with their price, so the run's speech spend is read from the Ledger, not estimated.
import { TRANSCRIPT } from '../../test/evals/p13-voice-audio/world.ts';

/** The fixture sentence spoken by `speech` (a `Speech`) as `owner`: `{ ok, audio (base64), ms }` or the refusal by code. */
export async function p13Probe(speech, owner, speaker) {
  if (!speech) return { ok: false, code: 'SPEECH_UNAVAILABLE', reason: 'this slot has no speech' };
  const r = await speech.speak({ text: TRANSCRIPT, speaker, person: owner, ref: 'p13-probe' });
  if (!r.ok) return { ok: false, code: r.code, reason: r.reason };
  let data = '';
  for (let i = 0; i < r.bytes.length; i += 0x8000) data += String.fromCharCode(...r.bytes.subarray(i, i + 0x8000));
  return { ok: true, audio: btoa(data), ms: r.ms };
}

const has = (sql, table) => sql.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", table).toArray().length > 0;
const str = (v) => (v == null ? null : String(v));

/** A person's attachment rows (with their transcripts) and audio records, as the tier-1 world reads them; empty before a table exists. */
export function p13PersonRows(sql) {
  const rows = has(sql, 'attachments')
    ? sql
        .exec('SELECT * FROM attachments ORDER BY created_at, id')
        .toArray()
        .map((r) => ({ id: String(r.id), name: String(r.name), mime: String(r.mime), size: Number(r.size), cls: String(r.cls), sha256: String(r.sha256), status: String(r.status), code: str(r.code), transcript: str(r.transcript) }))
    : [];
  const audio = has(sql, 'audio_items')
    ? sql
        .exec('SELECT * FROM audio_items ORDER BY created_at, id')
        .toArray()
        .map((r) => ({ id: String(r.id), kind: String(r.kind), path: String(r.path), durationMs: Number(r.duration_ms), voice: String(r.voice), model: String(r.model), source: String(r.source), removed: r.removed_at != null }))
    : [];
  return { rows, audio };
}

/** The Ledger's speech calls, every status, in order: the model, the status, its code and its price in micros. */
export function p13SpeechCalls(sql) {
  return sql
    .exec("SELECT id, person, model, status, code, cost_micros, at FROM model_calls WHERE route = 'speech' ORDER BY id")
    .toArray()
    .map((r) => ({ id: Number(r.id), person: String(r.person), model: String(r.model), status: String(r.status), code: str(r.code), costMicros: Number(r.cost_micros), at: Number(r.at) }));
}
