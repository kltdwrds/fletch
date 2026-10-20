// covers: M4, M5, M8
// Family memory at M11.1 (M4, M5, M8): 20 skill proposals from Bo's and Ada's agents into company
// scope, 8 of them exceeding what every member holds (a company connector only Ada is granted, a
// tool on it, an undeclared credential reference, an unknown tool). The 8 are rejected by the
// narrowing check before any model call; the other 12 pass the referee and merge only on an admin's
// decision (M5). Nothing moves without the proposer's own consent, and a compromised agent cannot
// give it (M4). Credentials and codes never enter memory, by promotion or by import (M8).
import { describe, expect, it } from "vitest";
import { ada, lifecycleWorld, } from "../../workers/support/lifecycle-world.ts";

describe("[M11.1] family memory: promotion narrowing", () => {

  it("credentials and codes never enter memory: a promotion is rejected by code and an import drops them", async () => {
    const w = lifecycleWorld({ script: [{ text: JSON.stringify({ items: [{ text: "Bo likes window seats", kind: "preference" }, { text: "Bo's bank pin is 4421", kind: "fact" }, { text: "the api key is sk-live-abcdefghijklmnop", kind: "fact" }] }) }] });
    for (const text of ["ops login password: sea-otter-19", "the door code is 77120", "token ghp_0123456789abcdefABCD"]) {
      const p = await w.company().promotionPropose(ada.email, { kind: "memory", target: "company", text });
      if (!p.ok) throw new Error(p.code);
      expect(await w.company().promotionConsent(w.person(ada.email), p.proposal.id)).toMatchObject({ proposal: { status: "rejected", code: "PROMOTION_SENSITIVE" } });
    }
    const plan = await w.host(ada.email).imports.plan(w.model, w.person(ada.email), "Notes from my old assistant: Bo likes window seats. His bank pin is 4421.");
    if (!plan.ok) throw new Error(plan.code);
    expect(plan.items).toEqual([{ text: "Bo likes window seats", kind: "preference" }]);
    expect(plan.dropped).toHaveLength(2);
    expect(await w.host(ada.email).imports.confirm(w.person(ada.email), plan.id)).toEqual({ ok: true, saved: 1 });
    const all = w.host(ada.email).mem.rows<{ text: string }>("SELECT text FROM daily_lines").map((r) => r.text).join("\n");
    expect(all).toBe("Bo likes window seats");
  });
});
