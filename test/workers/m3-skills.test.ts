// M3.1: skills from R2 with scopes. Ada and Bo are both members of solo-sam; Sam is standalone.
// The catalog a person sees is the union of the scopes they may use, decided on every call; routing
// goes by description; a scope the person lacks is never shown, searched or read.
import { describe, expect, it } from "vitest";
import { ChatEngine, type EngineCtx } from "../../packages/agent/src/chat/engine.ts";
import { homeKey } from "../../packages/agent/src/memory/home.ts";
import { Ledger } from "../../packages/agent/src/objects/ledger.ts";
import { parseSkillFile, SkillCatalog } from "../../packages/agent/src/skills/catalog.ts";
import { FakeModel, type FakeStep } from "../support/fake-model.ts";
import { harnessNamespace, ObjectHarness } from "../support/object-harness.ts";
import { FakeR2 } from "./support/fake-r2.ts";
import people from "../fixtures/people.json" with { type: "json" };

const ada = people.people.find((p) => p.id === "sam-solo")!;

const skill = (name: string, description: string, body: string, includeInPrompt = false) =>
  `---\nname: ${name}\ndescription: ${description}\n${includeInPrompt ? "metadata:\n  includeInPrompt: true\n" : ""}---\n${body}\n`;

async function seeded() {
  const r2 = new FakeR2();
  await r2.put("skills/platform/deploy-checklist/SKILL.md", skill("deploy-checklist", "Verify a release before deploying it: checks, approvals, rollback. Not for writing code.", "# Deploy\n1. Check CI.", true));
  await r2.put("skills/platform/deploy-checklist/references/notes.md", "ignored: not a SKILL.md");
  await r2.put("skills/company/expense-report/SKILL.md", skill("expense-report", "File an expense report the Solo Sam way: receipts, categories, approval.", "# Expenses\nAttach receipts.", true));
  await r2.put(homeKey(ada.email, "skills/weekly-review/SKILL.md"), skill("weekly-review", "Ada's weekly review of open commitments and calendar for the week ahead.", "# Weekly review\nList commitments.", true));
  await r2.put(homeKey(ada.email, "skills/broken/SKILL.md"), "no frontmatter here");
  await r2.put(homeKey(ada.email, "skills/mismatch/SKILL.md"), skill("other-name", "A directory whose name differs from its frontmatter.", "x"));
  return r2;
}

describe("[M3.1] skills", () => {

  it("the shortlist is the union the person may use, marked for the prompt, and a SKILL.md that does not parse is skipped", async () => {
    const r2 = await seeded();
    const catalog = new SkillCatalog(r2, "company");
    expect((await catalog.shortlist(ada.email)).map((s) => `${s.name}:${s.scope}`)).toEqual(["deploy-checklist:platform", "expense-report:company", "weekly-review:personal"]);
    expect(parseSkillFile("---\nname: Bad Name\ndescription: x\n---\n")).toBeNull();
    expect(parseSkillFile('---\nname: ok\ndescription: "quoted text"\n---\nbody')).toEqual({ name: "ok", description: "quoted text", includeInPrompt: false, body: "body" });
  });

  it("in the chat the shortlist sits in the Skills block with scope tags, and skill_read fences the body as tool output", async () => {
    const r2 = await seeded();
    const script: FakeStep[] = [{ toolCall: { id: "s1", name: "skill_search", arguments: { query: "weekly review commitments" } } }, { toolCall: { id: "s2", name: "skill_read", arguments: { name: "weekly-review" } } }, { text: "Done." }];
    const fake = new FakeModel(script);
    const ledgers = harnessNamespace((name) => new ObjectHarness(name, (ctx, env) => new Ledger(ctx as DurableObjectState, env as Env), {}));
    const env = { TENANT_ID: ada.company, TENANT_SHAPE: "company", QYVR_ENV: "staging", AI: fake.binding, LEDGER: ledgers.binding };
    const chat = new ObjectHarness("chat-ada", (ctx, e) => new ChatEngine(ctx as EngineCtx, e as Env, { skills: new SkillCatalog(r2, "company") }), env, (c) => {
      c.wait = async () => {};
    });
    expect(await chat.instance.send({ person: ada.email, text: "do my weekly review" })).toMatchObject({ status: "done" });
    const prefix = String((fake.requests[0]!.inputs.messages[0] as { content: string }).content);
    expect(prefix).toContain("# Skills\n- deploy-checklist: [platform] Verify a release before deploying it: checks, approvals, rollback. Not for writing code.\n- expense-report: [company] File an expense report the Solo Sam way: receipts, categories, approval.\n- weekly-review: [personal] Ada's weekly review of open commitments and calendar for the week ahead.");
    const tools = (fake.requests[2]?.inputs.messages ?? []).filter((m) => m.role === "tool").map((m) => String(m.content));
    expect(tools[0]).toContain('[BEGIN EXTERNAL CONTENT source="tool:skill_search"]\n1 skills match "weekly review commitments"\n- weekly-review [personal]:');
    expect(tools[1]).toContain('[BEGIN EXTERNAL CONTENT source="tool:skill_read"]\nweekly-review [personal]: Ada\'s weekly review of open commitments and calendar for the week ahead.\n\n# Weekly review\nList commitments.');
  });
});
