// Browser time as a Ledger cost (M25.4, SUB-2/BR-1): Browser Run is billed by the hour, so every call through the port is
// timed and reported with the run it belongs to, and the Ledger sums it beside the run's tokens. The port a tool sees is
// this wrapper; the time is wall time inside the call, whether it returned, refused or threw.
import type { BrowserPort } from "./port.ts";

export interface BrowserTime {
  op: string;
  ms: number;
  at: number;
}

export function meteredPort(port: BrowserPort, report: (t: BrowserTime) => Promise<void>, now: () => number): BrowserPort {
  const timed = async <T>(op: string, call: () => Promise<T>): Promise<T> => {
    const started = now();
    try {
      return await call();
    } finally {
      const at = now();
      // A cost that could not be written is said in the log; it never fails the browser call it measured.
      await report({ op, ms: Math.max(0, at - started), at }).catch((err: unknown) => console.error(`BROWSER_METER_FAILED: ${op}: ${String(err)}`));
    }
  };
  return {
    read: (url, engine) => timed("read", () => port.read(url, engine)),
    session: (known) => timed("session", () => port.session(known)),
    goto: (sessionId, url) => timed("goto", () => port.goto(sessionId, url)),
    handoff: (sessionId, instructions) => timed("handoff", () => port.handoff(sessionId, instructions)),
    handoffState: (sessionId) => timed("handoff_state", () => port.handoffState(sessionId)),
    close: (sessionId) => timed("close", () => port.close(sessionId)),
  };
}
