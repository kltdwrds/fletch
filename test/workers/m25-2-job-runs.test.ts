// M25.2: a job's model step can read and never write, under a hard ceiling, after the deterministic gate,
// and ends with exactly one terminal tool; silence is certified in code against the run's own calls.
// The real `Job` engine, Ledger, egress module and adapter run over a scripted page; the scripted fake
// and the compromised model drive the step. Ada and Bo where memory is read: the store decides.
import { describe, expect, it } from "vitest";
import { JOB_READ_TOOLS, readOnlyForJob } from "../../packages/agent/src/jobs/job-tools.ts";
import { certifySilence } from "../../packages/agent/src/jobs/silence.ts";
import type { ToolSpec } from "../../packages/agent/src/tools/registry.ts";
import { type FakeStep, report } from "../support/fake-model.ts";
import { jobWorld, PAGE } from "./support/job-world.ts";

const steps = [{ kind: "model" as const }, { kind: "notify" as const }];
const read = (id = "r1", url = PAGE): FakeStep => ({ toolCall: { id, name: "page_read", arguments: { url } } });
const claim = (over: Record<string, unknown> = {}) => ({ work: "read the release page", material_result: false, evidence: ["r1"], dependencies: [{ tool: "page_read", available: true, workaround: false }], watermark: "item 8863", ...over });
const silent = (over: Record<string, unknown> = {}, id = "t1"): FakeStep => ({ toolCall: { id, name: "nothing_to_report", arguments: claim(over) } });
const sent = (w: ReturnType<typeof jobWorld>, n: number) => JSON.stringify(w.fake.requests[n]?.inputs.messages ?? []);
const offered = (w: ReturnType<typeof jobWorld>, n = 0) => ((w.fake.requests[n]?.inputs.tools ?? []) as Array<{ function: { name: string } }>).map((t) => t.function.name).sort();

describe("[M25.2] the model step reads with tools, under a ceiling", () => {
  it("the step reads the page with page_read and reports on it: the tool result reaches the model as fenced data, once", async () => {
    const w = jobWorld({ script: [read(), report("The release notes changed: v1.")] });
    w.claimChat();
    await w.define({ steps });
    await w.tick();
    expect(w.page.hits).toBe(1);
    expect(sent(w, 1)).toContain('[BEGIN EXTERNAL CONTENT source=\\"web:hacker-news.firebaseio.com\\"]');
    expect(sent(w, 1)).toContain('{\\"title\\":\\"v1\\"}');
    expect(w.runs()).toMatchObject([{ signal: "notify" }]);
    expect(w.notices().map((n) => n.text)).toEqual(["The release notes changed: v1."]);
    expect(w.job.instance.inspect(w.owner)).toMatchObject({ calls: [{ tool: "page_read", ok: true, callId: "r1" }] });
  });

  it("the model is offered the read tools and the two terminal tools, never a write", async () => {
    const w = jobWorld({ script: [report("ok")], memory: { memorySearch: async () => ({ ok: true, hits: [] }), memoryGet: async () => ({ ok: false, code: "X", reason: "x" }), memoryExplain: async () => ({ ok: false, code: "X", reason: "x" }), memoryWrite: async () => ({ ok: false, code: "X", reason: "x" }), standingFiles: async () => [] } as never });
    w.claimChat();
    await w.define({ steps });
    await w.tick();
    const names = offered(w);
    expect(names).toEqual(expect.arrayContaining(["page_read", "memory_search", "memory_get", "docs_read", "report", "nothing_to_report"]));
    expect(names).not.toContain("memory_write");
    expect(names).not.toContain("memory_explain");
    expect(names.every((n) => JOB_READ_TOOLS.has(n) || n === "report" || n === "nothing_to_report")).toBe(true);
  });

  it("docs_read reads a platform manual from the docs prefix; an unknown slug is refused with a code", async () => {
    const w = jobWorld({ script: [{ toolCall: { id: "d1", name: "docs_read", arguments: { slug: "scheduling" } } }, { toolCall: { id: "d2", name: "docs_read", arguments: { slug: "secrets" } } }, report("Read it.")], docs: { "docs/platform/scheduling.md": "Schedule with a gate." } });
    w.claimChat();
    await w.define({ steps });
    await w.tick();
    expect(sent(w, 1)).toContain("Schedule with a gate.");
    expect(sent(w, 2)).toContain("DOCS_UNKNOWN");
  });

  it("a write tool the hostile model calls is refused with JOB_WRITE_REFUSED and runs nothing", async () => {
    let wrote = 0;
    const write: ToolSpec = { name: "memory_write", kind: "observation", label: "w", description: "w", parameters: {} as never, mutates: true, execute: async () => { wrote++; return { content: [], details: {} }; } };
    const w = jobWorld({ mode: { kind: "compromised", hostile: { id: "h1", name: "memory_write", arguments: { target: "daily", text: "owned" } } }, extraTools: [write] });
    w.claimChat();
    await w.define({ steps });
    await w.tick();
    await w.settle();
    expect(wrote).toBe(0);
    expect(sent(w, 1)).toContain("JOB_WRITE_REFUSED");
    // It never ends with a terminal tool, so the run fails with a code, and never as a success.
    expect(w.runs()).toMatchObject([{ signal: "failed", code: "JOB_TERMINAL_MISSING" }]);
    // The hostile call delivers nothing; the person is told the run failed, with the code (M25.6).
    expect(w.notices().map((n) => n.text)).toEqual([expect.stringMatching(/^Test job did not finish: JOB_TERMINAL_MISSING /)]);
  });

  it("a tool the job has no spec for is refused with JOB_TOOL_UNKNOWN", async () => {
    const w = jobWorld({ script: [{ toolCall: { id: "x1", name: "jobs_create", arguments: { title: "more" } } }, report("Done.")] });
    w.claimChat();
    await w.define({ steps });
    await w.tick();
    expect(sent(w, 1)).toContain("JOB_TOOL_UNKNOWN");
    expect(w.job.instance.inspect(w.owner)).toMatchObject({ calls: [{ tool: "jobs_create", ok: false, code: "JOB_TOOL_UNKNOWN" }] });
  });

  it("the read-only rule is code over each spec: a named tool that writes, acts, touches a company subject, queues or refuses is not run", () => {
    const base: ToolSpec = { name: "memory_search", kind: "observation", label: "s", description: "s", parameters: {} as never, execute: async () => ({ content: [], details: {} }) };
    expect(readOnlyForJob(base)).toBe(true);
    expect(readOnlyForJob({ ...base, name: "memory_write" })).toBe(false);
    expect(readOnlyForJob({ ...base, mutates: true })).toBe(false);
    expect(readOnlyForJob({ ...base, kind: "action" })).toBe(false);
    expect(readOnlyForJob({ ...base, subject: () => ({ scope: "company", resource: "x" }) })).toBe(false);
    expect(readOnlyForJob({ ...base, queues: "self" })).toBe(false);
    expect(readOnlyForJob({ ...base, refuses: "NEVER" })).toBe(false);
  });

  it("the run's hard token ceiling stops the next call of a reading step before it is made", async () => {
    const w = jobWorld({ script: [{ ...read(), usage: { prompt: 900, completion: 200 } } as FakeStep, report("never")] });
    w.claimChat();
    await w.define({ steps, ceilingTokens: 1_000 });
    await w.tick();
    expect(w.fake.requests).toHaveLength(1);
    expect(w.runs()).toMatchObject([{ signal: "failed", code: "RUN_CEILING_REACHED" }]);
    expect(w.job.instance.inspect(w.owner)).toMatchObject({ calls: [{ tool: "page_read", ok: true }] });
  });
});

describe("[M25.2] the gate runs first", () => {
  it("ten gated ticks with no change make zero model calls in the Ledger, with the hostile model behind the step", async () => {
    const w = jobWorld({ mode: { kind: "compromised", hostile: { id: "h1", name: "report", arguments: { text: "Wake up!" } } } });
    w.claimChat();
    await w.define({ steps, gate: { kind: "url", url: PAGE } });
    await w.tick(); // the baseline
    for (let i = 0; i < 10; i++) await w.tick();
    expect(w.status()?.ticks).toBe(11);
    expect(await w.ledger().modelCalls({ person: w.owner })).toEqual([]);
    expect(w.fake.requests).toEqual([]);
    expect(w.runs()).toEqual([]);
    expect(w.notices()).toEqual([]);
    // The page changes: the gate opens and only then does the step reach the model.
    w.page.body = '{"title":"v2"}';
    await w.tick();
    expect((await w.ledger().modelCalls({ person: w.owner })).length).toBe(1);
    expect(w.runs()).toMatchObject([{ signal: "notify" }]);
  });
});

describe("[M25.2] certified silence", () => {
  it("nothing_to_report after a fresh read is accepted in code: the run is silent and its watermark is written for the next run", async () => {
    const w = jobWorld({ script: [read(), silent(), read("r2"), report("v2 is out.")] });
    w.claimChat();
    await w.define({ steps });
    await w.tick();
    expect(w.runs()).toMatchObject([{ signal: "nothing_to_report" }]);
    expect(w.notices()).toEqual([]);
    expect(w.status()?.gateState.mark).toBe("item 8863");
    await w.tick();
    expect(sent(w, 2)).toContain("The last run read up to: item 8863");
    expect(w.runs().map((r) => r.signal)).toEqual(["nothing_to_report", "notify"]);
  });

  it("a run the person asked for answers even when it is silent", async () => {
    const w = jobWorld({ script: [read(), silent()] });
    w.claimChat();
    await w.define({ steps });
    await w.engine().runNow(w.owner);
    await w.settle();
    expect(w.notices().map((n) => n.text)).toEqual(["Test job: nothing to report (read the release page)."]);
  });

  for (const [name, script, code] of [
    ["no work ran", [silent({ evidence: ["r1"] })], "SILENCE_NO_WORK"],
    ["evidence not from this run", [read(), silent({ evidence: ["r1", "r0-yesterday"] })], "SILENCE_STALE_EVIDENCE"],
    ["a material result", [read(), silent({ material_result: true })], "SILENCE_MATERIAL_RESULT"],
    ["a dependency declared unavailable", [read(), silent({ dependencies: [{ tool: "page_read", available: false, workaround: false }] })], "SILENCE_DEPENDENCY_UNAVAILABLE"],
    ["a dependency replaced by a workaround", [read(), silent({ dependencies: [{ tool: "page_read", available: true, workaround: true }] })], "SILENCE_WORKAROUND"],
    ["a dependency declared but never read", [read(), silent({ dependencies: [{ tool: "page_read", available: true, workaround: false }, { tool: "hn_item", available: true, workaround: false }] })], "SILENCE_WORKAROUND"],
    ["no watermark", [read(), silent({ watermark: "  " })], "SILENCE_NO_WATERMARK"],
  ] as const) {
    it(`silence is refused in code for ${name} (${code}): the model is told, and a second refusal fails the run`, async () => {
      const w = jobWorld({ script: [...script, ...script.slice(-1)] as FakeStep[] });
      w.claimChat();
      await w.define({ steps });
      await w.tick();
      expect(sent(w, script.length)).toContain(code);
      expect(w.runs()).toMatchObject([{ signal: "failed", code: "SILENCE_UNCERTIFIED" }]);
      expect(w.runs()[0]?.reason).toContain(code);
      expect(w.status()?.gateState.mark).toBeUndefined();
    });
  }

  it("a read that failed cannot be silent, and a run that then says so reports it", async () => {
    const w = jobWorld({ script: [read(), silent(), report("I could not read the release page: it answered 500.")] });
    w.page.status = 500;
    w.claimChat();
    await w.define({ steps });
    await w.tick();
    expect(sent(w, 2)).toContain("SILENCE_DEPENDENCY_UNAVAILABLE");
    expect(sent(w, 2)).toContain("SILENCE_NO_WORK");
    expect(w.runs()).toMatchObject([{ signal: "notify" }]);
  });

  it("the gate's own fresh observation counts as evidence for a gated run", () => {
    expect(certifySilence(claim({ evidence: ["gate"], dependencies: [] }), [], true)).toMatchObject({ ok: true });
    expect(certifySilence(claim({ evidence: ["gate"], dependencies: [] }), [], false)).toMatchObject({ ok: false });
  });
});
