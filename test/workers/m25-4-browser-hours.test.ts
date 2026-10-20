// M25.4: browser time is a Ledger cost on the run. Every call through the metered port is timed on the test's clock and
// written as a row; the Ledger sums a run's rows into its run row beside its tokens, and one person's browsing never
// reaches another's totals. A call that throws is still metered; a Ledger that cannot write says so in the log and
// never fails the browser call.
import { describe, expect, it, vi } from "vitest";
import { meteredPort } from "../../packages/agent/src/browse/meter.ts";
import type { BrowserPort } from "../../packages/agent/src/browse/port.ts";
import { Ledger } from "../../packages/agent/src/objects/ledger.ts";
import { ObjectHarness } from "../support/object-harness.ts";
import { ada, T0, TENANT } from "./support/authority-world.ts";

const clock = { now: T0 };
const ledgerH = () => new ObjectHarness("ledger", (ctx, e) => new Ledger(ctx as DurableObjectState, e as Env), { QYVR_ENV: "test" }, (l) => { l.now = () => clock.now; });

/** A port whose calls take as long as the test says, and which can be made to throw. */
function slowPort(took: { ms: number }, fail = false): BrowserPort {
  const spend = async <T>(v: T): Promise<T> => {
    clock.now += took.ms;
    if (fail) throw new Error("BROWSER_CDP_TIMEOUT: no load within 30000 ms");
    return v;
  };
  return {
    read: () => spend({ ok: true as const, status: 200, markdown: "# page" }),
    session: () => spend({ ok: true as const, sessionId: "s1", reused: false }),
    goto: () => spend({ ok: true as const, page: { status: 200, url: "https://example.com/", title: "t", text: "x", links: [] } }),
    handoff: () => spend({ ok: false as const, code: "BROWSE_LIVE_VIEW_FAILED", reason: "none" }),
    handoffState: () => spend({ ok: true as const, active: false }),
    close: () => spend(undefined),
  };
}

describe("[M25.4] browser hours in the Ledger", () => {

  it("a call that throws is still metered and still throws; a Ledger that cannot write is logged and does not fail the call; a bad row is refused", async () => {
    const h = ledgerH();
    const rows: number[] = [];
    const took = { ms: 5_000 };
    const failing = meteredPort(slowPort(took, true), async (t) => { rows.push(t.ms); }, () => clock.now);
    await expect(failing.read("https://example.com/", "kitesurf")).rejects.toThrow("BROWSER_CDP_TIMEOUT");
    expect(rows).toEqual([5_000]);

    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const unwritable = meteredPort(slowPort(took), async () => { throw new Error("ledger down"); }, () => clock.now);
    expect(await unwritable.close("s1")).toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("BROWSER_METER_FAILED: close: Error: ledger down"));
    log.mockRestore();

    await expect(h.instance.recordBrowser({ tenant: TENANT, person: ada.email, runId: "r", op: "read", ms: -1, at: T0 })).rejects.toThrow("BROWSER_ROW_INVALID");
    expect(await h.instance.browserMs()).toBe(0);
  });
});
