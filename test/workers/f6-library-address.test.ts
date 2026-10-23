// F6: the Library's file address (D-0009's grammar, its collection rule). A file is `/library/files/<path>`, each
// segment encoded alone and decoded one by one; the page booted there draws the viewer on that file, opening one from
// the list pushes its address, the viewer's Back is the browser's back, and Copy link copies the address. `?file=` is
// gone. `/library/<collection>/<id…>` is a page only for a registered collection: `files` here, `artifacts` the
// artifact plan's row to add (D-0010). The page is the shipped script under the page harness over the authority
// world's real routes and each member's real `PersonFiles`, as Sam or Pat of solo-sam; the model is the scripted fake.
import { describe, expect, it } from "vitest";
import { passkeyIdentity, SESSION_COOKIE } from "@qyvr/host-cloudflare";
import { LIBRARY_TEXT } from "../../packages/agent/src/http/app/library.ts";
import { ROUTER_TEXT } from "../../packages/agent/src/http/app/router.ts";
import { APP_PAGE } from "../../packages/agent/src/http/page.ts";
import { COLLECTIONS, collectionPath, PAGES, pageOf } from "../../packages/agent/src/http/pages.ts";
import { serve } from "../../packages/agent/src/http/serve.ts";
import { ada, authorityWorld, person, T0, TENANT } from "./support/authority-world.ts";
import { type El, page } from "./support/page-harness.ts";

const pat = person("pat-solo");
const ORIGIN = `https://${TENANT}.example`;
const HTML = { accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" };
const settle = async () => {
  for (let i = 0; i < 40; i++) await new Promise((r) => setImmediate(r));
};
const world = () => authorityWorld({ script: [], seed: [ada, pat], stores: true });
type World = ReturnType<typeof world>;

/** A file in the person's own store. */
async function put(w: World, who: string, path: string, text: string, minute = 0) {
  w.clock.now = T0 + minute * 60_000;
  expect(await w.host(who).files.write({ path, text }, { requester: who, writer: `person:${who}` })).toMatchObject({ ok: true });
}

/** A person's page booted at `path` on the world's real routes, with the clicks the Library needs. */
async function pageAt(w: World, who: string, path: string, o: { clipboard?: string[]; plant?: (js: string) => string; listed?: (body: unknown) => unknown } = {}) {
  const asked: string[] = [];
  const p = await page(
    {
      onSend() {},
      fetch: async (url, init) => {
        asked.push(url);
        const r = await w.http(who, init?.method ?? "GET", url, init?.body ? JSON.parse(init.body) : undefined);
        const body = url === "/app/library" && o.listed ? o.listed(r.body) : r.body;
        return new Response(JSON.stringify(body), { status: r.status });
      },
    },
    { desktop: true, path, ...(o.clipboard ? { clipboard: o.clipboard } : {}) },
    o.plant,
  );
  await settle();
  const click = async (id: string) => {
    await p.byId(id).onclick?.();
    await settle();
  };
  const open = async (path: string) => {
    const it = p.byId("lib-list").children.find((c) => c.dataset.path === path) as El;
    await (it.children[0]?.onclick ? it.children[0] : it).onclick?.();
    await settle();
  };
  const address = () => p.location.pathname + p.location.search + p.location.hash;
  const viewing = () => (p.byId("viewer").hidden ? null : p.byId("viewer-title").textContent);
  const shownText = () => p.byId("viewer-body").text();
  return { ...p, asked, click, open, address, viewing, shownText };
}

/** Sam's and Pat's sessions, and a `serve()` GET as either, as `f4-pages` makes them. */
async function signedIn() {
  const w = authorityWorld({ seed: [ada, pat] });
  const company = w.companyHarness().instance;
  const identity = passkeyIdentity({ call: async (c) => company.loginCall(c) as never, owner: ada.email, tenant: TENANT, now: () => w.clock.now });
  const env = { ...w.env, OWNER_EMAIL: ada.email, HOST: { identity } };
  const mint = async (email: string) => (await company.loginCall({ op: "mint", email, needsPasskey: false })) as string;
  const sessions = { sam: await mint(ada.email), pat: await mint(pat.email) };
  const get = (p: string, cookie: string) => serve(new Request(`${ORIGIN}${p}`, { headers: { ...HTML, cookie: `${SESSION_COOKIE}=${cookie}` } }), env as never, { tenant: TENANT }, { dir: w.dir, now: () => w.clock.now });
  return { sessions, get };
}

describe("[F6] a Library file has its address", () => {
  it("booted at /library/files/notes/trip.md the viewer opens that file, the title names it, and its Back lands on /library", async () => {
    const w = world();
    await put(w, ada.email, "notes/trip.md", "# Lisbon\n\nThe harbour opens at nine.", 1);
    await put(w, ada.email, "notes/other.md", "# Other\n\nNot this one.", 2);
    const p = await pageAt(w, ada.email, "/library/files/notes/trip.md");
    expect([p.address(), p.byId("app").dataset.view, p.viewing()]).toEqual(["/library/files/notes/trip.md", "library", "trip.md"]);
    expect(p.shownText()).toContain("The harbour opens at nine.");
    expect(p.shownText()).not.toContain("Not this one.");
    expect(p.document.title).toBe(`trip.md · ${ROUTER_TEXT.app}`);
    // A fresh tab: the list is rebuilt beneath, so Back is the browser's back to the Library, not out of the app.
    expect(p.history.entries).toEqual(["/library", "/library/files/notes/trip.md"]);
    await p.click("viewer-back");
    expect([p.address(), p.history.index, p.viewing(), p.byId("lib-list-view").hidden]).toEqual(["/library", 0, null, false]);
    expect(p.document.title).toBe(`${LIBRARY_TEXT.title} · ${ROUTER_TEXT.app}`);
    // Forward redraws the file at its address; a reload there keeps it.
    p.history.go(1);
    await settle();
    expect([p.address(), p.viewing()]).toEqual(["/library/files/notes/trip.md", "trip.md"]);
    const reloaded = await pageAt(w, ada.email, p.address());
    expect([reloaded.address(), reloaded.viewing()]).toEqual(["/library/files/notes/trip.md", "trip.md"]);
  });

  it("opening a file from the list pushes its address and the viewer's Back returns to /library", async () => {
    const w = world();
    await put(w, ada.email, "notes/trip.md", "# Lisbon\n\nNine.", 1);
    const p = await pageAt(w, ada.email, "/library");
    expect(p.history.entries).toEqual(["/library"]);
    await p.open("notes/trip.md");
    expect([p.address(), p.history.entries, p.viewing()]).toEqual(["/library/files/notes/trip.md", ["/library", "/library/files/notes/trip.md"], "trip.md"]);
    await p.click("viewer-back");
    expect([p.address(), p.history.index, p.viewing()]).toEqual(["/library", 0, null]);
    // The browser's own back does the same as the viewer's.
    await p.open("notes/trip.md");
    p.history.back();
    await settle();
    expect([p.address(), p.viewing(), p.byId("lib-list-view").hidden]).toEqual(["/library", null, false]);
  });

  it("a segment with a space or a # round-trips through the address, each segment encoded alone and decoded one by one", async () => {
    const w = world();
    // The store names files in `[A-Za-z0-9._-]` alone, so no stored file holds a space or a `#` today; the address
    // carries any name. The list's answer gains one such row, to show the page encodes what it is given.
    const path = "trip notes/day #1.md";
    const at = "/library/files/trip%20notes/day%20%231.md";
    const listed = (body: unknown) => {
      const b = body as { files: { files: unknown[] } };
      return { ...b, files: { ...b.files, files: [{ path, size: 9, updated_at: T0, pinned: false }, ...b.files.files] } };
    };
    const p = await pageAt(w, ada.email, "/library", { listed });
    await p.open(path);
    expect([p.address(), p.location.hash, p.viewing()]).toEqual([at, "", "day #1.md"]);
    // The page asks its Person for exactly the decoded path: the `#` is no fragment and the space is a space.
    expect(p.asked).toContain(`/app/file?path=${encodeURIComponent(path)}`);
    expect(collectionPath("files", path)).toBe(at);
    expect(pageOf(at)).toMatchObject({ row: { name: "files" }, id: path });
    // Booted at the address, the same path is asked for, and the Person's refusal of the name is said at it.
    const booted = await pageAt(w, ada.email, at);
    expect([booted.address(), booted.viewing(), booted.byId("nowhere").hidden]).toEqual([at, "day #1.md", true]);
    expect(booted.asked).toContain(`/app/file?path=${encodeURIComponent(path)}`);
    expect([booted.byId("viewer-note").dataset.code, booted.byId("viewer-note").textContent]).toEqual(["FILES_PATH_INVALID", LIBRARY_TEXT.refused.FILES_PATH_INVALID]);
    // A stored name with every character the store allows round-trips to the file itself.
    await put(w, ada.email, "Trip-notes/day_1.v2.md", "# Day one\n\nThe ferry at ten.", 1);
    const plain = await pageAt(w, ada.email, collectionPath("files", "Trip-notes/day_1.v2.md"));
    expect([plain.address(), plain.viewing()]).toEqual(["/library/files/Trip-notes/day_1.v2.md", "day_1.v2.md"]);
    expect(plain.shownText()).toContain("The ferry at ten.");
  });

  it("Copy link copies /library/files/<path> and nothing reads ?file= any more (planted: the old link opens nothing)", async () => {
    const w = world();
    await put(w, ada.email, "notes/trip.md", "# Lisbon\n\nNine.", 1);
    const copied: string[] = [];
    const p = await pageAt(w, ada.email, "/library", { clipboard: copied });
    await p.open("notes/trip.md");
    await p.click("viewer-more");
    await p.click("viewer-share");
    expect(copied).toEqual(["https://solo-sam.example/library/files/notes/trip.md"]);
    expect(p.byId("viewer-note").textContent).toBe(LIBRARY_TEXT.linkCopied);
    // What it copied opens the file.
    const followed = await pageAt(w, ada.email, new URL(copied[0] as string).pathname);
    expect(followed.viewing()).toBe("trip.md");
    // The page holds no `?file=` link and no read of one.
    expect(APP_PAGE).not.toContain("?file=");
    expect(APP_PAGE).not.toMatch(/searchParams\)\.get\("file"\)|URLSearchParams\(location\.search\)\.get\("file"\)/);
    // The old link, `/?file=`, is no address: it opens no file, and home becomes the last chat as it always does.
    const old = await pageAt(w, ada.email, "/?file=notes%2Ftrip.md");
    expect([old.viewing(), old.byId("app").dataset.view]).toEqual([null, "chat"]);
    // Planted: the old Copy link. What it copies is not the file's address, and following it opens nothing.
    const planted: string[] = [];
    const back = await pageAt(w, ada.email, "/library", {
      clipboard: planted,
      plant: (js) => {
        const line = 'location.host + filePath(libOpened)';
        expect(js).toContain(line);
        return js.replace(line, 'location.host + "/?file=" + encodeURIComponent(libOpened)');
      },
    });
    await back.open("notes/trip.md");
    await back.click("viewer-more");
    await back.click("viewer-share");
    expect(planted).toHaveLength(1);
    expect(planted[0]).not.toBe(copied[0]);
    const u = new URL(planted[0] as string);
    expect(pageOf(u.pathname)?.row.name).toBe("home");
    expect((await pageAt(w, ada.email, u.pathname + u.search)).viewing()).toBeNull();
  });

  it("a file Pat cannot read is said in the viewer with its code at its address, never Sam's text and never the not-found page", async () => {
    const w = world();
    await put(w, ada.email, "notes/trip.md", "# Lisbon\n\nSam's harbour plan.", 1);
    // Sam's address in Pat's tab: Pat's own object answers for Pat's own tree, where there is no such file.
    const p = await pageAt(w, pat.email, "/library/files/notes/trip.md");
    expect([p.address(), p.byId("app").dataset.view, p.byId("nowhere").hidden, p.viewing()]).toEqual(["/library/files/notes/trip.md", "library", true, "trip.md"]);
    expect([p.byId("viewer-note").dataset.code, p.byId("viewer-note").textContent]).toEqual(["FILES_NOT_FOUND", LIBRARY_TEXT.refused.FILES_NOT_FOUND]);
    expect(p.shownText()).not.toContain("harbour");
    // A file the Person will not preview is refused by name at its address too.
    await w.host(pat.email).files.writeBytes({ path: "documents/brief.docx", bytes: new Uint8Array([80, 75, 3, 4]), mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }, { requester: pat.email, writer: `person:${pat.email}` });
    const binary = await pageAt(w, pat.email, "/library/files/documents/brief.docx");
    expect([binary.byId("nowhere").hidden, binary.viewing(), binary.byId("viewer-note").dataset.code]).toEqual([true, "brief.docx", "FILES_BINARY"]);
    // Sam, at the same address, reads it.
    const sam = await pageAt(w, ada.email, "/library/files/notes/trip.md");
    expect([sam.viewing(), sam.byId("viewer-note").dataset.code ?? ""]).toEqual(["trip.md", ""]);
    expect(sam.shownText()).toContain("Sam's harbour plan.");
  });
});

describe("[F6] the grammar's collection rule", () => {
  it("a file address is the page with 200 for Sam and Pat; .., an empty segment, a slash inside one and an unregistered collection are the not-found page with 404", async () => {
    const { sessions, get } = await signedIn();
    for (const cookie of [sessions.sam, sessions.pat]) {
      for (const at of ["/library/files/notes/trip.md", "/library/files/trip%20notes/day%20%231.md"]) {
        const r = await get(at, cookie);
        expect([at, r.status]).toEqual([at, 200]);
        expect(await r.text()).toBe(APP_PAGE);
      }
      // `/library/files/../x` is resolved by the URL to `/library/x`, which is no page; the escaped dots and an
      // encoded slash are refused by the grammar itself.
      for (const at of ["/library/files/../x", "/library/files/%2e%2e/x", "/library/files/notes//trip.md", "/library/files/a%2Fb.md", "/library/files/", "/library/files", "/library/other/x"]) {
        const r = await get(at, cookie);
        expect([at, r.status, r.headers.get("location")]).toEqual([at, 404, null]);
        expect(await r.text()).toBe(APP_PAGE);
      }
    }
    for (const at of ["/library/files/../x", "/library/files/./x", "/library/files/%2E%2E/x", "/library/files/a//b", "/library/files/a/", "/library/files/a%2fb", "/library/files/%E0%A4%A", "/library/other/x"]) expect([at, pageOf(at)]).toEqual([at, null]);
  });

  it("the page draws the not-found page at those paths and names them", async () => {
    const w = world();
    for (const at of ["/library/files/%2e%2e/x", "/library/files/a%2Fb.md", "/library/files/%E0%A4%A", "/library/other/x", "/library/artifacts/x"]) {
      const p = await pageAt(w, ada.email, at);
      expect([at, p.byId("app").dataset.view, p.byId("nowhere").hidden, p.viewing()]).toEqual([at, "nowhere", false, null]);
      // The browser resolves the escaped dots before the page reads the address.
      expect(p.byId("nowhere-path").textContent).toBe(ROUTER_TEXT.missing.replace("{path}", p.location.pathname));
    }
  });

  it("/library/artifacts/x is the not-found page with 404 until the artifact plan registers its collection (D-0010's row)", async () => {
    // `files` is the one registered collection; `artifacts` is the artifact plan's row in `COLLECTIONS` to add.
    expect(Object.keys(COLLECTIONS)).toEqual(["files"]);
    expect(PAGES.filter((r) => r.pattern.startsWith("^/library/")).map((r) => r.name)).toEqual(["files"]);
    const { sessions, get } = await signedIn();
    for (const cookie of [sessions.sam, sessions.pat]) {
      const r = await get("/library/artifacts/x", cookie);
      expect([r.status, r.headers.get("location")]).toEqual([404, null]);
    }
    expect(pageOf("/library/artifacts/x")).toBeNull();
  });
});
