// M22.1, what outlived the hedge (D-0020): every chat turn's task block asks one question at a time, and the
// agent's own source, all its bundle is built from, holds no credential and puts none on a model request. The
// task block is read off the request the production engine sent to the scripted fake.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { matchSecret } from "../../scripts/lib/secret-patterns.ts";
import { ChatEngine, type EngineCtx } from "../../packages/agent/src/chat/engine.ts";
import { ASKING, CHAT_TASK, REQUEST_TASK } from "../../packages/agent/src/chat/instructions.ts";
import { Ledger } from "../../packages/agent/src/objects/ledger.ts";
import { FakeModel, type FakeStep } from "../support/fake-model.ts";
import { harnessNamespace, ObjectHarness } from "../support/object-harness.ts";
import { ada } from "./support/authority-world.ts";

const T0 = Date.UTC(2026, 9, 15, 23, 0, 0);
const ROOT = join(import.meta.dirname, "../..");

describe("[M22.1] asking, one question at a time (B8, B10)", () => {
  it("every chat turn's task block tells the model to ask one question and nothing before it, and to act on a single reading", async () => {
    const w = world([{ text: "Which meeting, evt-1 or evt-2?" }]);
    await w.chat.instance.send({ person: ada.email, text: "Move my meeting." });
    const system = (w.fake.requests[0]?.inputs.messages ?? []).filter((m) => m.role === "system").map((m) => String(m.content)).join("\n");
    expect(CHAT_TASK).toContain(ASKING);
    expect(system).toContain(ASKING);
    expect(ASKING).toMatch(/exactly one clarifying question/);
    expect(ASKING).toMatch(/the one whose answer most changes what you would do/);
    expect(ASKING).toMatch(/do not call tools to gather options/);
    expect(ASKING).toMatch(/do not describe what you are about to do/);
    expect(ASKING).toMatch(/one plausible reading, act on it without asking/);
    // How to ask, never what is allowed: no grant, permission or approval moves into the prompt.
    expect(ASKING).not.toMatch(/grant|permi|allow|approv|may /i);
    // A colleague's request chat keeps its own task block.
    expect(REQUEST_TASK).not.toContain(ASKING);
  });
});

describe("[M22.1] no tenant config or bundle holds a token", () => {
  it("the agent's source, which is all its bundle is built from, holds no credential, no provider key read and no gateway token header", () => {
    const findings = sourceFindings(agentSources());
    expect(findings).toEqual([]);
    // The check is real: a planted key, a key read from the environment and a token header are each found.
    expect(sourceFindings([{ path: "planted.ts", text: `const k = "sk-or-v1-${"b2".repeat(32)}";` }])).toEqual(["planted.ts: openai-style-key"]);
    expect(sourceFindings([{ path: "planted.ts", text: ["headers: { authorization: `Bearer $", "{env.META_API_KEY}` }"].join("") }])).toEqual(["planted.ts: reads a provider key from the environment", "planted.ts: sets a provider authorization header"]);
    expect(sourceFindings([{ path: "planted.ts", text: `{ "cf-aig-authorization": token }` }])).toEqual(["planted.ts: sends a gateway token"]);
  });
});

/** Ada's chat over the production engine and Ledger on a self-host deploy's vars. */
function world(script: FakeStep[]) {
  const fake = new FakeModel(script);
  const ledgers = harnessNamespace((name) => new ObjectHarness(name, (ctx, env) => new Ledger(ctx as DurableObjectState, env as Env), {}, (l) => {
    l.now = () => T0;
  }));
  const env = { TENANT_ID: ada.company, QYVR_ENV: "test", AI: fake.binding, LEDGER: ledgers.binding };
  const chat: ObjectHarness<ChatEngine> = new ObjectHarness("chat-ada", (ctx, e) => new ChatEngine(ctx as EngineCtx, e as Env), env, (c) => {
    c.now = () => T0;
    c.wait = async () => {};
  });
  chat.instance.claim(ada.email);
  return { fake, chat };
}

function agentSources(dir = join(ROOT, "packages/agent/src")): Array<{ path: string; text: string }> {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return agentSources(path);
    return name.endsWith(".ts") ? [{ path: path.slice(ROOT.length + 1), text: readFileSync(path, "utf8") }] : [];
  });
}

/** Credentials in the agent's own source, or code that would put one on a model request. */
function sourceFindings(files: Array<{ path: string; text: string }>): string[] {
  const out: string[] = [];
  for (const f of files) {
    const shape = matchSecret(f.text);
    if (shape) out.push(`${f.path}: ${shape}`);
    if (/env\.[A-Z_]*(META|ANTHROPIC|OPENAI|PROVIDER)[A-Z_]*(KEY|TOKEN)/.test(f.text)) out.push(`${f.path}: reads a provider key from the environment`);
    if (/["']?authorization["']?\s*:\s*`?Bearer/i.test(f.text)) out.push(`${f.path}: sets a provider authorization header`);
    if (/cf-aig-authorization/i.test(f.text)) out.push(`${f.path}: sends a gateway token`);
  }
  return out;
}
