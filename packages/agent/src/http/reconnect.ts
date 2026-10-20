// The chat page's socket that reconnects (QUESTIONS.md Q7, M14.2): a close the page did not ask for
// is followed by a new socket after a backoff, and every state is shown, so a message typed while the
// socket is down is said not to be sent rather than going nowhere. Shipped inside the page as script
// text; the hermetic suite runs this same text against a scripted socket.
//
// From M18.1 (QYVR-164) a socket must prove it answers, because a browser socket can hang while it
// connects or die silently, and neither fires a close: a connect is bounded, and on the person's
// action (`nudge`) a socket that is down reconnects at once instead of waiting out its backoff, and
// one that looks open is asked once (`probe`) and must answer with any frame. A send must be answered
// the same way. A socket that does not answer in time is dropped and a new one opens, whose history
// draws what was missed. Every timer here belongs to one connect or one action; nothing holds a socket
// open or pings it on a schedule (Q33).

/** Waits before each reconnect, in order; the last repeats. */
export const RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 5_000, 10_000, 30_000];
/** How long a connect may take before the page gives up on that socket and opens another. */
export const OPEN_TIMEOUT_MS = 10_000;
/** How long an open socket has to answer a send or a check before the page drops it. */
export const ANSWER_TIMEOUT_MS = 10_000;

export const RECONNECT_SCRIPT = `function keepConnected(open, onState, o) {
  const delays = o.delays, later = o.schedule || ((f, ms) => setTimeout(f, ms)), cancel = o.cancel || ((t) => clearTimeout(t));
  let attempt = 0, ws = null, live = false, stopped = false, timer = null, waiting = null;
  const unwait = () => { if (waiting !== null) { cancel(waiting); waiting = null; } };
  // A socket that did not answer in time: the page closes it and opens the next one now.
  function drop(s, code, reason) {
    if (ws !== s) return;
    ws = null; live = false; waiting = null;
    try { s.close(code, reason); } catch {}
    attempt++;
    onState("reconnecting", { code, reason, inMs: 0, attempt });
    go();
  }
  function expect(s, ms, code, reason) { unwait(); waiting = later(() => { waiting = null; drop(s, code, reason); }, ms); }
  function go() {
    if (timer !== null) { cancel(timer); timer = null; }
    if (stopped) return;
    onState("connecting", { attempt });
    const s = open();
    ws = s; live = false;
    expect(s, o.openTimeoutMs, 4001, "the connect was not answered");
    s.onopen = () => { if (ws !== s) return; unwait(); live = true; attempt = 0; onState("connected", {}); };
    s.onmessage = (e) => { if (ws !== s) return; unwait(); o.onmessage(e); };
    s.onclose = (e) => {
      if (ws !== s) return;
      ws = null; live = false; unwait();
      const ms = delays[Math.min(attempt, delays.length - 1)];
      attempt++;
      onState("reconnecting", { code: e.code, reason: e.reason || "", inMs: ms, attempt });
      timer = later(() => { timer = null; go(); }, ms);
    };
  }
  go();
  const up = () => !!ws && live && ws.readyState === 1;
  return {
    connected: up,
    // The person acted. A socket that is down opens now; one that looks open is asked once, unless a
    // send or an earlier check is already waiting for its answer; a socket still connecting has its bound.
    nudge(check) {
      if (stopped) return;
      if (up()) { if (check && waiting === null) { ws.send(o.probe); expect(ws, o.answerTimeoutMs, 4002, "the socket did not answer a check"); } return; }
      if (!ws) go();
    },
    send(data) {
      if (!up()) { this.nudge(false); return false; }
      ws.send(data);
      expect(ws, o.answerTimeoutMs, 4003, "the socket did not answer a send");
      return true;
    },
    stop() { stopped = true; unwait(); if (timer !== null) { cancel(timer); timer = null; } const s = ws; ws = null; live = false; if (s) s.close(1000, "switched"); onState("closed", {}); },
  };
}`;
