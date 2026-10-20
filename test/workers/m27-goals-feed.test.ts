// M27.7: the Goals and Feed pages on the Fletch system (the canvas's `Main`: PageHeader, ListRow's group header and goal
// row, Checkbox, Card, Feedback's error Card). The page is the shipped script under the page harness. No store holds
// goals or digests yet, so a test hands the shipped script a sample-shaped answer the way the engine parts will, and
// nothing here involves a second person: what a route draws is the answer it is given, which its store scopes to the
// person. A hermetic DOM cannot see layout: what it holds is which class each node takes, which node is shown and what
// each says. The pixels are `pnpm screens` against the boards (`pnpm design-diff --only goals,feed`), run on staging
// and recorded in DECISIONS-LOG.
import { describe, expect, it } from "vitest";
import { GOALS_TEXT, FEED_TEXT, type DigestDay, type GoalsAnswer } from "../../packages/agent/src/http/app/goals-feed.ts";
import { APP_PAGE } from "../../packages/agent/src/http/page.ts";
import { type El, page } from "./support/page-harness.ts";

const settle = async () => {
  for (let i = 0; i < 40; i++) await new Promise((r) => setImmediate(r));
};
const open = async (layout: Parameters<typeof page>[1] = {}) => {
  const p = await page({ onSend() {} }, layout);
  await settle();
  return p;
};
const sample: GoalsAnswer = {
  tracking: [
    { id: "t1", title: "Solo Sam renewal", sub: "Quote sent; the contract is with legal.", waiting: true },
    { id: "t2", title: "Other Tenant introduction" },
  ],
  goals: [
    { id: "g1", title: "Ship the prototype video", sub: "Script drafted; recording slot not booked yet." },
    { id: "g2", title: "Book the winter flights", sub: "Booked and confirmed.", done: true },
    { id: "g3", title: "Relocate for the winter" },
    { id: "g4", title: "Renew the lease" },
    { id: "g5", title: "Plan the offsite" },
  ],
};
const day: DigestDay = {
  day: "Saturday, Oct 17",
  written: "6:40 pm",
  summary: "A quiet day: one thing needs you.",
  stat: "4 things done, 1 waiting",
  rows: [
    { kind: "waiting", title: "Asked you to approve the Other Tenant quote", sub: "It waits in the Main chat." },
    { kind: "web", title: "Read the venue's listings" },
    { kind: "agent", title: "Drafted outreach batch 4", sub: "Ready for your look." },
    { kind: "done", title: "Checked Sunday ticketing" },
    { kind: "done", title: "Filed the receipts" },
  ],
};
const all = (n: El): El[] => [n, ...n.children.flatMap(all)];
const byClass = (n: El, cls: string) => all(n).filter((x) => x.className.split(" ").includes(cls));
const rowsOf = (list: El) =>
  list.children.map((r) => ({
    goal: r.dataset.goal,
    cls: r.className,
    check: r.children[0]?.className,
    checked: r.children[0]?.checked,
    live: !r.children[0]?.disabled,
    label: r.children[0]?.attrs["aria-label"],
    title: r.children[1]?.children[0]?.textContent,
    sub: r.children[1]?.children.find((c) => c.tag === "p")?.textContent,
    pill: r.children[1]?.children.find((c) => c.className.includes("goal-waiting"))?.textContent,
  }));

describe("[M27.7] the Goals page frame on the system", () => {
  it("the route is the system's page column at 768 under the shell's PageHeader, with Tracking and Goals as group headers and their ids kept", async () => {
    // The ids the scope keeps, adds and drops: the page ids the module named, the error Card's two, and the lists' wrapper.
    for (const id of ["goals", "goals-tracking", "goals-goals", "goals-tracking-title", "goals-goals-title", "feed", "feed-days", "feed-note", "goals-error", "goals-retry"]) expect(APP_PAGE).toContain(`id="${id}"`);
    const p = await open();
    await p.ui.show("goals");
    const title = p.byId("view-title");
    expect([p.byId("goals").hidden, p.byId("feed").hidden, title.textContent, title.hidden, p.byId("head").className.includes("qf-phead--768")]).toEqual([false, true, "Goals", false, true]);
    // The group headers: Tracking on the success colour, Goals on the working one, each a halo and the heading.
    const heads = [...APP_PAGE.matchAll(/<div class="(qf-dotlbl[^"]*)"><span class="halo"><\/span><h2 id="(goals-[a-z]+-title)">([^<]+)<\/h2>/g)].map((m) => [m[1], m[2], m[3]]);
    expect(heads).toEqual([
      ["qf-dotlbl", "goals-tracking-title", GOALS_TEXT.tracking],
      ["qf-dotlbl qf-dotlbl--blue", "goals-goals-title", GOALS_TEXT.goals],
    ]);
    expect(APP_PAGE).toMatch(/<main id="goals" hidden><div class="qf-page qf-page--768"><div class="qf-page-in goals-page">/);
    expect(APP_PAGE).toMatch(/<main id="feed" hidden><div class="qf-page qf-page--768"><div class="qf-page-in feed-page">/);
  });

  it("with no store each group says it is empty in words, and the error Card is not shown", async () => {
    const p = await open();
    await p.ui.show("goals");
    await settle();
    const says = (id: string) => p.byId(id).children.map((c) => [c.tag, c.className, c.textContent]);
    expect(says("goals-tracking")).toEqual([["p", "t-sub t-2 empty-line", GOALS_TEXT.trackingEmpty]]);
    expect(says("goals-goals")).toEqual([["p", "t-sub t-2 empty-line", GOALS_TEXT.goalsEmpty]]);
    expect([p.byId("goals-lists").hidden, p.byId("goals-error").hidden]).toEqual([false, true]);
  });
});

describe("[M27.7] the goal rows from an answer", () => {
  it("each row is the system's goal row: the Checkbox, the title, the line, the pill; a done goal is checked and struck, and every row of the answer is drawn in its order", async () => {
    const p = await open();
    p.draw.goalsDraw(sample);
    expect(rowsOf(p.byId("goals-tracking"))).toEqual([
      { goal: "t1", cls: "qf-goalrow", check: "qf-check", checked: false, live: false, label: "Solo Sam renewal", title: "Solo Sam renewal", sub: "Quote sent; the contract is with legal.", pill: GOALS_TEXT.waiting },
      { goal: "t2", cls: "qf-goalrow", check: "qf-check", checked: false, live: false, label: "Other Tenant introduction", title: "Other Tenant introduction", sub: undefined, pill: undefined },
    ]);
    const goals = rowsOf(p.byId("goals-goals"));
    expect(goals.map((r) => r.goal)).toEqual(["g1", "g2", "g3", "g4", "g5"]);
    expect(goals[1]).toEqual({ goal: "g2", cls: "qf-goalrow is-done", check: "qf-check", checked: true, live: false, label: "Book the winter flights", title: "Book the winter flights", sub: "Booked and confirmed.", pill: undefined });
    // The row's parts: the checkbox is an input, the title an h3, the line a p, the pill a Chip; none of the old classes.
    const row = p.byId("goals-tracking").children[0] as El;
    expect(row.children.map((c) => c.tag)).toEqual(["input", "div"]);
    expect((row.children[1] as El).children.map((c) => [c.tag, c.className])).toEqual([["h3", ""], ["p", ""], ["span", "qf-chip goal-waiting"]]);
    // A second draw replaces the first; an empty list says so again.
    p.draw.goalsDraw({ tracking: [], goals: [{ id: "g9", title: "Only one" }] });
    expect([p.byId("goals-tracking").children[0]?.textContent, rowsOf(p.byId("goals-goals")).map((r) => r.goal)]).toEqual([GOALS_TEXT.trackingEmpty, ["g9"]]);
  });

  it("an answer's words are text, never markup, and a row acts on nothing yet", async () => {
    const p = await open();
    p.draw.goalsDraw({ tracking: [], goals: [{ id: "x", title: "<img src=x onerror=alert(1)>", sub: "<b>bold</b>" }] });
    const row = p.byId("goals-goals").children[0] as El;
    expect([(row.children[1] as El).children[0]?.textContent, (row.children[1] as El).children[1]?.textContent]).toEqual(["<img src=x onerror=alert(1)>", "<b>bold</b>"]);
    expect([row.onclick, (row.children[0] as El).onclick, (row.children[0] as El).disabled]).toEqual([null, null, true]);
  });
});

describe("[M27.7] the Goals error Card", () => {
  it("a read that fails shows the error Card in words with its code kept on the node, and Try again, and the lists are not drawn as empty; Try again reads once more and draws the answer", async () => {
    const p = await open();
    let reads = 0;
    const read = async () => {
      reads++;
      if (reads === 1) throw Object.assign(new Error("store down"), { code: "GOALS_STORE_DOWN" });
      return sample;
    };
    await p.draw.goalsLoad(read);
    expect([p.byId("goals-error").hidden, p.byId("goals-lists").hidden]).toEqual([false, true]);
    expect([p.byId("goals-error-body").textContent, p.byId("goals-error-body").dataset.code]).toEqual([GOALS_TEXT.errorBody, "GOALS_STORE_DOWN"]);
    const card = p.byId("goals-error");
    expect(card.parent?.id).toBe("goals");
    expect(APP_PAGE).toContain(`<div id="goals-error" class="qf-error-card" role="alert" hidden>`);
    expect(GOALS_TEXT.errorTitle).toBe("Couldn't load goals right now");
    expect(APP_PAGE).toContain(`<button id="goals-retry" class="qf-btn qf-btn--primary qf-btn--icon-start">`);
    expect(APP_PAGE).toContain(`${GOALS_TEXT.retry}</button>`);
    await p.byId("goals-retry").onclick?.();
    await settle();
    expect(reads).toBe(2);
    expect([p.byId("goals-error").hidden, p.byId("goals-lists").hidden, rowsOf(p.byId("goals-goals")).length]).toEqual([true, false, 5]);
  });

  it("an answer that does not hold both lists is a failure with its reason, never two empty groups, and a late answer from an earlier read is not drawn", async () => {
    const p = await open();
    p.draw.goalsDraw(sample);
    await p.draw.goalsLoad(async () => ({ tracking: [] }));
    expect([p.byId("goals-error").hidden, p.byId("goals-lists").hidden]).toEqual([false, true]);
    expect([p.byId("goals-error-body").textContent, p.byId("goals-error-body").dataset.code]).toEqual([GOALS_TEXT.errorBody, "GOALS_ANSWER_INVALID"]);
    // The refused answer drew nothing of its own: the rows of the earlier good answer are untouched, not replaced by empties.
    expect(rowsOf(p.byId("goals-goals")).length).toBe(5);
    // A read that has been overtaken by a newer one is dropped when it answers.
    const held: Array<(a: unknown) => void> = [];
    const slow = p.draw.goalsLoad(() => new Promise((r) => held.push(r)));
    await p.draw.goalsLoad(async () => ({ tracking: [], goals: [{ id: "new", title: "New" }] }));
    held[0]?.({ tracking: [{ id: "old", title: "Old" }], goals: [] });
    await slow;
    expect([rowsOf(p.byId("goals-goals")).map((r) => r.goal), p.byId("goals-tracking").children[0]?.textContent, p.byId("goals-error").hidden]).toEqual([["new"], GOALS_TEXT.trackingEmpty, true]);
    // The route's own load draws the empty answer, since no store exists, and clears a shown error.
    await p.draw.goalsLoad(async () => {
      throw new Error("x");
    });
    expect([p.byId("goals-error-body").textContent, p.byId("goals-error-body").dataset.code]).toEqual([GOALS_TEXT.errorBody, ""]);
    await p.ui.show("goals");
    await settle();
    expect([p.byId("goals-error").hidden, p.byId("goals-goals").children[0]?.textContent]).toEqual([true, GOALS_TEXT.goalsEmpty]);
  });
});

describe("[M27.7] the Feed page frame and the digest", () => {
  it("with no digest the page says so in words and draws no day; the route sits under the shell's PageHeader", async () => {
    const p = await open();
    await p.ui.show("feed");
    expect([p.byId("feed").hidden, p.byId("goals").hidden, p.byId("view-title").textContent, p.byId("feed-days").children.length, p.byId("feed-note").textContent]).toEqual([false, true, "Feed", 0, FEED_TEXT.empty]);
    p.draw.feedDraw([day]);
    expect(p.byId("feed-note").textContent).toBe("");
    p.draw.feedDraw([]);
    expect([p.byId("feed-days").children.length, p.byId("feed-note").textContent]).toEqual([0, FEED_TEXT.empty]);
  });

  it("a day is a Card with its title and the time beside it, the summary, the count line and the rule, then every row on its tile in the answer's order", async () => {
    const p = await open();
    p.draw.feedDraw([day, { ...day, day: "Friday, Oct 16", rows: [] }]);
    const days = p.byId("feed-days").children;
    expect(days.map((d) => [d.tag, d.className, d.attrs["aria-label"]])).toEqual([
      ["section", "qf-prompt-card digest-day", "Saturday, Oct 17"],
      ["section", "qf-prompt-card digest-day", "Friday, Oct 16"],
    ]);
    const first = days[0] as El;
    const head = first.children[0] as El;
    expect([head.className, head.children.map((c) => [c.tag, c.className, c.textContent])]).toEqual(["digest-head", [["h2", "", "Saturday, Oct 17"], ["span", "t-foot t-2 digest-time", "Written at 6:40 pm"]]]);
    expect(first.children.slice(1, 4).map((c) => [c.className, c.textContent])).toEqual([["digest-summary", day.summary], ["t-foot t-2", day.stat], ["digest-rule", ""]]);
    const rows = first.children.slice(4);
    expect(rows.map((r) => [r.children[0]?.className, r.children[0]?.children[0]?.copyOf, r.children[1]?.children[0]?.textContent, r.children[1]?.children[1]?.textContent])).toEqual([
      ["digest-tile digest-tile--warn", "glyph-shield", "Asked you to approve the Other Tenant quote", "It waits in the Main chat."],
      ["digest-tile digest-tile--web", "glyph-globe", "Read the venue's listings", undefined],
      ["digest-tile digest-tile--agent", "glyph-sparkle", "Drafted outreach batch 4", "Ready for your look."],
      ["digest-tile digest-tile--done", "glyph-check", "Checked Sunday ticketing", undefined],
      ["digest-tile digest-tile--done", "glyph-check", "Filed the receipts", undefined],
    ]);
    // A day with no rows is its header, summary, count and rule alone; a kind the page does not know takes the done tile.
    expect((days[1] as El).children.length).toBe(4);
    p.draw.feedDraw([{ ...day, rows: [{ kind: "mystery" as never, title: "Odd" }] }]);
    expect((p.byId("feed-days").children[0] as El).children[4]?.children[0]?.className).toBe("digest-tile digest-tile--done");
    expect(byClass(p.byId("feed-days"), "digest-row").length).toBe(1);
  });
});
