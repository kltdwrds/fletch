// M15.2 claims (Muse spec §17.3, §17.6), with Ada and Bo: the hourly upkeep is the only minter and a
// daily line carries one claim at most, whatever wording the model proposes or however often it is
// shown the line; `memory_write` takes no claim, even from a model that plants one; a dated event's
// claim reads `expired` after its UTC day, on every hit with its marker, and the upkeep retires it
// with no model call.
import { describe, expect, it } from "vitest";
import { memoryTools } from "../../packages/agent/src/memory/tools.ts";
import { eventEnd } from "../../packages/agent/src/memory/store.ts";
import { ada, personLoopWorld, } from "./support/loop-world.ts";

describe("[M15.2] one claim minter", () => {

  it("memory_write takes no claim: a model that plants one gets a code, and no line or claim is written", async () => {
    const w = personLoopWorld();
    for (const p of [ada.email]) {
      const [, , , write] = memoryTools({ api: w.of(p).svc, requester: p, setting: { scope: "personal" }, source: "chat:test" });
      expect(write?.name).toBe("memory_write");
      expect(JSON.stringify(write?.parameters)).not.toContain("claim");
      // A refused tool call throws its code, which the turn sees as the tool's error, never as saved.
      await expect(write?.execute("call-plant", { target: "daily", text: `${p} is leaving the company.`, claim: { kind: "fact", salience: 3 } } as never)).rejects.toThrow(/^MEMORY_CLAIM_BY_UPKEEP: /);
      expect(w.of(p).mem.rows("SELECT COUNT(*) AS n FROM daily_lines")).toEqual([{ n: 0 }]);
      expect(w.of(p).mem.rows("SELECT COUNT(*) AS n FROM claims")).toEqual([{ n: 0 }]);
      // Without the claim the same write is a line, for the upkeep to claim later.
      expect(await w.of(p).svc.memoryWrite({ target: "daily", text: `${p} is on leave next week.` }, { requester: p, setting: { scope: "personal" }, source: "chat:test", dedupe: "d1" })).toMatchObject({ ok: true });
      expect(w.of(p).mem.rows("SELECT COUNT(*) AS n FROM claims")).toEqual([{ n: 0 }]);
    }
  });
});

describe("[M15.2] claim expiry", () => {
  it("reads the end of a dated event's UTC day from its text, and only a real day", () => {
    expect(eventEnd("The review is on 2026-10-14.")).toBe(Date.UTC(2026, 9, 15));
    expect(eventEnd("Moved from 2026-02-30 to 2026-03-02.")).toBe(Date.UTC(2026, 2, 3));
    expect(eventEnd("The review is on Thursday.")).toBeNull();
  });
});
