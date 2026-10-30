// The P6 readers over a preview slot (F28): a memory task's world on a real slot, over the test host's `p6` op
// (`scripts/preview-slot/test-host-p6.mjs`), apart from the slot client so a hermetic test reads them without its
// socket or passkey. Each trial starts from an empty memory (`reset`), then the task's seed (`P6_SEEDS`), then its
// turns; after each turn the state is read again, so `after()` holds Sam's home paths turn by turn.
//
// What the slot cannot see is said, never guessed: `sentIn` is the chat's stored rows (what the model was sent of the
// thread: its messages and tool results; the stable prefix is the deploy's own and holds no transcript), and the forget
// flow, the sub-agent, the renders, the seam and the context, which no tier-2 grader reads, throw `SLOT_P6_UNREAD`.
import { JOB, SKILL } from "../../test/evals/p6-memory/forget-two-phase.task.ts";
import { type ChatLabel, type Chunk, type Claim, type Line, type P6World, PAT_FACT, type Row, SAM_FACT, type Searched } from "../../test/evals/p6-memory/world.ts";
import type { SlotEntry } from "../../test/support/evals.ts";

type Json = Record<string, unknown>;

/** The test host's `p6` op: one call on Sam's memory, with the named chats' stored rows. */
export type P6Call = (call: Json, chats: string[]) => Promise<{ answer: Json; rows: Record<string, Row[]> }>;

/** What `state` answers. */
export interface P6State {
  lines: Line[];
  claims: Claim[];
  chunks: Chunk[];
  files: Record<string, string>;
}

/**
 * Each tier-2 task's setup as test-host calls, in order. `source: "c1"` is written as the trial's first chat. T-P6-03 is
 * "the Pat line from T-P6-01" said in c1 (its prompt goes to c2); T-P6-12 is T-P6-07 after Sam's confirmation: the Pat
 * and Sam lines, their claims, and the forget of the Pat claim with the job and the skill that quote it as producers.
 */
export const P6_SEEDS: Record<string, Json[]> = {
  "T-P6-03": [{ do: "write", text: PAT_FACT, source: "c1", dedupe: "seed_pat" }],
  "T-P6-12": [
    { do: "write", text: PAT_FACT, source: "c1", dedupe: "seed_pat" },
    { do: "write", text: SAM_FACT, source: "c1", dedupe: "seed_sam" },
    { do: "claims", kind: "preference" },
    { do: "forget", match: PAT_FACT, producers: { jobs: [JOB], skills: [{ name: SKILL.name, text: SKILL.text }] } },
  ],
};

const unread = (name: string) => () => {
  throw new Error(`SLOT_P6_UNREAD: ${name} is not read on a slot`);
};

export interface P6Slot {
  /** Empties Sam's memory and writes the task's seed; throws `P6_SEED_REFUSED` with the code when a step is refused. */
  begin(taskId: string): Promise<void>;
  /** Reads the state again; with `turn`, records Sam's home paths after it. */
  refresh(turn?: string): Promise<void>;
  readers: Omit<P6World, keyof import("../../test/support/scenario.ts").ScenarioWorld>;
}

/** The P6 readers over `call`, with the trial's chats by label and each chat's history as the page draws it. */
export function p6Slot(call: P6Call, chats: () => Map<ChatLabel, string>, entries: (label: ChatLabel) => SlotEntry[]): P6Slot {
  let state: P6State = { lines: [], claims: [], chunks: [], files: {} };
  let rows: Record<string, Row[]> = {};
  const trail: Array<{ turn: string; paths: string[] }> = [];
  const ids = () => [...chats().values()];
  const label = (s: string) => [...chats()].reduce((out, [l, id]) => out.replaceAll(id, l), s);
  const ask = async (c: Json) => (await call(c, [])).answer;
  const rowsOf = (l: ChatLabel) => rows[chats().get(l) ?? ""] ?? [];

  const slot: P6Slot = {
    async begin(taskId) {
      const reset = await ask({ do: "reset" });
      if (reset.ok !== true) throw new Error(`P6_SEED_REFUSED: reset ${String(reset.code ?? "")}`);
      for (const step of P6_SEEDS[taskId] ?? []) {
        const c = typeof step.source === "string" ? { ...step, source: `chat:${chats().get(step.source as ChatLabel) ?? step.source}` } : step;
        const r = await ask(c);
        if (r.ok !== true) throw new Error(`P6_SEED_REFUSED: ${String(step.do)} ${String(r.code ?? "")}`);
      }
      await slot.refresh();
    },
    async refresh(turn) {
      const r = await call({ do: "state" }, ids());
      state = r.answer as unknown as P6State;
      rows = r.rows;
      if (turn) trail.push({ turn, paths: Object.keys(state.files) });
    },
    readers: {
      lines: () => state.lines.map((l) => ({ ...l, source: label(l.source) })),
      claims: () => state.claims.map((c) => ({ ...c })),
      chunks: () => state.chunks.map((c) => ({ ...c })),
      file: async (path) => state.files[path] ?? null,
      paths: () => Object.keys(state.files),
      async search(queries) {
        const r = await ask({ do: "search", queries });
        if (r.ok !== true) throw new Error(`P6_SEARCH_REFUSED: ${String(r.code ?? "")}`);
        const hits = (r.hits ?? []) as Array<{ citation: string; text: string; marker?: string; claims: Array<{ id: string; status: string }>; match?: string }>;
        return {
          hits: hits.map((h) => ({ citation: h.citation, text: h.text, marker: h.marker ?? null, claims: h.claims.map((c) => ({ id: c.id, status: c.status })), match: h.match ?? null })),
          degraded: ((r.semantic as { code?: string } | undefined)?.code ?? null) as Searched["degraded"],
        };
      },
      async get(path, from, limit) {
        const r = await ask({ do: "get", path, from, limit });
        return r.ok === true ? { ok: true as const, lines: r.lines as Array<{ n: number; text: string }> } : { ok: false as const, code: String(r.code ?? "") };
      },
      async explain(claimId) {
        const r = await ask({ do: "explain", claimId });
        return r.ok === true
          ? { ok: true as const, supersedes: r.supersedes as string[], supersededBy: r.supersededBy as string[], sourceText: (r.sourceText ?? null) as string | null }
          : { ok: false as const, code: String(r.code ?? "") };
      },
      rows: (l = "c1") => rowsOf(l).map((r) => ({ ...r })),
      entries: (l = "c1") => entries(l).map((e) => ({ kind: e.kind, ...(e.text === undefined ? {} : { text: e.text }) })),
      sentIn: (l) => rowsOf(l).map((r) => r.text),
      writes: () =>
        (["c1", "c2"] as ChatLabel[])
          .flatMap(rowsOf)
          .filter((r) => r.role === "toolResult" && r.tool === "memory_write")
          .map((r) => ({ ok: !r.isError, code: /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/.exec(r.text)?.[0] ?? null, text: r.text })),
      after: () => trail.map((t) => ({ turn: t.turn, paths: [...t.paths] })),
      context: unread("context"),
      plan: unread("plan"),
      confirms: unread("confirms"),
      producers: unread("producers"),
      subagent: unread("subagent"),
      renders: unread("renders"),
      chatSeam: unread("chatSeam"),
    },
  };
  return slot;
}
