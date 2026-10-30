// M1.2: the recorded GLM 5.3 Flash stream (test/fixtures/glm-5.3-flash.stream.sse, recorded on
// staging through the AI binding and gateway qyvr) replayed byte for byte through the model adapter,
// and the scripted fake checked against the recording's shape, so the fake cannot drift from it.
import { readFileSync } from "node:fs";
import { type AssistantMessage, normalizeContext } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { createStreamFn } from "../../packages/agent/src/model/adapter.ts";
import { modelFor } from "../../packages/agent/src/model/routes.ts";
import type { ModelCallRow } from "../../packages/agent/src/ledger/types.ts";
import { FakeModel, RECORDED_STREAM, REASONING_FIELD } from "../support/fake-model.ts";
import people from "../fixtures/people.json" with { type: "json" };

const sam = people.people.find((p) => p.id === "sam-solo")!;
const recorded = readFileSync(RECORDED_STREAM, "utf8");

type Chunk = { choices?: Array<{ delta?: Record<string, unknown>; finish_reason?: string | null }>; usage?: Record<string, unknown>; response?: string };
const chunks = (sse: string): Chunk[] =>
  sse.split("\n").filter((l) => l.startsWith("data:") && l.slice(5).trim() !== "[DONE]").map((l) => JSON.parse(l.slice(5)) as Chunk);

/** The stream's structure: per chunk, whether it has choices, the delta fields set, finish, and usage keys. */
const fieldOf = (delta: Record<string, unknown>) => (k: string) => {
  if (k !== "tool_calls") return k;
  const call = (delta.tool_calls as Array<{ function: { name: unknown } }>)[0];
  return `tool_calls:${call?.function.name ? "name" : "args"}`;
};
const shape = (sse: string) =>
  chunks(sse).map((c) => ({
    choices: c.choices === undefined ? "absent" : c.choices.length,
    fields: Object.entries(c.choices?.[0]?.delta ?? {}).filter(([, v]) => v !== null && v !== "").map(([k]) => fieldOf(c.choices?.[0]?.delta ?? {})(k)).sort().join(","),
    finish: c.choices?.[0]?.finish_reason ?? null,
    usage: Object.keys(c.usage ?? {}).filter((k) => k !== "neurons").sort().join(","),
  }));

/** Consecutive equal entries collapsed, so chunking differences in text do not matter. */
const runs = <T>(xs: T[]) => xs.filter((x, i) => i === 0 || JSON.stringify(x) !== JSON.stringify(xs[i - 1]));

async function replay(body: string): Promise<{ message: AssistantMessage; rows: ModelCallRow[] }> {
  const rows: ModelCallRow[] = [];
  const ai = { run: async () => new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }) } as unknown as Ai;
  const streamFn = createStreamFn(
    { ai, ledger: { record: async (r) => void rows.push(r) }, wait: async () => {}, now: () => 0 },
    // The recording is Workers AI's stream, so it replays on a Workers AI route.
    { tenant: sam.company, person: sam.email, runId: "run-recorded", route: "job" },
  );
  const message = await (await streamFn(modelFor("job"), normalizeContext({ messages: [{ role: "user", content: "x", timestamp: 0 }] }), {})).result();
  return { message, rows };
}

describe("[M1.2] recorded GLM 5.3 Flash stream", () => {
  it("replays through the adapter into reasoning, a well-formed send_to_user call and the stream's own token counts", async () => {
    const { message, rows } = await replay(recorded);
    const all = chunks(recorded);
    const reasoningText = all.map((c) => c.choices?.[0]?.delta?.[REASONING_FIELD]).filter((t): t is string => typeof t === "string").join("");
    const totals = all.find((c) => c.choices === undefined)?.usage as { prompt_tokens: number; completion_tokens: number };
    const reasoningTokens = all
      .filter((c) => typeof c.choices?.[0]?.delta?.[REASONING_FIELD] === "string" && c.choices?.[0]?.delta?.[REASONING_FIELD] !== "")
      .reduce((a, c) => a + ((c.usage?.completion_tokens as number) ?? 0), 0);

    expect(message.stopReason).toBe("toolUse");
    expect(message.content.find((c) => c.type === "thinking")).toEqual({ type: "thinking", thinking: reasoningText });
    const call = message.content.find((c) => c.type === "toolCall");
    expect(call).toMatchObject({ type: "toolCall", name: "send_to_user", arguments: { text: expect.any(String) } });
    expect(reasoningTokens).toBeGreaterThan(0);
    expect(message.usage).toMatchObject({ input: totals.prompt_tokens, output: totals.completion_tokens, reasoning: reasoningTokens });
    expect(rows).toEqual([expect.objectContaining({ status: "ok", inputTokens: totals.prompt_tokens, outputTokens: totals.completion_tokens, reasoningTokens })]);
  });

  it("the fake streams the recording's shape: reasoning field, tool call order, per-chunk usage and closing totals", async () => {
    expect(REASONING_FIELD).toBe("reasoning_content");
    const fake = new FakeModel([{ reasoning: "The person wants a short note.", toolCall: { id: "call_1", name: "send_to_user", arguments: { text: "It works." } }, usage: { prompt: 438, completion: 49, reasoning: 33 } }]);
    const res = await fake.binding.run("@cf/zai-org/glm-5.3-flash", { messages: [], stream: true }, { returnRawResponse: true });
    const body = await res.text();
    expect(runs(shape(body))).toEqual(runs(shape(recorded)));
    const { message } = await replay(body);
    expect(message.usage).toMatchObject({ input: 438, output: 49, reasoning: 33 });
  });
});
