// M15.2 claims (Muse spec §17.3, §17.6), with Ada and Bo: the hourly upkeep is the only minter and a
// daily line carries one claim at most, whatever wording the model proposes or however often it is
// shown the line; `memory_write` takes no claim, even from a model that plants one; a dated event's
// claim reads `expired` after its UTC day, on every hit with its marker, and the upkeep retires it
// with no model call.
import { describe, expect, it } from "vitest";
import { eventEnd } from "../../packages/agent/src/memory/store.ts";

describe("[M15.2] claim expiry", () => {
  it("reads the end of a dated event's UTC day from its text, and only a real day", () => {
    expect(eventEnd("The review is on 2026-10-14.")).toBe(Date.UTC(2026, 9, 15));
    expect(eventEnd("Moved from 2026-02-30 to 2026-03-02.")).toBe(Date.UTC(2026, 2, 3));
    expect(eventEnd("The review is on Thursday.")).toBeNull();
  });
});
