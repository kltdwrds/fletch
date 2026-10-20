// The promotion ladder, hermetic (M11.1) on the two-member `solo-sam` (Ada the admin, Bo a member):
// the narrowing check against declared tools and connectors, the person's consent before anything
// moves up, the fresh-context referee on the cheap route, the merge key per scope, team skills
// reaching the team only, the human-edited lock, and the personal rung under the person's own grant.
import { describe, expect, it } from "vitest";
import { narrowingCheck } from "../../packages/agent/src/learning/narrowing.ts";
import { skillText } from "../../packages/agent/src/learning/ladder.ts";
import { forbiddenContent } from "../../packages/agent/src/learning/referee.ts";
import { personalSkillsPrefix } from "../../packages/agent/src/learning/personal.ts";
import { ada, lifecycleWorld, verdict } from "./support/lifecycle-world.ts";

const skill = (name: string, extra: Record<string, unknown> = {}) => ({ kind: "skill", target: "company", name, description: `how to ${name}`, body: "Steps.", ...extra });

describe("[M11.1] the narrowing check", () => {
  const holders = [{ member: ada.email, connectors: ["hackernews", "books"] }, { member: "former-member", connectors: ["hackernews"] }];
  const text = (tools: string[], connectors: string[], body = "Steps.") => skillText({ name: "x", description: "d", body, tools, connectors }, "company");

  it("passes a skill every member can run and refuses a connector one member lacks, naming who", () => {
    expect(narrowingCheck(text(["hn_top"], []), holders)).toEqual({ ok: true });
    const r = narrowingCheck(text([], ["books"]), holders);
    expect(r).toMatchObject({ ok: false, code: "PROMOTION_EXCEEDS_SCOPE", shortfall: [{ member: "former-member", connectors: ["books"] }] });
  });

  it("counts a tool's connector, refuses an unknown tool, and refuses what the body uses undeclared", () => {
    expect(narrowingCheck(text(["github_repo"], []), holders)).toMatchObject({ code: "PROMOTION_EXCEEDS_SCOPE" });
    expect(narrowingCheck(text(["make_payment"], []), holders)).toMatchObject({ code: "PROMOTION_EXCEEDS_SCOPE" });
    expect(narrowingCheck(text([], [], "Use cred://company-books to read."), holders)).toMatchObject({ code: "PROMOTION_UNDECLARED", undeclared: ["cred://books"] });
    expect(narrowingCheck(text([], [], "Call github_issues first."), holders)).toMatchObject({ code: "PROMOTION_UNDECLARED", undeclared: ["github_issues"] });
    expect(narrowingCheck(text([], []), [])).toMatchObject({ code: "PROMOTION_NO_READERS" });
  });

  it("finds credentials, codes and identifiers by code", () => {
    for (const bad of ["token ghp_abcdefghijklmnop1234", "the password: hunter22", "your code is 482913", "card 4111 1111 1111 1111"]) expect(forbiddenContent(bad)).not.toBeNull();
    expect(forbiddenContent("Close the books on the last Friday of the month.")).toBeNull();
  });
});

describe("[M11.1] the ladder into company scope", () => {

  it("the referee's reject, an unreadable verdict and a credential in the artifact each reject, the last with no model call", async () => {
    const w = lifecycleWorld({ script: [verdict("reject", "vague"), { text: "looks good to me" }] });
    const ids = [];
    for (const name of ["a-one", "a-two"]) {
      const p = await w.company().promotionPropose(ada.email, skill(name));
      if (!p.ok) throw new Error(p.code);
      ids.push(p.proposal.id);
    }
    expect(await w.company().promotionConsent(w.person(ada.email), ids[0] as string)).toMatchObject({ proposal: { status: "rejected", code: "REFEREE_REJECTED" } });
    expect(await w.company().promotionConsent(w.person(ada.email), ids[1] as string)).toMatchObject({ proposal: { status: "rejected", code: "REFEREE_UNPARSEABLE" } });
    const secret = await w.company().promotionPropose(ada.email, { kind: "memory", target: "company", text: "the vendor portal password: tulip-4471" });
    if (!secret.ok) throw new Error(secret.code);
    expect(await w.company().promotionConsent(w.person(ada.email), secret.proposal.id)).toMatchObject({ proposal: { status: "rejected", code: "PROMOTION_SENSITIVE" } });
    expect(w.fake.requests).toHaveLength(2);
  });
});

describe("[M11.1] the human-edited lock", () => {

  it("the personal rung: under the person's self-learning grant the agent writes at once, citing it; a hand edit locks it", async () => {
    const w = lifecycleWorld();
    const h = w.host(ada.email);
    const pending = await h.learning.propose({ name: "standup", description: "how Bo runs standup", body: "v1" });
    expect(pending).toMatchObject({ ok: true, status: "pending", decision: "ask" });
    expect(await h.learning.merge(w.agent(ada.email), (pending as { id: string }).id)).toMatchObject({ code: "PROMOTION_PERSON_ONLY" });
    expect(await h.learning.merge(w.person(ada.email), (pending as { id: string }).id)).toMatchObject({ ok: true, write: { name: "standup" } });
    const g = await h.authority.create(ada.email, { grantor: { kind: "person", id: ada.email }, grantee: { kind: "own-agent" }, subject: { kind: "skill", ref: "standup" }, mode: "auto", created_from: "chat-confirmation", constraints: {} });
    if (!g.ok) throw new Error(g.code);
    expect(await h.learning.propose({ name: "standup", description: "how Bo runs standup", body: "v2" })).toMatchObject({ ok: true, status: "merged", grantId: g.grant.id, write: { name: "standup" } });
    await h.learning.editByHand(w.person(ada.email), { name: "standup", description: "how Bo runs standup", body: "Bo's hand" });
    expect(await h.learning.propose({ name: "standup", description: "how Bo runs standup", body: "v3" })).toMatchObject({ status: "merged", write: { name: "standup-v2", beside: "standup" } });
    expect(w.r2.text(`${personalSkillsPrefix(ada.email)}standup/SKILL.md`)).toContain("Bo's hand");
  });
});
