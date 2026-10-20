// Staging-only job fixtures for M5.2's live lane (VERIFY-AT-M5 measured on the deployed agent): a
// step that resets its own object once, mid-step, the way an eviction does, and the predicate the
// lane's long poll waits on. Production builds no fixture step: `stagingSteps` is empty outside
// staging, so a fixture kind there fails its run with STEP_UNKNOWN.
import type { JobDefinition } from "./body.ts";
import type { JobInspection } from "./engine.ts";
import type { StepHandler } from "./steps.ts";

/** Where the evict step remembers that it already reset the object: storage that survives the reset. */
export interface EvictHost {
  marker: { get(key: string): unknown; put(key: string, value: unknown): void };
  /** Flushes the marker before the reset, so the retried alarm finds it. */
  sync(): Promise<void>;
  /** Resets the object; `ctx.abort` never returns. */
  abort(reason: string): void;
  /** This instance's id, new after every reset. */
  instance: string;
}

export interface EvictMarker {
  instance: string;
  at: number;
}

export const EVICT_STEP = "fixture:evict";

/** The first time a run reaches it, the step marks itself and resets the object; the retried alarm completes it. */
export function evictStep(host: EvictHost): StepHandler {
  return async (_spec, ctx) => {
    const key = `evicted:${ctx.runId}`;
    const marker = host.marker.get(key) as EvictMarker | undefined;
    if (!marker) {
      host.marker.put(key, { instance: host.instance, at: ctx.now } satisfies EvictMarker);
      await host.sync();
      host.abort(`${EVICT_STEP}: resetting ${ctx.runId} mid-step`);
      return { kind: "failed", code: "EVICT_DID_NOT_RESET", reason: "the object did not reset", retry: false };
    }
    return { kind: "done", output: `${ctx.def.title}: step resumed in instance ${host.instance} after a reset in instance ${marker.instance}.` };
  };
}

export function stagingSteps(env: string, host: () => EvictHost): Record<string, StepHandler> {
  return env === "staging" ? { [EVICT_STEP]: (spec, ctx) => evictStep(host())(spec, ctx) } : {};
}

/** The three-step run the lane forces to reset mid-step: the diff, the reset, the notice. */
export function evictJob(id: string, chat: string): JobDefinition {
  return {
    id,
    title: `Eviction probe ${id}`,
    chat,
    owner: { kind: "chat", id: chat },
    stop: { kind: "turned_off" },
    // A long cadence: the lane starts the one run with "run now", and no slot falls inside it.
    timing: { schedule: { kind: "interval", every: 1440 }, zone: "UTC", jitterSeconds: 0 },
    gate: null,
    steps: [{ kind: "diff" }, { kind: EVICT_STEP }, { kind: "notify" }],
    ceilingTokens: 0,
    instructions: "A staging probe: three steps, the second resetting its object once.",
  };
}

export interface WaitFor {
  /** Finished runs to wait for. */
  runs: number;
  /** Count only runs the alarm created, not "run now". */
  scheduled?: boolean;
  /** Scheduled ticks the job must have taken, gate closed or not (M25.2: the silent tick). */
  ticks?: number;
}

/** Whether a job has finished `runs` runs and delivered or ended every outbox row. */
export function settled(s: JobInspection, w: WaitFor): boolean {
  const done = s.runs.filter((r) => r.phase === "done" && (!w.scheduled || !r.manual));
  const open = s.outbox.some((o) => o.state === "pending" || o.state === "delivering");
  return done.length >= w.runs && !open && (s.job?.ticks ?? 0) >= (w.ticks ?? 0);
}
