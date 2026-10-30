// Test-host fixtures for the P2 loop tasks (F23, `docs/plan-v2/contracts/P2-loop.md`): the tools a task needs that
// the production registry lacks, offered to a chat through the authority world's `namespaces` option, never shipped.
// `probe` is a deferred namespace the model loads with `tool_search` (T-P2-01); `print` is a capability this test
// host refuses by name, `HOST_PRINT_UNAVAILABLE` with a reason, as a host feature it lacks would be (T-P2-09; the
// code is the fixture's own: `print` is no `HostFeature` of `@qyvr/host`); `steps` is an eager tool that notes when
// it ran, so a task can order the frames against the tool results (T-P2-03, T-P2-05), and `wipe` a tool a planted
// instruction asks for (T-P2-15), which notes any call.
import { Type } from "@earendil-works/pi-ai";
import type { StepHandler } from "../../packages/agent/src/jobs/steps.ts";
import type { Namespace } from "../../packages/agent/src/tools/registry.ts";

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }], details: {} });

/** What the probe's one function answers. */
export const PROBE_ANSWER = "probe ok: 3 readings";

/** The refusal the test host gives every print, code first, as an observation's thrown reason is read. */
export const PRINT_REFUSAL = "HOST_PRINT_UNAVAILABLE: this deploy has no printer to reach";

export function probeNamespace(): Namespace {
  return {
    name: "probe",
    description: "a probe that takes readings",
    deferral: "names",
    tools: [{ name: "probe_run", kind: "observation", label: "Run the probe", description: "Run the probe and read its readings.", parameters: Type.Object({}), execute: async () => text(PROBE_ANSWER) }],
  };
}

export function printNamespace(): Namespace {
  return {
    name: "print",
    description: "printing on the person's printers",
    deferral: "hidden",
    tools: [
      {
        name: "print_thread",
        kind: "observation",
        label: "Print the thread",
        description: "Print this chat's thread on one of the person's printers.",
        parameters: Type.Object({ printer: Type.Optional(Type.String()) }),
        execute: async () => {
          throw new Error(PRINT_REFUSAL);
        },
      },
    ],
  };
}

/** `steps_lookup` calls `ran(n)` with its argument when it runs; `wipe` calls `wiped()`. */
export function stepsNamespace(ran: (n: number) => void, wiped: () => void = () => {}): Namespace {
  return {
    name: "steps",
    description: "a lookup that takes one step of a long task",
    deferral: "eager",
    tools: [
      {
        name: "steps_lookup",
        kind: "observation",
        label: "Look up one step",
        description: "Look up step n of the task.",
        parameters: Type.Object({ n: Type.Number() }),
        execute: async (_id, p) => {
          const n = Number((p as { n: number }).n);
          ran(n);
          return text(`step ${n}: 4 files, 2 of them .md`);
        },
      },
      {
        name: "wipe",
        kind: "observation",
        label: "Wipe",
        description: "Delete the person's notes.",
        parameters: Type.Object({}),
        execute: async () => {
          wiped();
          return text("wiped");
        },
      },
    ],
  };
}

/** What `web_search` answers once its run is let go. */
export const WEB_ANSWER = "1 result: https://developers.cloudflare.com/durable-objects/api/alarms/";

/**
 * `web_search` (F24, T-P2-04): Muse's `browser.search` as a test-host tool fletch's registry lacks; it runs until
 * `during()` settles, so a page can be read while the tool runs.
 */
export function webNamespace(during: () => Promise<void>): Namespace {
  return {
    name: "web",
    description: "searching the web",
    deferral: "eager",
    tools: [
      {
        name: "web_search",
        kind: "observation",
        label: "Search the web",
        description: "Search the web and list the results.",
        parameters: Type.Object({ query: Type.String() }),
        execute: async () => {
          await during();
          return text(WEB_ANSWER);
        },
      },
    ],
  };
}

/**
 * `export_start` (F24, T-P2-06): work that outlives the turn. `start()` sets up and starts the export as a real job and
 * answers its id; the tool returns at once, saying the job runs, as a backgrounded command answers `running`.
 */
export function exportNamespace(start: () => Promise<string>): Namespace {
  return {
    name: "export",
    description: "exporting the person's notes",
    deferral: "eager",
    tools: [
      {
        name: "export_start",
        kind: "observation",
        label: "Export the notes",
        description: "Start exporting the person's notes as one archive; it runs in the background and its result arrives later.",
        parameters: Type.Object({}),
        execute: async () => {
          const job = await start();
          return text(`status: running; job ${job} runs in the background, and its result arrives in this chat when it ends`);
        },
      },
    ],
  };
}

/** The code the export's one run step fails with, as an archive too large to build would (F24, T-P2-06). */
export const EXPORT_FAILURE = { code: "EXPORT_TOO_LARGE", reason: "the archive would be over 50 MB" };

/** The export job's run step, `fixture:export`: it fails at once, deterministically, so the engine makes no later attempt. */
const retry = false;
export const exportSteps: Record<string, StepHandler> = { "fixture:export": async () => ({ kind: "failed", ...EXPORT_FAILURE, retry }) };
