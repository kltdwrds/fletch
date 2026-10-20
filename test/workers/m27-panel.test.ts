// M27.4: the profile panel's tab bodies on the Fletch system (the canvas's `panelRows`, `ptabs`, `runs` and the job
// dialog; ListRow, IdentityCards, Dialog, ConfirmDialog). The page is the shipped script under the page harness; its
// requests go to the agent script's real `route` as Ada or Bo of solo-sam, and the scripted fake drives the real
// chat engine, cards, grant store and `Job` objects, so what a row says for one person is the owning store's answer.
// The pixels are `pnpm screens` against the boards (`pnpm design-diff`), run on staging and recorded in DECISIONS-LOG.
import { describe, expect, it } from "vitest";
import { ACTIVITY_GLYPH, PANEL_BODY, PANEL_TABS, PANEL_TEXT } from "../../packages/agent/src/http/app/panel.ts";
import { APP_PAGE } from "../../packages/agent/src/http/page.ts";
import { KIND_WORDS } from "../../packages/agent/src/obs/activity-words.ts";
import { type FakeStep, report } from "../support/fake-model.ts";
import { ada, authorityWorld } from "./support/authority-world.ts";
import { type El, page } from "./support/page-harness.ts";

const settle = async () => {
  for (let i = 0; i < 60; i++) await new Promise((r) => setImmediate(r));
};
type Layout = Parameters<typeof page>[1];
type World = ReturnType<typeof authorityWorld>;
type Answer = (path: string, init?: { method?: string }) => Response | null;

/** A person's page whose requests go to the world's real routes as that person, unless `over` answers first. */
async function pageOf(w: World, person: string, layout: Layout = { desktop: true }, over?: Answer) {
  const p = await page(
    {
      onSend() {},
      fetch: async (path, init) => {
        const o = over?.(path, init);
        if (o) return o;
        const r = await w.http(person, init?.method ?? "GET", path, init?.body ? JSON.parse(init.body) : undefined);
        return new Response(JSON.stringify(r.body), { status: r.status });
      },
    },
    layout,
  );
  await settle();
  return p;
}
type Page = Awaited<ReturnType<typeof pageOf>>;
const tab = async (p: Page, k: (typeof PANEL_TABS)[number]) => {
  await p.byId(`panel-tab-${k}`).onclick?.();
  await settle();
};
const click = async (e: El) => {
  await e.onclick?.();
  await settle();
};
/** Every element under `e`, depth first. */
const all = (e: El): El[] => e.children.flatMap((c) => [c, ...all(c)]);
const byClass = (e: El, cls: string) => all(e).filter((c) => c.className.split(" ").includes(cls));
const headings = (e: El) => e.children.filter((c) => c.tag === "h3").map((c) => c.textContent);
const rowsOf = (e: El) => byClass(e, "prow");
const unreadable = (path: string): Answer => (p) => (p === path ? new Response(JSON.stringify({ ok: false, code: "LEDGER_UNAVAILABLE" }), { status: 503 }) : null);

const mail = (id: string): FakeStep => ({ toolCall: { id, name: "mail_send", arguments: { body: "Notes." } } });
/** Ada's agent proposes a mail; she decides it with `choice`, and the continuation turn answers. */
async function decidedMail(w: World, choice: "once" | "always", id = "m1") {
  w.fake.enqueue(mail(id));
  const { chatId } = await w.say(ada.email, "Mail Bo the notes.");
  w.fake.enqueue({ text: "Sent." });
  const card = w.cardsOf(ada.email).find((c) => c.state === "pending") as { id: string };
  await w.chats.harness(chatId).instance.decide([card.id], { person: ada.email, agent: false }, choice);
  return chatId;
}

const BODY = "Remind me to stretch.";
const NO_GATE = { no_gate_reason: "A reminder at a set time: there is nothing to watch." };
const create = (id: string, title: string, schedule: Record<string, unknown>): FakeStep => ({
  toolCall: { id, name: "jobs_create", arguments: { title, instructions: BODY, schedule, ...(schedule.kind === "runonce" ? {} : NO_GATE) } },
});
const load: FakeStep = { toolCall: { id: "l1", name: "tool_search", arguments: { load: ["jobs"] } } };
/** Ada's jobs, made through the real `jobs_create`; each is off until she turns it on. */
async function jobs(w: World, made: FakeStep[]) {
  w.fake.enqueue(load, ...made, { text: "Set." });
  const { chatId } = await w.say(ada.email, "Set these up.");
  return chatId;
}
/** Turns a job on through `jobs_enable` and Ada's approval of its card. */
async function enable(w: World, chatId: string, jobId: string) {
  // The turn pauses on the card, so the continuation's answer is queued only after it.
  w.fake.enqueue({ toolCall: { id: `e-${jobId}`, name: "jobs_enable", arguments: { id: jobId } } });
  await w.say(ada.email, "Turn it on.", chatId);
  w.fake.enqueue({ text: "On." });
  const card = w.cardsOf(ada.email).find((c) => c.state === "pending") as { id: string };
  await w.chats.harness(chatId).instance.decide([card.id], { person: ada.email, agent: false }, "once");
}
/** Ada's daily job, on, with one run that reported. */
async function dailyOn(w: World) {
  const chatId = await jobs(w, [create("c1", "Advisory retainer daily push", { kind: "daily", at: "09:06" })]);
  const [id] = w.jobIds(ada.email) as [string];
  await enable(w, chatId, id);
  w.fake.enqueue(report("Two new filings."));
  await w.fireJob(ada.email, id);
  return id;
}
const openFirstJob = async (p: Page) => {
  await tab(p, "upcoming");
  await click(all(p.byId("job-list")).find((e) => e.dataset.job) as El);
};

describe("[M27.4] the Activity tab", () => {
  it("is day groups of ListRows, each with its glyph, title, line and time, from Ada's own journal; Bo's panel says it has nothing yet", async () => {
    const w = authorityWorld({ script: [] });
    w.fake.enqueue(mail("m1"));
    await w.say(ada.email, "Mail Bo the notes.");
    w.clock.now += 2 * 86_400_000;
    w.fake.enqueue(mail("m2"));
    await w.say(ada.email, "Mail Bo the notes again.");
    const notes = ((await w.http(ada.email, "GET", "/app/activity")).body as { notes: Array<{ title: string; line: string }> }).notes;
    expect(notes.length).toBeGreaterThanOrEqual(2);
    const p = await pageOf(w, ada.email);
    const box = p.byId("panel-activity");
    expect(headings(box)).toHaveLength(2);
    const rows = rowsOf(box);
    expect(rows.map((r) => byClass(r, "t-sub-m")[0]?.textContent)).toEqual(notes.map((n) => n.title));
    expect(rows.map((r) => byClass(r, "t-foot")[0]?.textContent)).toEqual(notes.map((n) => n.line));
    for (const r of rows) {
      expect(byClass(r, "prow-tile")[0]?.children[0]?.copyOf).toBe(`glyph-${ACTIVITY_GLYPH["Sent a mail"]}`);
      expect(byClass(r, "prow-side")[0]?.textContent).toMatch(/\d:\d\d/);
    }
    const pb = await pageOf(w, other.email);
    expect([rowsOf(pb.byId("panel-activity")).length, pb.byId("panel-activity").text()]).toEqual([0, PANEL_TEXT.activityEmpty]);
  });

  it("every journal family has a glyph, and an activity that could not be read is said, never drawn as nothing yet", async () => {
    for (const [, title] of KIND_WORDS) expect(ACTIVITY_GLYPH[title]).toBeTruthy();
    const p = await pageOf(authorityWorld({ script: [] }), ada.email, undefined, unreadable("/app/activity"));
    const said = p.byId("panel-activity").text();
    expect(said).toContain("Could not read your activity");
    expect(said).not.toContain(PANEL_TEXT.activityEmpty);
  });
});

describe("[M27.4] the Approvals tab", () => {
  it("history rows say the decision and open to where it went, how it was decided and its words; Bo's history holds none of Ada's", async () => {
    const w = authorityWorld({ script: [] });
    await decidedMail(w, "once");
    const decided = ((await w.http(ada.email, "GET", "/app/approvals")).body as { decided: Array<{ title: string; status: string; dest: string; lines: string[]; standing: string | null }> }).decided;
    expect(decided).toHaveLength(1);
    const [c] = decided as [(typeof decided)[number]];
    expect([c.status, c.dest.length > 0, c.standing]).toEqual(["Allowed once; it ran.", true, null]);
    const p = await pageOf(w, ada.email);
    await tab(p, "approvals");
    const [row] = rowsOf(p.byId("approval-history")) as [El];
    expect([byClass(row, "t-sub-m")[0]?.textContent, byClass(row, "t-foot")[0]?.textContent, byClass(row, "prow-side")[0]?.textContent?.replace(/^\d+(m|h|d)$/, "ago")]).toEqual([c.title, c.status, "ago"]);
    const detail = byClass(p.byId("approval-history"), "prow-detail")[0] as El;
    expect([detail.hidden, row.attrs["aria-expanded"]]).toEqual([true, "false"]);
    await click(row);
    expect([detail.hidden, row.attrs["aria-expanded"]]).toEqual([false, "true"]);
    const dl = detail.children[0] as El;
    expect(dl.children.map((x) => x.textContent)).toEqual([PANEL_TEXT.destination, c.dest, PANEL_TEXT.decision, c.status]);
    for (const line of c.lines) expect(detail.text()).toContain(line);
    // An allowed-once decision left no standing grant: there is nothing to revoke.
    expect(all(detail).some((e) => e.dataset.revoke)).toBe(false);
    const pb = await pageOf(w, other.email);
    await tab(pb, "approvals");
    expect([rowsOf(pb.byId("approval-history")).length, pb.byId("approval-history").text()]).toEqual([0, PANEL_TEXT.historyEmpty]);
  });

  it("an always decision offers Revoke while its grant stands; Bo cannot revoke it, Ada's Revoke ends it in her grant store and the row says so", async () => {
    const w = authorityWorld({ script: [] });
    await decidedMail(w, "always");
    const standing = (((await w.http(ada.email, "GET", "/app/approvals")).body as { decided: Array<{ standing: string | null }> }).decided[0]?.standing) as string;
    expect(standing).toMatch(/^g_/);
    const live = async () => (await w.grantsNow()).find((g) => g.id === standing);
    expect((await live())?.revoked_at).toBeUndefined();
    // The grant store decides: Bo's session names Ada's grant and is refused, and her grant stands.
    expect((await w.http(other.email, "POST", `/api/grants/${standing}/revoke`, {})).status).toBe(404);
    expect((await live())?.revoked_at).toBeUndefined();
    const p = await pageOf(w, ada.email);
    await tab(p, "approvals");
    await click(rowsOf(p.byId("approval-history"))[0] as El);
    const revoke = all(p.byId("approval-history")).find((e) => e.dataset.revoke === standing) as El;
    expect(revoke.textContent).toBe(PANEL_TEXT.revoke);
    await click(revoke);
    expect((await live())?.revoked_at).toBeTypeOf("number");
    expect(p.byId("approval-history").text()).toContain(PANEL_TEXT.revoked);
    await tab(p, "approvals");
    expect(p.byId("approval-history").text()).toContain(PANEL_TEXT.wasRevoked);
    expect(all(p.byId("approval-history")).some((e) => e.dataset.revoke)).toBe(false);
  });

  it("a grant list that could not be read offers no Revoke and says so, never as revoked", async () => {
    const w = authorityWorld({ script: [] });
    await decidedMail(w, "always");
    const p = await pageOf(w, ada.email, undefined, unreadable("/api/grants"));
    await tab(p, "approvals");
    const hist = p.byId("approval-history");
    expect(all(hist).some((e) => e.dataset.revoke)).toBe(false);
    expect(hist.text()).toContain(PANEL_TEXT.grantsUnread);
    expect(hist.text()).not.toContain(PANEL_TEXT.wasRevoked);
  });
});

describe("[M27.4] the Upcoming tab", () => {
  it("groups Reminders, Daily, Every n minutes and Weekly in that order, each row its cadence; Bo's tab says he has none", async () => {
    const w = authorityWorld({ jobs: true, script: [] });
    await jobs(w, [
      create("c1", "Inbox weekly check", { kind: "weekly", days: [1], at: "09:06" }),
      create("c2", "Health check-in", { kind: "interval", every_minutes: 30 }),
      create("c3", "Advisory retainer daily push", { kind: "daily", at: "09:06" }),
      create("c4", "Check ticketing for Sunday", { kind: "runonce", in_minutes: 60 }),
    ]);
    expect(w.jobIds(ada.email)).toHaveLength(4);
    const listed = ((await w.http(ada.email, "GET", "/app/jobs")).body as { jobs: Array<{ title: string; job: { cadence: string } }> }).jobs;
    const p = await pageOf(w, ada.email);
    await tab(p, "upcoming");
    const list = p.byId("job-list");
    expect(headings(list)).toEqual(["Reminders", "Daily", "Every 30 minutes", "Weekly"]);
    const titles = rowsOf(list).map((r) => byClass(r, "t-sub-m")[0]?.textContent);
    expect(titles).toEqual(["Check ticketing for Sunday", "Advisory retainer daily push", "Health check-in", "Inbox weekly check"]);
    for (const r of rowsOf(list)) {
      const job = listed.find((j) => j.title === byClass(r, "t-sub-m")[0]?.textContent);
      expect(byClass(r, "t-foot")[0]?.textContent).toContain(job?.job.cadence);
      expect([r.tag, byClass(r, "prow-tile")[0]?.className]).toEqual(["button", "prow-tile prow-tile--round"]);
    }
    const pb = await pageOf(w, other.email);
    await tab(pb, "upcoming");
    expect([rowsOf(pb.byId("job-list")).length, pb.byId("jobs-note").textContent]).toEqual([0, PANEL_TEXT.remindersEmpty]);
  });

  it("a row opens the job dialog with its state, schedule and next run, its run history that folds, and Run now and Turn off for an on job", async () => {
    const w = authorityWorld({ jobs: true, script: [] });
    await dailyOn(w);
    const p = await pageOf(w, ada.email);
    await openFirstJob(p);
    const dlg = p.byId("job-dialog");
    expect([dlg.hidden, dlg.parent?.id, p.byId("scrim").className]).toEqual([false, "scrim", "qf-scrim2 qf-scrim2--full"]);
    expect([p.byId("job-state").textContent, p.byId("job-title").textContent]).toEqual(["On", "Advisory retainer daily push"]);
    expect(p.byId("job-words").textContent).toMatch(/9:06.* · Next: /);
    const runs = p.byId("job-runs");
    expect(runs.children).toHaveLength(1);
    expect(runs.text()).toContain(`${PANEL_TEXT.runReported} · scheduled`);
    // Run history folds as the system's disclosure (M29.6): the body stays mounted and .is-closed collapses it.
    const fold = () => [p.byId("job-runs-toggle").attrs["aria-expanded"], p.byId("job-runs-acc").className, p.byId("job-runs-chev").className];
    // The fake DOM's nodes carry no markup classes, so the open state is the empty list and the markup is read from the page.
    expect(APP_PAGE).toContain(`<span id="job-runs-chev" class="qf-acc-chev">`);
    expect(APP_PAGE).toContain(`<div id="job-runs-acc" class="qf-acc"><div id="job-runs">`);
    expect(fold()).toEqual(["true", "", ""]);
    await click(p.byId("job-runs-toggle"));
    expect(fold()).toEqual(["false", "is-closed", "is-closed"]);
    await click(p.byId("job-runs-toggle"));
    expect(fold()).toEqual(["true", "", ""]);
    expect(runs.parent?.id).toBe("job-runs-acc");
    expect([p.byId("job-run").hidden, p.byId("job-toggle").textContent, p.byId("job-toggle").dataset.action]).toEqual([false, PANEL_TEXT.jobOff, "disable"]);
    expect(APP_PAGE).toContain(`<button id="job-run" class="qf-btn qf-btn--secondary">${PANEL_TEXT.runNow}</button>`);
    expect(APP_PAGE).toContain(`<button id="job-remove" class="qf-btn qf-btn--destructive">${PANEL_TEXT.jobRemove}</button>`);
    await click(p.byId("job-back"));
    expect([dlg.hidden, dlg.parent?.id]).toEqual([true, "panel"]);
  });

  it("an off job's dialog offers Turn on and no Run now, and on a phone the dialog takes the panel sheet's place", async () => {
    const w = authorityWorld({ jobs: true, script: [] });
    await jobs(w, [create("c1", "Inbox weekly check", { kind: "weekly", days: [1], at: "09:06" })]);
    const p = await pageOf(w, ada.email, {});
    await p.byId("open-agent").onclick?.();
    expect(p.byId("panel").parent?.id).toBe("panel-dialog");
    await openFirstJob(p);
    expect([p.byId("panel").parent?.id, p.byId("job-dialog").parent?.id, p.byId("scrim").className]).toEqual(["panel-pin", "scrim", "qf-scrim2 qf-scrim2--full"]);
    expect([p.byId("job-run").hidden, p.byId("job-toggle").textContent, p.byId("job-runs").text()]).toEqual([true, PANEL_TEXT.jobOn, PANEL_TEXT.noRuns]);
  });

  it("Run now's result stays said in the dialog as far as the run went, and the dialog redraws the job with the new run (QYVR-224)", async () => {
    const w = authorityWorld({ jobs: true, script: [] });
    await dailyOn(w);
    const p = await pageOf(w, ada.email);
    await openFirstJob(p);
    w.clock.now += 60_000;
    w.fake.enqueue(report("One more filing."));
    await click(p.byId("job-run"));
    expect([p.byId("job-result").textContent, p.byId("job-dialog").hidden, p.byId("job-dialog").parent?.id]).toEqual([`${PANEL_TEXT.runNow}: ${PANEL_TEXT.runStarted}.`, false, "scrim"]);
    expect(p.byId("job-runs").children).toHaveLength(2);
  });

  it("Remove is asked again on the ConfirmDialog: Cancel removes nothing; the second tap removes it and the confirmation stays visible in the dialog (QYVR-224)", async () => {
    const w = authorityWorld({ jobs: true, script: [] });
    const id = await dailyOn(w);
    const p = await pageOf(w, ada.email);
    await openFirstJob(p);
    await click(p.byId("job-remove"));
    expect([p.byId("confirm").hidden, p.byId("confirm-ok").textContent, p.byId("confirm-ok").className]).toEqual([false, PANEL_TEXT.jobRemove, "qf-btn qf-btn--destructive"]);
    await click(p.byId("confirm-cancel"));
    expect([p.byId("confirm").hidden, w.jobIds(ada.email), p.byId("job-result").textContent]).toEqual([true, [id], ""]);
    await click(p.byId("job-remove"));
    await click(p.byId("confirm-ok"));
    expect(w.jobIds(ada.email)).toEqual([]);
    const result = p.byId("job-result");
    // The confirmation is on screen: the dialog is still open on the scrim, and nothing above it hides the line.
    expect([result.textContent, result.hidden, p.byId("job-dialog").hidden, p.byId("job-dialog").parent?.id, p.byId("scrim").hidden, p.byId("confirm").hidden]).toEqual([PANEL_TEXT.jobRemoved, false, false, "scrim", false, true]);
    expect(p.byId("job-actions").hidden).toBe(true);
    expect(all(p.byId("job-list")).some((e) => e.dataset.job === id)).toBe(false);
  });
});

describe("[M27.4] the Identity tab", () => {
  it("is the name card and the SOUL and MEMORY cards, each opening its own file in the viewer; SOUL says what the file is", async () => {
    const w = authorityWorld({ script: [] });
    const profile = (await w.http(ada.email, "GET", "/app/profile")).body as Record<"soul" | "memory", { ok: boolean; lines: Array<{ text: string }> }>;
    const p = await pageOf(w, ada.email);
    await tab(p, "identity");
    expect(APP_PAGE).toContain('<button id="tile-soul" class="qf-idcard qf-idcard--soul"');
    expect(APP_PAGE).toContain('<button id="tile-memory" class="qf-idcard qf-idcard--mem"');
    expect(APP_PAGE).toMatch(/<div class="qf-idname"><h3>Your agent<\/h3><button id="profile-edit"[^>]* disabled/);
    for (const [k, file, about] of [["soul", "SOUL.md", true], ["memory", "MEMORY.md", false]] as const) {
      await click(p.byId(`tile-${k}`));
      const f = profile[k];
      expect(f.ok).toBe(true);
      expect([p.byId("file-dialog").parent?.id, p.byId("file-title").textContent, p.byId("file-about").hidden]).toEqual(["scrim", file, !about]);
      expect(p.byId("file-lines").children.map((c) => c.textContent)).toEqual(f.lines.length ? f.lines.map((x) => x.text) : [PANEL_TEXT.fileEmpty]);
      await click(p.byId("file-back"));
      expect(p.byId("file-dialog").hidden).toBe(true);
    }
  });

  it("a profile that could not be read says so; the cards open nothing stale", async () => {
    const p = await pageOf(authorityWorld({ script: [] }), ada.email, undefined, unreadable("/app/profile"));
    await tab(p, "identity");
    expect(p.byId("profile-note").text()).toContain("Could not read your agent's profile");
    expect(p.byId("tile-soul").onclick).toBeNull();
  });
});

describe("[M27.4] the panel's ids", () => {
  it("the four bodies and the job dialog arrive; the Devices tab, Reminders and Profile tabs and Compact are gone", () => {
    for (const k of PANEL_TABS) expect(APP_PAGE).toContain(`id="${PANEL_BODY[k]}"`);
    expect(Object.values(PANEL_BODY)).toEqual(["panel-activity", "panel-approvals", "panel-upcoming", "panel-identity"]);
    expect(APP_PAGE).toContain('id="job-dialog"');
    for (const id of ["job-title", "job-words", "job-actions", "job-result", "job-runs", "close-sheet"]) expect(APP_PAGE).toContain(`id="${id}"`);
    expect(APP_PAGE).not.toMatch(/id="(sheet-tab-devices|sheet-tab-reminders|sheet-tab-profile|sheet-devices|compact|compact-result|sheet-activity|sheet-reminders|sheet-profile|sheet-job|sheet-file)"/);
  });
});

describe("[M27.4] the panel's shared words", () => {
  it("Settings' usage card still draws its totals with the panel's usage words, never as a usage it could not read", async () => {
    const w = authorityWorld({ jobs: true, script: [] });
    const usage = { ok: true, totals: { costMicros: 0, tokens: 1234 }, runs: { total: 1 } };
    const over: Answer = (path) =>
      path.startsWith("/app/usage.json") ? new Response(JSON.stringify(usage)) : path === "/app/loops" ? new Response(JSON.stringify({ ok: true, loops: [] })) : null;
    const p = await pageOf(w, ada.email, { desktop: true }, over);
    await click(p.byId("to-settings"));
    await click(p.byId("settings-menu-open"));
    expect([p.byId("usage-month").textContent, p.byId("usage-day").textContent]).toEqual([`${PANEL_TEXT.free} · 1 ${PANEL_TEXT.run[0]}`, `1234 ${PANEL_TEXT.token[1]} today`]);
  });
});

/** A former member's label: rows and files keyed by a person who is not on the roster (fletch's fixtures hold one person). */
const other = { ...ada, id: "former-member", email: "former-member", name: "Pat" };
