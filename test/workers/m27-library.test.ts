// M27.5: the Library and its viewers on the Fletch system (the canvas's Library, TitlePicker, LibraryGrid, FilesTable,
// artifact viewer and DocumentViewer). The page is the shipped script under the page harness; its requests go to the
// agent script's real routes as Ada or Bo of solo-sam, over each member's real `PersonFiles`, so what a section lists
// and what a menu changes is the owning store's answer for that person. A hermetic DOM cannot see layout: what it holds
// is which node is where, which class and form it takes for the device the script reads, and what each control did to
// the store. The pixels are `pnpm screens` against the boards (`pnpm design-diff`), run on staging.
import { describe, expect, it } from "vitest";
import { LIB_KINDS, LIB_SECTIONS, LIBRARY_CSS, LIBRARY_MARKUP, LIBRARY_SCRIPT, LIBRARY_TEXT, RECENT_SHOWN } from "../../packages/agent/src/http/app/library.ts";
import { APP_PAGE } from "../../packages/agent/src/http/page.ts";
import { ada, authorityWorld, T0 } from "./support/authority-world.ts";
import { type El, page } from "./support/page-harness.ts";

const settle = async () => {
  for (let i = 0; i < 40; i++) await new Promise((r) => setImmediate(r));
};
const CODE = /[A-Z]{2,}_[A-Z_]+/;
type World = ReturnType<typeof authorityWorld>;
type Layout = Parameters<typeof page>[1];
const world = () => authorityWorld({ script: [], stores: true });

/** A file in the person's own store, written at `minute` minutes past the world's start so the newest is known. */
async function put(w: World, who: string, path: string, text: string, minute = 0) {
  w.clock.now = T0 + minute * 60_000;
  expect(await w.host(who).files.write({ path, text }, { requester: who, writer: `person:${who}` })).toMatchObject({ ok: true });
}
const listed = async (w: World, who: string) => ((await w.http(who, "GET", "/app/library")).body as { files: { files: Array<{ path: string; pinned: boolean }> } }).files.files;

async function pageFor(w: World, person: string, layout: Layout = {}) {
  const p = await page(
    {
      onSend() {},
      fetch: async (path, init) => {
        const r = await w.http(person, init?.method ?? "GET", path, init?.body ? JSON.parse(init.body) : undefined);
        return new Response(JSON.stringify(r.body), { status: r.status });
      },
    },
    layout,
  );
  await settle();
  const click = async (id: string) => {
    await p.byId(id).onclick?.();
    await settle();
  };
  const library = () => click("to-library");
  const paths = (id = "lib-list") => p.byId(id).children.map((c) => c.dataset.path);
  const item = (path: string, id = "lib-list") => p.byId(id).children.find((c) => c.dataset.path === path) as El;
  // A section is picked from the TitlePicker under 1024 px and from the list column from 1024.
  const pick = async (k: string) => {
    if (p.ui.device() !== "desktop") await click("lib-pick");
    await click(`lib-pick-${k}`);
  };
  const open = async (path: string, id = "lib-list") => {
    const it = item(path, id);
    await (it.children[0]?.onclick ? it.children[0] : it).onclick?.();
    await settle();
  };
  const kebab = async (path: string) => {
    await (item(path).children[1]?.onclick as ((e?: unknown) => unknown) | null)?.();
    await settle();
  };
  const menu = () => p.byId("menu").children.map((c) => c.id);
  return { ...p, click, library, paths, item, pick, open, kebab, menu };
}

/** Ada's library: one file of each kind the picker sorts, written a minute apart, the newest last. */
async function adasFiles(w: World) {
  await put(w, ada.email, "notes/plan.md", "# Q4 plan\n\nHire two.\n\n## Risks\nThe [launch](https://example.com) and `budget`.", 1);
  await put(w, ada.email, "reports/q4.pdf", "%PDF-1.4 fixture", 2);
  await put(w, ada.email, "pages/deck.html", "<h1>Deck</h1><script>parent.postMessage('owned','*')</script>", 3);
  await put(w, ada.email, "pictures/mark.svg", '<svg xmlns="http://www.w3.org/2000/svg"/>', 4);
  await put(w, ada.email, "data/export.json", '{"rows":2}', 5);
  w.clock.now = T0 + 6 * 60_000;
  const docx = await w.host(ada.email).files.writeBytes({ path: "documents/brief.docx", bytes: new Uint8Array([80, 75, 3, 4]), mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }, { requester: ada.email, writer: `person:${ada.email}` });
  expect(docx).toMatchObject({ ok: true });
}

describe("[M27.5] the title picker", () => {

  it("the kinds are a table of names, and a binary row the name does not place is placed by its type", () => {
    expect(Object.entries(LIB_SECTIONS).map(([k, s]) => [k, s.label, s.kinds])).toEqual([
      ["all", "All artifacts", ["document", "web"]],
      ["docs", "Documents", ["document"]],
      ["images", "Images", ["image"]],
      ["files", "System files", null],
    ]);
    expect([LIB_KINDS.md, LIB_KINDS.pdf, LIB_KINDS.docx, LIB_KINDS.html, LIB_KINDS.svg, LIB_KINDS.json]).toEqual(["document", "document", "document", "web", "image", undefined]);
    expect(LIBRARY_SCRIPT).toContain('(f.mediaType && /^image\\//.test(f.mediaType) ? "image" : "other")');
    // Web artifacts, Videos and Podcasts have no object here and are not drawn.
    expect(LIBRARY_MARKUP).not.toMatch(/Web artifacts|Videos|Podcasts/);
  });

  it("under 1024 px it is the TitlePicker's popover with the current section ticked, closed by the backdrop or Escape", async () => {
    const w = world();
    await adasFiles(w);
    const p = await pageFor(w, ada.email, { tablet: true });
    await p.library();
    expect([p.byId("lib-picks").parent?.id, p.byId("lib-pick-menu").hidden]).toEqual(["lib-pick-menu", true]);
    await p.click("lib-pick");
    expect([p.byId("lib-pick-menu").hidden, p.byId("lib-pick").attrs["aria-expanded"], p.byId("lib-backdrop").hidden]).toEqual([false, "true", false]);
    expect(p.byId("lib-picks").children.map((c) => [c.id, c.className])).toEqual([
      ["lib-group-artifacts", "qf-menu-group"],
      ["lib-pick-all", "qf-menu-item is-current"],
      ["lib-pick-docs", "qf-menu-item"],
      ["lib-group-media", "qf-menu-group"],
      ["lib-pick-images", "qf-menu-item"],
      ["lib-pick-sep", "qf-menu-sep"],
      ["lib-pick-files", "qf-menu-item"],
    ]);
    expect([p.byId("lib-pick-all").attrs["aria-checked"], p.byId("lib-pick-docs").attrs["aria-checked"]]).toEqual(["true", "false"]);
    await p.click("lib-backdrop");
    expect([p.byId("lib-pick-menu").hidden, p.byId("lib-pick").attrs["aria-expanded"]]).toEqual([true, "false"]);
    await p.click("lib-pick");
    p.key("Escape");
    expect(p.byId("lib-pick-menu").hidden).toBe(true);
    // A second press closes it too, and picking a section closes it on the new section.
    await p.click("lib-pick");
    await p.click("lib-pick");
    expect(p.byId("lib-pick-menu").hidden).toBe(true);
    await p.pick("docs");
    expect([p.byId("lib-pick-menu").hidden, p.byId("lib-pick-docs").className, p.byId("lib-pick-docs").attrs["aria-checked"]]).toEqual([true, "qf-menu-item is-current", "true"]);
  });

  it("from 1024 px the same nodes are the Library's list column, with the rail's Search at its head", async () => {
    const w = world();
    await adasFiles(w);
    const p = await pageFor(w, ada.email, { desktop: true });
    await p.library();
    expect(p.byId("lib-col").hidden).toBe(false);
    expect(p.byId("lib-sections").children.map((c) => c.id)).toEqual(["lib-search", "lib-picks"]);
    expect(p.byId("lib-picks").children.map((c) => c.className)).toEqual(["qf-listhead", "qf-listrow", "qf-listrow", "qf-listhead", "qf-listrow", "lib-spacer", "qf-listrow"]);
    expect([p.byId("lib-pick-all").attrs["aria-current"], p.byId("lib-pick-files").attrs["aria-current"]]).toEqual(["page", undefined]);
    await p.click("lib-pick-files");
    expect([p.byId("lib-pick-files").attrs["aria-current"], p.byId("lib-pick-all").attrs["aria-current"], p.byId("lib-title").textContent]).toEqual(["page", undefined, "System files"]);
    // The column's Search is the rail's: it opens Search.
    expect(p.byId("search").hidden).toBe(true);
    await p.click("lib-search");
    expect(p.byId("search").hidden).toBe(false);
    // Under 1024 px they go back to the picker, and the search pill home.
    p.resize({ tablet: true });
    await settle();
    expect([p.byId("lib-picks").parent?.id, p.byId("lib-search").parent?.id, p.byId("lib-pick-files").className]).toEqual(["lib-pick-menu", "lib-homes", "qf-menu-item is-current"]);
  });
});

describe("[M27.5] the grids", () => {
  it("Recent is the newest six as Cards, and All follows in the chosen sort only when the section holds more", async () => {
    const w = world();
    const names = ["fig", "apple", "kiwi", "date", "banana", "lime", "cherry", "grape"];
    for (const [i, n] of names.entries()) await put(w, ada.email, `notes/${n}.md`, `# ${n}`, i);
    const p = await pageFor(w, ada.email, { desktop: true });
    await p.library();
    const newest = [...names].reverse().map((n) => `notes/${n}.md`);
    expect(RECENT_SHOWN).toBe(6);
    expect([p.byId("lib-list").className, p.paths()]).toEqual(["qf-lgrid", newest.slice(0, 6)]);
    // A Card: the thumbnail on its kind's tone, the tile, the name and "<type> · <when>", and its kebab.
    const card = p.item("notes/grape.md");
    expect(card.className).toBe("cardwrap lib-k-document lib-x-md");
    expect(card.children.map((c) => c.className)).toEqual(["qf-lcard", "qf-ibtn qf-ibtn--glass cmore"]);
    expect(card.children[0]?.text()).toMatch(/^grape\.md Markdown · /);
    expect(card.children[1]?.attrs["aria-label"]).toBe("More options for grape.md");
    expect([p.byId("lib-all-h").hidden, p.paths("lib-all")]).toEqual([false, newest]);
    await p.click("lib-sort-name");
    expect(p.paths()).toEqual(newest.slice(0, 6));
    expect(p.paths("lib-all")).toEqual([...names].sort().map((n) => `notes/${n}.md`));
    // Six files or fewer: Recent alone, nothing drawn twice.
    const few = world();
    for (const [i, n] of names.slice(0, 3).entries()) await put(few, ada.email, `notes/${n}.md`, `# ${n}`, i);
    const q = await pageFor(few, ada.email);
    await q.library();
    expect([q.paths().length, q.byId("lib-all-h").hidden, q.byId("lib-all").hidden]).toEqual([3, true, true]);
  });

  it("the options sort by date or title and show a grid or a list, ticked; they and Create belong to the artifact sections", async () => {
    const w = world();
    await adasFiles(w);
    const p = await pageFor(w, ada.email);
    await p.library();
    await p.click("lib-options");
    expect([p.byId("lib-options-menu").hidden, p.byId("lib-options-menu").children.map((c) => c.id)]).toEqual([false, ["lib-sort-date", "lib-sort-name", "lib-view-grid", "lib-view-list"]]);
    expect(["lib-sort-date", "lib-sort-name", "lib-view-grid", "lib-view-list"].map((id) => p.byId(id).attrs["aria-checked"])).toEqual(["true", "false", "true", "false"]);
    await p.click("lib-view-list");
    expect([p.byId("lib-options-menu").hidden, p.byId("lib-list").className]).toEqual([true, "qf-files"]);
    // A list row: the name (which opens it) with its tile, the type, when, and the same kebab.
    const row = p.item("notes/plan.md");
    expect(row.className).toBe("qf-file lib-row lib-x-md");
    expect(row.children.map((c) => c.textContent)).toEqual(["", "Markdown", "Oct 13", ""]);
    expect(row.children[0]?.text()).toBe("notes/plan.md".split("/")[1]);
    expect(row.children[3]?.attrs["aria-label"]).toBe("More options for plan.md");
    expect(["lib-sort-date", "lib-sort-name", "lib-view-grid", "lib-view-list"].map((id) => p.byId(id).attrs["aria-checked"])).toEqual(["true", "false", "false", "true"]);
    await p.click("lib-view-grid");
    expect(p.byId("lib-list").className).toBe("qf-lgrid");
    for (const k of ["images", "files"]) {
      await p.pick(k);
      expect([k, p.byId("lib-options-wrap").hidden, p.byId("lib-create").hidden]).toEqual([k, true, true]);
    }
    await p.pick("all");
    expect([p.byId("lib-options-wrap").hidden, p.byId("lib-create").hidden]).toEqual([false, false]);
  });

  it("Create is the accent circle under 1024 px and the pill from 1024, and opens the chat with the line", async () => {
    const p = await pageFor(world(), ada.email);
    await p.library();
    expect([p.byId("lib-create").className, p.byId("lib-create-label").hidden]).toEqual(["qf-ibtn lib-create-circle", true]);
    p.resize({ desktop: true });
    await settle();
    expect([p.byId("lib-create").className, p.byId("lib-create-label").hidden]).toEqual(["qf-btn qf-btn--primary qf-btn--icon-start", false]);
    await p.click("lib-create");
    expect([p.byId("chat").hidden, p.byId("library").hidden, p.byId("t").value]).toEqual([false, true, LIBRARY_TEXT.createLine]);
  });

  it("a library that could not be read says so and is never drawn as empty", async () => {
    const w = world();
    const p = await page({ onSend() {}, fetch: async (path, init) => (path === "/app/library" ? new Response(JSON.stringify({ ok: true, files: { ok: false, code: "FILES_UNAVAILABLE" } })) : (async () => { const r = await w.http(ada.email, init?.method ?? "GET", path); return new Response(JSON.stringify(r.body), { status: r.status }); })()) });
    await settle();
    await p.byId("to-library").onclick?.();
    await settle();
    expect([p.byId("lib-note").textContent, p.byId("lib-note").dataset.code, p.byId("lib-empty").hidden]).toEqual(["Could not read your library just now. Reload the page to try again.", "FILES_UNAVAILABLE", true]);
  });
});

describe("[M27.5] the card menu", () => {
  it("Rename and Pin go through the shell's menu to Ada's own store, and a refusal is said in words with its code kept", async () => {
    const w = world();
    await adasFiles(w);
    const p = await pageFor(w, ada.email, { desktop: true });
    await p.library();
    await p.kebab("notes/plan.md");
    expect(p.menu()).toEqual(["lib-rename", "lib-rename-form", "lib-pin", "lib-menu-sep", "lib-delete", "lib-menu-note"]);
    expect([p.byId("menu").dataset.form, p.byId("lib-pin-label").textContent]).toEqual(["popover", "Pin"]);
    await p.click("lib-pin");
    expect(p.byId("menu").hidden).toBe(true);
    expect((await listed(w, ada.email)).find((f) => f.path === "notes/plan.md")?.pinned).toBe(true);
    expect(p.item("notes/plan.md").children[0]?.text()).toMatch(/· Pinned$/);
    await p.kebab("notes/plan.md");
    expect(p.byId("lib-pin-label").textContent).toBe("Unpin");
    // Rename to a name already taken is the store's refusal, said in the menu.
    await p.click("lib-rename");
    expect([p.byId("lib-rename-form").hidden, p.byId("lib-rename-to").value]).toEqual([false, "notes/plan.md"]);
    p.byId("lib-rename-to").value = "reports/q4.pdf";
    await p.byId("lib-rename-form").onsubmit?.({ preventDefault() {} });
    await settle();
    expect([p.byId("lib-menu-note").textContent, p.byId("lib-menu-note").dataset.code]).toEqual([LIBRARY_TEXT.refused.FILES_EXISTS, "FILES_EXISTS"]);
    expect(p.byId("lib-menu-note").textContent).not.toMatch(CODE);
    p.byId("lib-rename-to").value = "notes/plan-v2.md";
    await p.byId("lib-rename-form").onsubmit?.({ preventDefault() {} });
    await settle();
    expect((await listed(w, ada.email)).map((f) => f.path)).toContain("notes/plan-v2.md");
    expect(p.paths()).toContain("notes/plan-v2.md");
    // A phone gets the same items as the shell's action sheet.
    const ph = await pageFor(w, ada.email);
    await ph.library();
    await ph.kebab("reports/q4.pdf");
    expect([ph.byId("menu").dataset.form, ph.menu()[0]]).toEqual(["sheet", "lib-rename"]);
  });

  it("Delete asks on the ConfirmDialog first, deletes once on Delete and never on Cancel", async () => {
    const w = world();
    await adasFiles(w);
    const p = await pageFor(w, ada.email, { desktop: true });
    await p.library();
    await p.kebab("reports/q4.pdf");
    await p.click("lib-delete");
    expect([p.byId("menu").hidden, p.byId("confirm").parent?.id, p.byId("confirm-title").textContent, p.byId("confirm-ok").textContent, p.byId("confirm-ok").className]).toEqual([true, "scrim", LIBRARY_TEXT.deleteTitle, "Delete", "qf-btn qf-btn--destructive"]);
    await p.click("confirm-cancel");
    expect((await listed(w, ada.email)).map((f) => f.path)).toContain("reports/q4.pdf");
    await p.kebab("reports/q4.pdf");
    await p.click("lib-delete");
    await p.click("confirm-ok");
    expect((await listed(w, ada.email)).map((f) => f.path)).not.toContain("reports/q4.pdf");
    expect(p.paths()).not.toContain("reports/q4.pdf");
    // A file gone by the time the person confirms is the store's refusal, said on the page.
    await p.kebab("notes/plan.md");
    await p.click("lib-delete");
    await w.host(ada.email).files.remove({ path: "notes/plan.md" }, ada.email);
    await p.click("confirm-ok");
    expect([p.byId("lib-note").textContent, p.byId("lib-note").dataset.code]).toEqual([LIBRARY_TEXT.refused.FILES_NOT_FOUND, "FILES_NOT_FOUND"]);
    expect((await listed(w, ada.email)).map((f) => f.path)).toContain("pages/deck.html");
  });
});

describe("[M27.5] the artifact viewer", () => {
  it("is the full-height viewer headed by the title, More options and Close, and Close returns to the list", async () => {
    const w = world();
    await adasFiles(w);
    const p = await pageFor(w, ada.email);
    await p.library();
    await p.open("pages/deck.html");
    expect([p.byId("viewer").hidden, p.byId("lib-list-view").hidden, p.byId("viewer-title").textContent]).toEqual([false, true, "deck.html"]);
    expect(LIBRARY_MARKUP).toContain('<div id="viewer" class="qf-doc" hidden>');
    expect(LIBRARY_MARKUP).toMatch(/<div class="l"><b id="viewer-title"><\/b><\/div>[\s\S]*<div class="r"><button id="viewer-more" class="qf-ibtn" aria-label="More options"[^>]*>.*<\/button><button id="viewer-back" class="qf-ibtn" aria-label="Close">/);
    expect([p.byId("doc-tools").hidden, "data-doc" in p.byId("viewer").attrs]).toEqual([true, false]);
    await p.click("viewer-back");
    expect([p.byId("viewer").hidden, p.byId("lib-list-view").hidden, p.byId("viewer-body").children.length]).toEqual([true, false, 0]);
  });

  it("shows each kind as the browser should: HTML in a frame with no permission, a PDF as a link, a picture, text as text", async () => {
    const w = world();
    await adasFiles(w);
    const p = await pageFor(w, ada.email);
    await p.library();
    await p.open("pages/deck.html");
    const fr = p.byId("viewer-body").children[0] as El & { srcdoc?: string };
    // The plant: the page's script would post to its parent; the empty sandbox turns every permission off.
    expect([fr.tag, fr.attrs.sandbox, fr.attrs.referrerpolicy, fr.srcdoc]).toEqual(["iframe", "", "no-referrer", "<h1>Deck</h1><script>parent.postMessage('owned','*')</script>"]);
    await p.click("viewer-back");
    await p.open("reports/q4.pdf");
    const a = p.byId("viewer-body").children[0] as El & { href?: string };
    expect([a.tag, a.textContent, a.attrs.rel]).toEqual(["a", LIBRARY_TEXT.pdfOpen, "noopener noreferrer"]);
    expect(String(a.href)).toMatch(/\/app\/file\/raw\?.*sig=/);
    await p.click("viewer-back");
    await p.pick("images");
    await p.open("pictures/mark.svg");
    const img = p.byId("viewer-body").children[0] as El & { src?: string; alt?: string };
    expect([img.tag, img.alt]).toEqual(["img", "mark.svg"]);
    expect(String(img.src)).toMatch(/\/app\/file\/raw\?.*sig=/);
    await p.click("viewer-back");
    await p.pick("files");
    await p.open("data/export.json", "lib-files");
    expect(p.byId("viewer-body").children.map((c) => [c.tag, c.className, c.textContent])).toEqual([["pre", "lib-pre", '{"rows":2}']]);
    await p.click("viewer-back");
    // A binary document has no preview: the store says so and the page says it in words.
    await p.open("documents/brief.docx", "lib-files");
    expect([p.byId("viewer-note").textContent, p.byId("viewer-note").dataset.code, p.byId("viewer-body").children.length]).toEqual([LIBRARY_TEXT.refused.FILES_BINARY, "FILES_BINARY", 0]);
  });
});

describe("[M27.5] the document viewer", () => {
  it("a Markdown file opens read-only: the toolbar drawn with every button disabled, the article not editable, a link only to http", async () => {
    const w = world();
    await adasFiles(w);
    await put(w, ada.email, "notes/hostile.md", "[open](javascript:alert(1)) and [site](https://example.com)", 8);
    const p = await pageFor(w, ada.email, { desktop: true });
    await p.library();
    await p.open("notes/plan.md");
    expect([p.byId("doc-tools").hidden, "data-doc" in p.byId("viewer").attrs, p.byId("viewer-body").className]).toEqual([false, true, "qf-doc-body"]);
    const tools = LIBRARY_MARKUP.slice(LIBRARY_MARKUP.indexOf('id="doc-tools"'), LIBRARY_MARKUP.indexOf("</div>", LIBRARY_MARKUP.indexOf('id="doc-tools"')));
    expect(tools.match(/<button /g)).toHaveLength(7);
    expect(tools.match(/<button [^>]*disabled>/g)).toHaveLength(7);
    const article = p.byId("viewer-body").children[0] as El;
    expect([article.tag, "contenteditable" in article.attrs, article.children.map((c) => c.tag)]).toEqual(["article", false, ["h1", "p", "h2", "p"]]);
    expect(LIBRARY_SCRIPT).not.toMatch(/contenteditable|innerHTML/);
    await p.click("viewer-back");
    await p.open("notes/hostile.md");
    const para = (p.byId("viewer-body").children[0] as El).children[0] as El;
    expect(para.children.map((c) => [c.tag, c.textContent])).toEqual([["span", "open"], ["span", ") and "], ["a", "site"]]);
  });

  it("View source is the first of More options and shows the file as written beside its line numbers, headings marked, and back", async () => {
    const w = world();
    await adasFiles(w);
    const p = await pageFor(w, ada.email);
    await p.library();
    await p.open("notes/plan.md");
    await p.click("viewer-more");
    expect(p.menu()).toEqual(["doc-source", "doc-sep", "viewer-share", "viewer-pin", "viewer-copy", "viewer-download", "viewer-sep", "viewer-delete"]);
    expect(p.byId("doc-source").attrs["aria-checked"]).toBe("false");
    await p.click("doc-source");
    const body = p.byId("viewer-body");
    expect([p.byId("menu").hidden, p.byId("doc-source").attrs["aria-checked"], body.className, body.children.map((c) => [c.tag, c.className])]).toEqual([true, "true", "lib-src", [["pre", "qf-src"], ["pre", "qf-src"]]]);
    const raw = "# Q4 plan\n\nHire two.\n\n## Risks\nThe [launch](https://example.com) and `budget`.";
    expect(body.children[0]?.textContent).toBe("1\n2\n3\n4\n5\n6");
    const src = body.children[1] as El;
    expect(src.children.map((c) => c.textContent).join("")).toBe(raw);
    expect(src.children.filter((c) => c.className === "h").map((c) => c.textContent.trim())).toEqual(["# Q4 plan", "## Risks"]);
    await p.click("viewer-more");
    await p.click("doc-source");
    expect([body.className, body.children[0]?.tag]).toEqual(["qf-doc-body", "article"]);
    // A file that is not Markdown has no View source.
    await p.click("viewer-back");
    await p.open("pages/deck.html");
    await p.click("viewer-more");
    expect(p.menu()).not.toContain("doc-source");
  });
});

describe("[M27.5] the ids and the gate", () => {
  it("the segment's ids are gone and the part's are drawn once, on the system's classes", () => {
    for (const gone of ["lib-artifacts", "lib-media", "lib-menu", "lib-delete-ask", "lib-viewer", "viewer-menu"]) expect(APP_PAGE, gone).not.toContain(`id="${gone}"`);
    for (const id of ["viewer", "viewer-more", "viewer-back", "lib-list", "lib-create", "lib-rename", "lib-pin", "lib-delete", "lib-title", "lib-pick", "lib-pick-all", "lib-pick-docs", "lib-pick-images", "lib-pick-files", "lib-options", "lib-files", "doc-source"])
      expect(APP_PAGE.match(new RegExp(`id="${id}"`, "g")), id).toHaveLength(1);
    expect(`${LIBRARY_MARKUP}${LIBRARY_SCRIPT}${LIBRARY_CSS}`).not.toMatch(/lib-say|wide-only/);
    // The shell's header is not drawn on the Library, which heads itself.
    expect(LIBRARY_CSS).toContain('#app[data-view="library"] #head { display: none; }');
  });
});
