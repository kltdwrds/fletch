// The tier-1 harness of the P2 tasks (F23): `P2Tier1World` over P1's, the authority world with Sam's real
// `ChatEngine` chats, her real files (`stores`) and the scripted fake model, plus the test-host fixtures a task names
// (`test/support/p2-fixtures.ts`). A `prompt` turn is Sam's send. With `hold`, the first prompt's turn is left
// waiting at that checkpoint of the script and the next prompt is sent into it, then the checkpoint is released: a
// steer mid-turn (T-P2-05). `chats` places each prompt in a chat; `before` runs before each prompt (the clock, a
// store that refuses).
import { LOADED_NAMESPACES_KEY } from "../../../packages/agent/src/chat/engine.ts";
import type { Namespace } from "../../../packages/agent/src/tools/registry.ts";
import type { FakeStep } from "../../support/fake-model.ts";
import { printNamespace, probeNamespace, stepsNamespace } from "../../support/p2-fixtures.ts";
import type { Snapshot } from "../../support/scenario.ts";
import type { TaskHarness, Turn } from "../../support/task.ts";
import { authorityWorld, type WorldOptions } from "../../workers/support/authority-world.ts";
import { P1Tier1World, sam } from "../p1-reactions/harness.ts";
import type { ChatLabel, ModelRequest, P2World, Row } from "./world.ts";

export { sam };

type Part = { type: string; text?: string; name?: string };

export class P2Tier1World extends P1Tier1World implements P2World {
  readonly starts: number[] = [];
  readonly steps: Array<{ n: number; frames: number }> = [];
  wipes = 0;

  override requests(): ModelRequest[] {
    return super.requests().map((r, i) => ({ ...r, schemas: ((this.w.fake.requests[i]?.inputs.tools ?? []) as Array<{ function: { name: string } }>).map((t) => t.function.name) }));
  }
  turnStarts(): number[] {
    return [...this.starts];
  }
  rows(label: ChatLabel = "c1"): Row[] {
    return this.harness(label)
      .rows("SELECT seq, role, body FROM messages ORDER BY seq")
      .map((r) => {
        const m = JSON.parse(String(r.body)) as { role: string; content: string | Part[]; toolName?: string; isError?: boolean };
        const parts: Part[] = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content;
        return {
          seq: Number(r.seq),
          role: m.role,
          ...(m.role === "toolResult" ? { tool: m.toolName ?? "", isError: m.isError === true } : {}),
          text: parts.map((p) => (p.type === "text" ? (p.text ?? "") : "")).join(""),
          calls: parts.filter((p) => p.type === "toolCall").map((p) => p.name ?? ""),
        };
      });
  }
  loaded(label: ChatLabel = "c1"): string[] {
    const v = this.harness(label).rows(`SELECT value FROM chat_meta WHERE key = '${LOADED_NAMESPACES_KEY}'`)[0]?.value;
    return v ? (JSON.parse(String(v)) as string[]) : [];
  }
  files(): string[] {
    const r = this.w.host(sam.email).files.list({}, sam.email);
    return r.ok ? r.files.map((f) => f.path) : [];
  }
  marks() {
    return [...this.steps];
  }
  wiped() {
    return this.wipes;
  }
  /** P1's rows, each loaded namespace (`namespace:<chat>:<name>`) and each of Sam's files (`file:<path>`). */
  override snapshot(): Snapshot {
    const s = super.snapshot();
    const labels: ChatLabel[] = ["c1", "c2"];
    for (const label of labels) {
      try {
        for (const n of this.loaded(label)) s.journal.push(`namespace:${label}:${n}`);
      } catch {
        // A chat the task never opened holds nothing.
      }
    }
    for (const f of this.files()) s.journal.push(`file:${f}`);
    return s;
  }
}

export interface P2HarnessOptions {
  script: FakeStep[];
  /** The fixtures this task's chats offer beside the production namespaces. */
  fixtures?: Array<"probe" | "print" | "steps">;
  /** A checkpoint of the script: the first prompt's turn waits there while the next prompt is sent (a steer). */
  hold?: string;
  /** The chat each prompt goes to, by turn order; `c1` when unset. */
  chats?: ChatLabel[];
  /** Runs before the i-th prompt (0-based), after its chat is open. */
  before?: (world: P2Tier1World, i: number) => void | Promise<void>;
  seed?: (world: P2Tier1World) => Promise<void>;
  world?: Omit<WorldOptions, "script" | "namespaces" | "stores">;
}

export function p2Harness(o: P2HarnessOptions): TaskHarness<P2Tier1World> {
  let prompts = 0;
  let pending: Promise<unknown> | null = null;
  return {
    setup: async () => {
      prompts = 0;
      pending = null;
      let world: P2Tier1World | null = null;
      const fixtures = (): Namespace[] =>
        (o.fixtures ?? []).map((f) =>
          f === "probe"
            ? probeNamespace()
            : f === "print"
              ? printNamespace()
              : stepsNamespace(
                  (n) => world?.steps.push({ n, frames: world.frames("c1").length }),
                  () => {
                    if (world) world.wipes++;
                  },
                ),
        );
      world = new P2Tier1World(authorityWorld({ script: o.script, stores: true, namespaces: fixtures, ...o.world }));
      await world.open("c1");
      // Sam's standing files are written on their first read, as a first turn would: here, before the snapshot.
      await world.w.host(sam.email).memory.standingFiles();
      await o.seed?.(world);
      return world;
    },
    play: async (world, turn: Turn) => {
      if (turn.kind !== "prompt") throw new Error(`P2_TURN_UNSUPPORTED: ${turn.kind}`);
      if (turn.by !== sam.email) throw new Error(`P2_TURN_BY_UNKNOWN: ${turn.by}`);
      const i = prompts++;
      const label = o.chats?.[i] ?? "c1";
      try {
        world.harness(label);
      } catch {
        await world.open(label);
      }
      await o.before?.(world, i);
      world.starts.push(world.w.fake.requests.length);
      const sent = world.chat(label).send({ person: sam.email, text: turn.text });
      if (o.hold && i === 0) {
        // The turn waits at the checkpoint; the next prompt steers it.
        const reached = await Promise.race([world.w.fake.reached(o.hold).then(() => true), sent.then(() => false)]);
        if (!reached) throw new Error(`P2_HOLD_NOT_REACHED: ${o.hold}`);
        pending = sent;
        return;
      }
      await sent;
      if (pending) {
        world.w.fake.release(o.hold as string);
        await pending;
        pending = null;
      }
      await world.chat(label).settled();
    },
  };
}
