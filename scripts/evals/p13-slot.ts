// The P13 readers and the voice note over a preview slot (F73): T-P13-14's world on a real slot with the real speech
// models. The `p13` op (`scripts/preview-slot/test-host-p13.mjs`) speaks the fixture sentence through the slot's own
// speech service, so `p13-probe.mp3` is generated, never a recording of a person; the `voice-note` event uploads it as Sam
// through the app's own route (`POST /app/attachments`, as the composer attaches a file) and the next prompt in chat `c1`
// carries it, as the composer sends a message with its pending attachments. The readers are Sam's attachment rows with
// their transcripts, her audio records and the Ledger's speech calls, each holding only what this trial made: what was
// there when the trial began is left out, so an earlier trial's note or render never passes a later one.
//
// The cap: the trial begins with the Ledger's monthly speech cap set to $1 (`P13_SPEECH_CAP_MICROS`) through the admin
// route as Sam, the deploy's own path (`PUT /admin/settings`), and read back from the admin overview; a slot whose cap reads above it stops the
// trial as the slot's failure. The run's speech spend is the Ledger's priced rows (`spend`).
//
// What the slot cannot see is said, never guessed: a P13 reader no tier-2 grader uses throws `SLOT_P13_UNREAD`.
import type { P13Audio, P13Call, P13Row } from "../preview-slot/test-host-p13.mjs";
import { InfraError } from "../../test/support/evals.ts";
import type { AttachmentRow, AudioItem, P13World, SpeechRow } from "../../test/evals/p13-voice-audio/world.ts";
import { PROBE_FILE } from "../../test/evals/p13-voice-audio/world.ts";

/** F71's monthly speech cap on the slot: $1, never more without a question (parts.md, F73). */
export const P13_SPEECH_CAP_MICROS = 1_000_000;

/** What the `p13` op answers: `probe` the fixture sentence spoken, `read` the person's rows and the Ledger's speech calls. */
export type P13Probe = { ok: true; audio: string; ms: number } | { ok: false; code: string; reason: string };
export type P13State = { rows: P13Row[]; audio: P13Audio[]; calls: P13Call[] };
export interface P13Op {
  (call: "probe"): Promise<P13Probe>;
  (call: "read"): Promise<P13State>;
}

type Answer = { status: number; body: Record<string, unknown> };
/** The app's routes as Sam: a JSON request, and a file upload. */
export interface P13App {
  json(method: "GET" | "PUT", path: string, body?: unknown): Promise<Answer>;
  upload(name: string, type: string, bytes: Uint8Array): Promise<Answer>;
}

export type P13Readers = Pick<P13World, "rows" | "uploads"> & { audio(): AudioItem[]; speechRows(): SpeechRow[]; speechCalls(): never; refusals(): never };

export interface P13Slot {
  readers: P13Readers;
  /** The trial's start: the cap set and read back, and the rows, records and calls there now kept aside. */
  begin(): Promise<void>;
  refresh(): Promise<void>;
  /** A P13 event (`voice-note`): false for an event it does not play. */
  event(name: string, payload: Record<string, string>): Promise<boolean>;
  /** The attachments the next prompt carries (the voice note), taken once. */
  take(): string[];
  /** The trial's speech calls the Ledger priced, and their sum in micros. */
  spend(): { calls: number; micros: number };
}

const unread = (name: string) => () => {
  throw new Error(`SLOT_P13_UNREAD: ${name} is not read on a slot`);
};

const bytesOf = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/** The P13 readers over the `p13` op and Sam's app routes. */
export function p13Slot(op: P13Op, app: P13App): P13Slot {
  let state: P13State = { rows: [], audio: [], calls: [] };
  let before = { rows: new Set<string>(), audio: new Set<string>(), calls: -1 };
  let pending: string[] = [];
  const uploads: P13World["uploads"] = [];
  const mine = () => ({
    rows: state.rows.filter((r) => !before.rows.has(r.id)),
    audio: state.audio.filter((a) => !before.audio.has(a.id)),
    calls: state.calls.filter((c) => c.id > before.calls),
  });
  const refresh = async () => {
    state = await op("read");
  };
  const readers: P13Readers = {
    uploads,
    rows: (): AttachmentRow[] => mine().rows.map((r) => ({ ...r })),
    audio: (): AudioItem[] => mine().audio.map((a) => ({ ...a, kind: a.kind as AudioItem["kind"] })),
    speechRows: (): SpeechRow[] => mine().calls.filter((c) => c.status !== "refused").map((c) => ({ route: "speech", model: c.model, costMicros: c.costMicros })),
    speechCalls: unread("speechCalls"),
    refusals: unread("refusals"),
  };
  return {
    readers,
    refresh,
    async begin() {
      const set = await app.json("PUT", "/admin/settings", { budgets: { tenantSpeechMonthlyMicros: P13_SPEECH_CAP_MICROS } });
      if (set.status !== 200) throw new InfraError("SLOT_5XX", `the speech cap was not set: PUT /admin/settings answered ${set.status} ${String(set.body.code ?? "")}`);
      const got = await app.json("GET", "/admin/overview");
      const cap = (got.body.settings as { budgets?: { tenantSpeechMonthlyMicros?: number } } | undefined)?.budgets?.tenantSpeechMonthlyMicros;
      if (got.status !== 200 || typeof cap !== "number" || cap > P13_SPEECH_CAP_MICROS) throw new InfraError("SLOT_5XX", `the slot's speech cap reads ${String(cap)}, not at most ${P13_SPEECH_CAP_MICROS} micros`);
      await refresh();
      before = { rows: new Set(state.rows.map((r) => r.id)), audio: new Set(state.audio.map((a) => a.id)), calls: Math.max(-1, ...state.calls.map((c) => c.id)) };
      pending = [];
      uploads.length = 0;
    },
    async event(name, payload) {
      if (name !== "voice-note") return false;
      const probe = await op("probe");
      // The probe is the runner's fixture, not the agent's work: a slot that cannot speak it is the slot's failure.
      if (!probe.ok) throw new InfraError("SLOT_5XX", `the probe was not spoken: ${probe.code}`);
      const file = payload.name ?? PROBE_FILE;
      const r = await app.upload(file, payload.type ?? "audio/mpeg", bytesOf(probe.audio));
      uploads.push({ name: file, status: r.status, ...(typeof r.body.code === "string" ? { code: r.body.code } : {}), words: String(r.body.words ?? "") });
      const id = (r.body.attachment as { id?: string } | undefined)?.id;
      if (r.status === 201 && id) pending.push(id);
      await refresh();
      return true;
    },
    take() {
      const out = pending;
      pending = [];
      return out;
    },
    spend() {
      const priced = mine().calls.filter((c) => c.status !== "refused");
      return { calls: priced.length, micros: priced.reduce((s, c) => s + c.costMicros, 0) };
    },
  };
}
