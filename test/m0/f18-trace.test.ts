// F18: the trace (design Appendix B). A scenario run emits one JSON document per run when QYVR_TRACE_DIR is
// set and nothing otherwise; validateTrace refuses prose in an asserted field and a tag outside the set.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { defineScenario, type Snapshot } from "../support/scenario.ts";
import { TRACE_TAGS, type Trace, type TraceStep, validateTrace } from "../support/trace.ts";

const dirs: string[] = [];
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), "f18-trace-"));
  dirs.push(d);
  return d;
};
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** A world of ids: the turns add one journal row and one file, which the scenario declares. */
class World {
  journal = new Set<string>(["run:seed-1"]);
  r2 = new Set<string>();
  snapshot(): Snapshot {
    return { journal: [...this.journal], vault: [], r2: [...this.r2] };
  }
}

const step = (): TraceStep => ({
  action: { kind: "prompt", input_class: "typed", actor: "user" },
  observed: { surface: "chat", cards: ["approval"], text_class: "answer", notification: "chat" },
  state_delta: { records: ["run:r1"], files: ["notes/a.md"], jobs: [], reactions: [], other: [] },
  failure: null,
  approval: { asked: true, scope: "file_write", default: "deny", finality: "final" },
  timing: "immediate",
  tags: ["instrumented"],
});

const trace = (over: Partial<Trace> = {}): Trace => ({
  scenario_id: "S-B1-sample",
  cluster: "P1",
  arm: "fletch",
  run_at: "2026-10-29T12:00:00.000Z",
  source: { dump_version: "2026-10-29" },
  steps: [step()],
  examples: ["The agent said: I have written the note."],
  ...over,
});

const codes = (t: unknown) => {
  const v = validateTrace(t);
  return v.ok ? [] : v.reasons.map((r) => r.code);
};

describe("[F18] the trace", () => {
  it("validates a well-formed trace, with prose in examples", () => {
    expect(validateTrace(trace())).toEqual({ ok: true });
  });

  it("accepts prose in failure.user_words and refuses prose in state_delta", () => {
    const withWords = trace({ steps: [{ ...step(), failure: { code: "HOST_PUSH_UNAVAILABLE", user_words: "I could not send a push notification on this deploy." } }] });
    expect(validateTrace(withWords)).toEqual({ ok: true });
    const prose = trace({ steps: [{ ...step(), state_delta: { ...step().state_delta, records: ["the agent wrote a note about the meeting"] } }] });
    const v = validateTrace(prose);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reasons).toEqual([{ code: "TRACE_PROSE", path: "steps[0].state_delta.records[0]" }]);
  });

  it("refuses a tag outside the set, an enum outside its values and a missing field, each by code and path", () => {
    expect(codes(trace({ steps: [{ ...step(), tags: ["instrumented", "guessed" as never] }] }))).toEqual(["TRACE_BAD_TAG"]);
    expect(codes(trace({ steps: [{ ...step(), timing: "soon" as never }] }))).toEqual(["TRACE_BAD_ENUM"]);
    expect(codes(trace({ arm: "both" as never }))).toEqual(["TRACE_BAD_ENUM"]);
    const { source: _s, ...noSource } = trace();
    expect(codes(noSource)).toEqual(["TRACE_MISSING"]);
    expect(codes("not an object")).toEqual(["TRACE_NOT_OBJECT"]);
    expect([...TRACE_TAGS]).toEqual(["instrumented", "attested", "captured"]);
  });

  it("refuses a one-field prose leak in every asserted string field of a step", () => {
    const bad = (s: TraceStep) => expect(codes(trace({ steps: [s] }))).toEqual(["TRACE_PROSE"]);
    bad({ ...step(), action: { ...step().action, kind: "the person typed a prompt" } });
    bad({ ...step(), observed: { ...step().observed, cards: ["an approval card asking about the file"] } });
    bad({ ...step(), failure: { code: "it broke somehow", user_words: "fine" } });
    bad({ ...step(), approval: { asked: true, scope: "writing to the notes folder", default: "deny", finality: "final" } });
    expect(codes(trace({ scenario_id: "scenario one" }))).toEqual(["TRACE_PROSE"]);
  });
});

describe("[F18] a scenario emits a trace", () => {
  const dir = tempDir();
  // Registered first, so vitest runs it before the checks below (tests in a file run in order).
  defineScenario<World>(
    {
      id: "S-F18-traced",
      cluster: "P0",
      clauses: ["F18"],
      seed: 18,
      setup: () => new World(),
      turns: async (w) => {
        w.journal.add("run:r2");
        w.r2.add("notes/a.md");
      },
      endState: (w) => expect(w.r2.has("notes/a.md")).toBe(true),
      minefields: [{ name: "a vault row appeared", happened: () => false }],
      declared: () => ({ journal: ["run:r2"], r2: ["notes/a.md"] }),
    },
    { env: { QYVR_TRACE_DIR: dir } },
  );

  it("wrote one document named by the scenario id that validates, its state_delta the declared keys", () => {
    expect(readdirSync(dir)).toEqual(["S-F18-traced.json"]);
    const doc = JSON.parse(readFileSync(join(dir, "S-F18-traced.json"), "utf8")) as Trace;
    expect(validateTrace(doc)).toEqual({ ok: true });
    expect(doc.scenario_id).toBe("S-F18-traced");
    expect(doc.cluster).toBe("P0");
    expect(doc.arm).toBe("fletch");
    expect(doc.steps).toHaveLength(1);
    expect(doc.steps[0].state_delta).toEqual({ records: ["run:r2"], files: ["notes/a.md"], jobs: [], reactions: [], other: [] });
    expect(doc.steps[0].failure).toBeNull();
    expect(doc.steps[0].tags).toEqual(["instrumented"]);
    expect(doc.examples).toEqual([]);
  });
});

describe("[F18] no trace without QYVR_TRACE_DIR", () => {
  const dir = tempDir();
  const quiet = (id: `S-${string}`, env: NodeJS.ProcessEnv) =>
    defineScenario<World>(
      {
        id,
        clauses: ["F18"],
        seed: 18,
        setup: () => new World(),
        turns: async () => {},
        endState: () => {},
        minefields: [],
        declared: () => ({}),
      },
      { env },
    );
  quiet("S-F18-unset", {});
  quiet("S-F18-empty", { QYVR_TRACE_DIR: "" });
  // The default environment is the process's own; the hermetic lane never sets the variable.
  defineScenario<World>({ id: "S-F18-default", clauses: ["F18"], seed: 18, setup: () => new World(), turns: async () => {}, endState: () => {}, minefields: [], declared: () => ({}) });

  it("left no file anywhere it could have written", () => {
    expect(process.env.QYVR_TRACE_DIR).toBeUndefined();
    expect(existsSync(join(dir, "S-F18-unset.json"))).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
    expect(existsSync(join(process.cwd(), "S-F18-default.json"))).toBe(false);
  });
});
