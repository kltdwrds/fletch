// The browse tool (M9) through the real chat, gate and grants of the two-member solo-sam, with the
// scripted fake model and a scripted browser. What the model was shown is read from the fake's request
// log; what the browser was asked is read from the browser's own record, so "not tried" is observable.
import { describe, expect, it } from "vitest";
import { ada } from "./support/authority-world.ts";
import { browseWorld, LOGIN_HOST, LOGIN_REF, sinks } from "./support/browse-world.ts";

const load = { toolCall: { name: "tool_search", arguments: { load: ["browse"] } } };
const seen = (w: { fake: { requests: Array<{ inputs: { messages: unknown } }> } }) => JSON.stringify(w.fake.requests.at(-1)?.inputs.messages);

const DOCS = "https://docs.fixture.example/guide";
const sites = {
  "docs.fixture.example": { markdown: "# Guide\n\nStart with [setup](/setup), then read [pricing](https://docs.fixture.example/pricing) or [a mirror](https://evil.fixture.example/steal).\n\n![diagram](/d.png)" },
};

describe("[M9] the read lane", () => {

  it("refuses an address the person did not write and no page handed over, and a page's prose cannot supply one", async () => {
    const w = await browseWorld({
      sites,
      script: [
        load,
        { toolCall: { id: "v1", name: "browse_open", arguments: { url: "https://evil.fixture.example/steal" } } },
        { toolCall: { id: "v2", name: "browse_open", arguments: { url: DOCS } } },
        { toolCall: { id: "v3", name: "browse_open", arguments: { url: "https://docs.fixture.example/setup/" } } },
        { toolCall: { id: "v4", name: "browse_open", arguments: { url_id: 99 } } },
        { text: "Could not open those." },
      ],
    });
    await w.say(ada.email, `Look at ${DOCS}, and check the mirror the page mentions.`);
    const shown = seen(w);
    expect(shown.match(/BROWSE_URL_NOT_VERBATIM/g)?.length).toBe(2);
    expect(shown).toContain("BROWSE_URL_ID_UNKNOWN");
    // Only the one address the person wrote reached the browser.
    expect(w.browser.reads).toEqual([{ url: DOCS, engine: "kitesurf" }]);
  });

  it("escalates to Chromium only when Kitesurf cannot render, and remembers the engine per domain", async () => {
    const w = await browseWorld({
      sites: { "heavy.fixture.example": { markdown: "# Heavy page", kitesurfUnsupported: true } },
      script: [load, { toolCall: { id: "e1", name: "browse_open", arguments: { url: "https://heavy.fixture.example/" } } }, { text: "Read." }, { toolCall: { id: "e2", name: "browse_open", arguments: { url: "https://heavy.fixture.example/" } } }, { text: "Again." }],
    });
    await w.say(ada.email, "Read https://heavy.fixture.example/ please.");
    expect(w.browser.reads.map((r) => r.engine)).toEqual(["kitesurf", "chromium"]);
    expect(await w.learned(ada.email, "heavy.fixture.example")).toMatchObject({ engine: "chromium", state: "ok" });
    const chat = (await w.chatsOf(ada.email))[0] as string;
    await w.say(ada.email, "And https://heavy.fixture.example/ once more.", chat);
    expect(w.browser.reads.map((r) => r.engine)).toEqual(["kitesurf", "chromium", "chromium"]);
  });

  it("says when a page was cut: a long page is truncated aloud, never shown as whole", async () => {
    const long = `# Long\n${"line of text\n".repeat(3000)}`;
    const w = await browseWorld({
      sites: { "long.fixture.example": { markdown: long } },
      script: [load, { toolCall: { id: "t1", name: "browse_open", arguments: { url: "https://long.fixture.example/" } } }, { text: "Partly read." }],
    });
    await w.say(ada.email, "Read https://long.fixture.example/");
    expect(seen(w)).toMatch(/TRUNCATED: \d+ more characters were not shown/);
  });

  it("reports an unreachable page with what was tried, not as empty", async () => {
    const w = await browseWorld({
      sites: {},
      script: [load, { toolCall: { id: "u1", name: "browse_open", arguments: { url: "https://gone.fixture.example/" } } }, { text: "It did not load." }],
    });
    await w.say(ada.email, "Read https://gone.fixture.example/");
    expect(seen(w)).toMatch(/BROWSE_UNREACHABLE: gone.fixture.example could not be read; tried kitesurf \(404: no such site\), chromium/);
    expect(await w.learned(ada.email, "gone.fixture.example")).toBeNull();
  });
});

describe("[M9] a block stops the scope", () => {
  it("a rate limit stops that domain with the wait the service named", async () => {
    const w = await browseWorld({
      sites: { "busy.fixture.example": { wall: "rate" } },
      script: [load, { toolCall: { id: "l1", name: "browse_open", arguments: { url: "https://busy.fixture.example/" } } }, { text: "Rate limited." }],
    });
    await w.say(ada.email, "Read https://busy.fixture.example/");
    expect(seen(w)).toContain("BROWSE_RATE_LIMITED");
    expect(w.browser.reads).toEqual([{ url: "https://busy.fixture.example/", engine: "kitesurf" }]);
    expect(await w.learned(ada.email, "busy.fixture.example")).toMatchObject({ state: "blocked", code: "BROWSE_RATE_LIMITED" });
  });

  it("a refusal is reported as a refusal, and a block in the live lane offers the person the page, not another route", async () => {
    const w = await browseWorld({
      sites: { "forbidden.fixture.example": { wall: "forbidden" }, "gate.fixture.example": { wall: "bot" } },
      script: [
        load,
        { toolCall: { id: "f1", name: "browse_open", arguments: { url: "https://forbidden.fixture.example/" } } },
        { toolCall: { id: "f2", name: "browse_live", arguments: { url: "https://gate.fixture.example/" } } },
        { toolCall: { id: "f3", name: "browse_open", arguments: { url: "https://gate.fixture.example/" } } },
        { text: "Both stopped." },
      ],
    });
    await w.say(ada.email, "Try https://forbidden.fixture.example/ and https://gate.fixture.example/");
    const shown = seen(w);
    expect(shown).toContain("BROWSE_ACCESS_DENIED");
    expect(shown).toContain("The person can take over this page with browse_handoff");
    expect(w.browser.reads.map((r) => r.url)).toEqual(["https://forbidden.fixture.example/"]);
    expect(w.browser.gotos).toHaveLength(1);
    expect(await w.learned(ada.email, "gate.fixture.example")).toMatchObject({ engine: "live", state: "blocked" });
  });

  it("a remembered block lapses after a day, when the same route may be asked again", async () => {
    const w = await browseWorld({
      sites: { "walled.fixture.example": { wall: "bot" } },
      script: [load, { toolCall: { id: "t1", name: "browse_open", arguments: { url: "https://walled.fixture.example/" } } }, { text: "Blocked." }, { toolCall: { id: "t2", name: "browse_open", arguments: { url: "https://walled.fixture.example/" } } }, { text: "Blocked again." }],
    });
    const { chatId } = await w.say(ada.email, "Read https://walled.fixture.example/");
    expect(w.browser.reads).toHaveLength(1);
    w.clock.now += 25 * 60 * 60 * 1000;
    await w.say(ada.email, "Try https://walled.fixture.example/ again.", chatId);
    expect(w.browser.reads).toHaveLength(2);
  });
});

describe("[M9] the live lane and the handoff", () => {
  const app = { "app.fixture.example": { page: { title: "Sign in", text: "Enter the one-time code sent to your phone.", links: [{ text: "Help", href: "https://app.fixture.example/help" }] }, wall: undefined } };

  it("opens a page in a reused session, hands it to the person at a Live View link, and resumes once they are done", async () => {
    const w = await browseWorld({
      sites: app,
      script: [
        load,
        { toolCall: { id: "h1", name: "browse_live", arguments: { url: "https://app.fixture.example/login" } } },
        { toolCall: { id: "h2", name: "browse_handoff", arguments: { instructions: "Enter the one-time code from your phone." } } },
        { toolCall: { id: "h3", name: "browse_live", arguments: {} } },
        { text: "Please open the link and enter the code." },
        { toolCall: { id: "h4", name: "browse_live", arguments: {} } },
        { text: "You are in." },
      ],
    });
    const { chatId } = await w.say(ada.email, "Log in at https://app.fixture.example/login");
    const shown = seen(w);
    expect(shown).toContain("(live session; title: Sign in;");
    expect(shown).toContain("[Help](url_id:");
    expect(shown).toContain("HANDOFF_REQUESTED");
    expect(shown).toContain("https://live.fixture.example/view/sess-1-token");
    // The handoff is real: one request, with the instruction, on the session the page is open in.
    expect(w.browser.handoffs).toEqual([{ session: "sess-1", instructions: "Enter the one-time code from your phone." }]);
    // Asked again while the person is still in the Live View, the tool says so and touches nothing.
    expect(shown).toContain("HANDOFF_PENDING");
    expect(w.browser.gotos).toHaveLength(1);
    w.browser.completeHandoff("sess-1");
    await w.say(ada.email, "Done.", chatId);
    expect(w.browser.gotos).toEqual([{ session: "sess-1", url: "https://app.fixture.example/login" }, { session: "sess-1", url: null }]);
    expect(w.browser.sessions).toEqual(["sess-1"]);
  });
});

describe("[M9] credential fill", () => {
  const login = { [LOGIN_HOST]: { page: { title: "Sign in", text: "Username and password." }, echoTyped: true } };
  const script = [
    load,
    { toolCall: { id: "p1", name: "browse_live", arguments: { url: `https://${LOGIN_HOST}/` } } },
    { toolCall: { id: "p2", name: "browse_fill", arguments: { selector: "#password", credential: LOGIN_REF } } },
    { text: "Filled in." },
  ];
  const asked = `Sign in at https://${LOGIN_HOST}/ with my stored login.`;

  it("without a grant the fill waits on a card and nothing is typed", async () => {
    const w = await browseWorld({ sites: login, script });
    await w.say(ada.email, asked);
    expect(w.browser.typed).toEqual([]);
    expect(w.cardsOf(ada.email)).toMatchObject([{ id: "p2", state: "pending", proposed: { selector: "#password", credential: LOGIN_REF } }]);
  });

  it("under Ada's grant the value reaches the page and no model-visible, stored or logged place", async () => {
    const w = await browseWorld({
      sites: login,
      script: [...script.slice(0, 3), { toolCall: { id: "p3", name: "browse_live", arguments: {} } }, { text: "Signed in." }],
    });
    await w.grant(ada.email, { grantee: { kind: "own-agent" }, subject: { kind: "action-kind", ref: "browse.fill" }, mode: "auto" });
    await w.say(ada.email, asked);
    expect(w.browser.typed).toEqual([{ session: "sess-1", selector: "#password", value: w.token }]);
    const journal = await w.journal();
    expect(journal).toMatchObject([{ actionKind: "browse.fill", outcome: "DONE", grantId: expect.any(String) }]);
    // The page reflected the value back; the model saw the reference instead.
    expect(seen(w)).toContain("Welcome back, [redacted cred://fixture-login]");
    for (const [sink, text] of Object.entries(await sinks(w))) expect({ sink, leaked: text.includes(w.token) }).toEqual({ sink, leaked: false });
    // The Vault wrote an audit row for the fill, naming the reference and host, never the value.
    const audit = w.vault.instance.audit();
    expect(audit).toMatchObject([{ ref: LOGIN_REF, host: LOGIN_HOST, method: "FILL", person: ada.email, purpose: "browse_fill", outcome: "resolved" }]);
    expect(JSON.stringify(audit)).not.toContain(w.token);
  });

  it("plant the guard: with the scrub removed, a page that reflects what was typed puts the value in front of the model", async () => {
    const w = await browseWorld({
      sites: login,
      noScrub: true,
      script: [...script.slice(0, 3), { toolCall: { id: "p3", name: "browse_live", arguments: {} } }, { text: "Signed in." }],
    });
    await w.grant(ada.email, { grantee: { kind: "own-agent" }, subject: { kind: "action-kind", ref: "browse.fill" }, mode: "auto" });
    await w.say(ada.email, asked);
    expect(seen(w)).toContain(w.token);
  });
});
