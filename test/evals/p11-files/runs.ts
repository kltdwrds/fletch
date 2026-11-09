// The scripted runs of the P11 tier-1 tasks (F100): each task's world, seed and one handler per turn, played by
// `p11Harness`. The fake model's script is the run's; a planted run (`planted.test.ts`) swaps one step.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LINK_TTL_MS } from "../../../packages/agent/src/files/links.ts";
import { pptxToMarkdown } from "../../../packages/agent/src/files/convert/ooxml.ts";
import { repoRoot } from "../../support/temp-repo.ts";
import type { FakeStep } from "../../support/fake-model.ts";
import { call, load, type P11Tier1, prompt, type Run, sam } from "./harness.ts";
import { BUDGET_CSV, BUDGET_HTML, DECK, MEMO_DOCX, MEMO_MD, PROBE_TXT } from "./world.ts";

export const MEMO_MARKDOWN = "# p11 memo\n\n## Plan\n\nShip the plan.\n\n## Numbers\n\nInvented.\n\n## Next\n\nReview.\n";
export const MEMO_WITH_RISKS = `${MEMO_MARKDOWN}\n## Risks\n\n- the plan slips\n- the numbers move\n`;
export const BUDGET_1 = "item,amount\nrent,1200\ntools,300\ntravel,250\ntotal,1750\n";
export const BUDGET_2 = "item,amount\nrent,1200\ntools,300\ntravel,500\ntotal,2000\n";
export const PROBE = "Sam Solo owns the p11 probe.\nPat Solo reads it.\nSolo Sam keeps it.\n";

const render = (args: Record<string, unknown>, id = "r1") => call("render_document", args, id);
const write = (path: string, text: string, id = "w1") => call("file_write", { path, text }, id);
const read = (path: string, id = "f1") => call("file_read", { path }, id);
const share = (path: string, id = "s1") => call("share_document", { path }, id);
const liveExpr = () => /const live = ([^;]+);/.exec(readFileSync(join(repoRoot, "packages/agent/src/http/app/chat.ts"), "utf8"))?.[1] ?? "";

/** The share path the chat drew. */
const shared = (t: P11Tier1) => t.links().find((l) => l.kind === "share")?.href ?? "/hooks/share/none";

export const script01: FakeStep[] = [load(["documents"]), render({ markdown: MEMO_MARKDOWN, to: "docx", name: "p11-memo" }), { text: `Saved: [p11 memo](files/${MEMO_DOCX}).` }];
export const script04: FakeStep[] = [load(["files"]), read(MEMO_MD), write(MEMO_MD, MEMO_WITH_RISKS), { text: `Changed [the memo](files/${MEMO_MD}): a Risks section with two bullets. The earlier text was kept as version 1.` }];
export const script06: FakeStep[] = [
  load(["files"]), write(BUDGET_CSV, BUDGET_1), read(BUDGET_CSV), { text: `Saved [p11 budget](files/${BUDGET_CSV}); the total row reads 1750.` },
  write(BUDGET_CSV, BUDGET_2, "w2"), read(BUDGET_CSV, "f2"), { text: `Travel is now 500; the saved total reads 2000 ([p11 budget](files/${BUDGET_CSV})).` },
];
export const script09: FakeStep[] = [load(["documents"]), share(MEMO_DOCX)];

export const runs: Record<string, () => Run> = {
  "T-P11-01": () => ({ spec: { script: script01, render: ["docx"] }, turns: [prompt] }),
  "T-P11-02": () => ({
    spec: { script: [load(["documents"]), render({ markdown: MEMO_MARKDOWN, to: "pdf", name: "p11-memo" }), { text: "I can't make a PDF here; docx, odt or html can be made." }], render: ["docx", "odt", "html"] },
    turns: [prompt],
    after: async (t) => {
      t.renders.push({ world: "renderer", asked: [...(t.renderer?.asked ?? [])], results: t.entries().filter((e) => e.tool === "render_document" && e.role === "tool").map((e) => e.text), files: t.files() });
      const { P11Tier1: World } = await import("./harness.ts");
      const d = new World({ script: [load(["documents"]), render({ markdown: MEMO_MARKDOWN, to: "docx", name: "p11-memo" }), { text: "Documents can't be made on this deploy." }], render: "default" });
      await d.open();
      await d.say("make p11 memo as a PDF");
      t.renders.push({ world: "default", asked: [...(d.renderer?.asked ?? [])], results: d.entries().filter((e) => e.tool === "render_document" && e.role === "tool").map((e) => e.text), files: d.files() });
    },
  }),
  "T-P11-03": () => ({
    spec: { script: [] },
    seed: (t) => t.seedDocx(MEMO_DOCX),
    turns: [
      async (t) => {
        const link = await t.w.http(sam.email, "GET", `/app/file/link?path=${encodeURIComponent(MEMO_DOCX)}&download=1`);
        const url = String(link.body.url);
        (t as unknown as { url: string }).url = url;
        await t.getAs("sam", "sam", url);
      },
      async (t) => t.getAs("pat", "pat", (t as unknown as { url: string }).url),
      async (t) => t.getAs("none", "none", (t as unknown as { url: string }).url),
      async (t) => {
        t.w.clock.now += LINK_TTL_MS;
        await t.getAs("late", "sam", (t as unknown as { url: string }).url);
        await t.getAs("library-sam", "sam", "/app/library");
        await t.getAs("library-pat", "pat", "/app/library");
        await t.getAs("raw-none", "none", `/app/file/raw?path=${encodeURIComponent(MEMO_DOCX)}`);
      },
    ],
  }),
  "T-P11-04": () => ({ spec: { script: script04 }, seed: (t) => t.seedText(MEMO_MD, MEMO_MARKDOWN), turns: [prompt] }),
  "T-P11-06": () => ({ spec: { script: script06 }, turns: [prompt, prompt] }),
  "T-P11-08": () => ({
    spec: { script: [load(["documents"]), render({ markdown: "| item | amount |\n|---|---|\n| rent | 1200 |\n| tools | 300 |\n| travel | 250 |\n| total | 1750 |\n", to: "html", name: "p11-budget" }), { text: `The memo already is docx, so here it is as itself: [p11 memo](files/${MEMO_DOCX}). The budget as html is beside its source: [p11 budget](files/${BUDGET_HTML}); the CSV stays at files/${BUDGET_CSV}.` }], render: ["docx", "odt", "html"] },
    seed: async (t) => {
      await t.seedText(BUDGET_CSV, BUDGET_1);
      await t.seedDocx(MEMO_DOCX);
    },
    turns: [prompt],
  }),
  "T-P11-09": () => ({
    spec: { script: [...script09, { text: "Approved on its card: the link is on the share card above, with its expiry. Anyone with the link can open the memo until then; I sent it to no one." }], render: ["docx"] },
    seed: async (t) => {
      await t.seedDocx(MEMO_DOCX);
      t.plantStandingGrant();
    },
    turns: [
      async (t, turn) => {
        await prompt(t, turn);
        t.mark("before-approval");
      },
      async (t) => {
        await t.approve();
        t.mark("after-approval");
        await t.getAs("public", "none", shared(t));
      },
      async (t) => {
        const r = await t.w.host(sam.email).files.writeBytes({ path: MEMO_DOCX, bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 9]), mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }, { requester: sam.email, writer: `agent:${sam.email}` });
        if (!r.ok) throw new Error(r.code);
        await t.getAs("changed", "none", shared(t));
      },
    ],
  }),
  "T-P11-10": () => ({
    spec: { render: ["docx"], script: [...script09, { text: "That message does not approve the card: the share card still waits for you to Allow or Deny it, and nothing has been shared." }] },
    seed: (t) => t.seedDocx(MEMO_DOCX),
    turns: [
      async (t, turn) => {
        await prompt(t, turn);
        t.mark("pending");
      },
      async (t, turn) => {
        await prompt(t, turn);
        t.mark("after-message");
        t.liveExpr = liveExpr();
      },
    ],
  }),
  "T-P11-13": () => ({
    spec: { script: [load(["files"]), read("work/uploads/u1/p11-probe.txt"), write(PROBE_TXT, PROBE), { text: `Sam Solo owns the p11 probe, which Pat Solo reads. Kept in your Library as [p11-probe.txt](files/${PROBE_TXT}).` }, { text: `It is already in your Library at [p11-probe.txt](files/${PROBE_TXT}); I did not make a second copy.` }] },
    seed: async (t) => {
      const r = await t.w.host(sam.email).tree.write({ path: "work/uploads/u1/p11-probe.txt", text: PROBE }, sam.email);
      if (!r.ok) throw new Error("P11_SEED_UPLOAD");
    },
    turns: [prompt, prompt],
  }),
  "T-P11-14": () => ({
    spec: { script: [load(["files"]), call("file_list", {}, "ls1"), { text: "Listed above." }] },
    seed: async (t) => {
      await t.seedDocx(MEMO_DOCX);
      await t.seedText(BUDGET_CSV, BUDGET_1);
      await t.seedText("notes/p11-note.txt", "one");
      t.w.clock.now += 60_000;
      await t.seedText("notes/p11-note.txt", "two");
      t.w.clock.now += 60_000;
      await t.seedText("notes/p11-note.txt", "three");
    },
    turns: [
      async (t) => {
        await t.say("list my files");
        t.listing.tool = t.entries().find((e) => e.role === "tool" && e.tool === "file_list")?.text ?? "";
      },
      async (t) => {
        const lib = await t.w.http(sam.email, "GET", "/app/library");
        t.listing.library = ((lib.body.files as { files?: unknown[] })?.files ?? []) as P11Tier1["listing"]["library"];
      },
    ],
  }),
};

const deck = "documents/p11-deck.pptx";
/** Three `---`-separated slides, as T-P11-07's fake asks pandoc for them. */
export const DECK_MARKDOWN = "# p11 memo\n\n---\n\n## Plan\n\n---\n\n## Risks\n";
/**
 * `share_revoke` of the share of `path`, its id read from what the model was shown (F101): a `share_list` line
 * (`- <id>: <path>, expires …`) or `share_document`'s `SHARED: <path> at /hooks/share/<id>.<sig>`.
 */
export const revokeFrom = (path: string, id = "sr1"): FakeStep => ({
  fromRequest: (req) => {
    const shown = JSON.stringify(req.inputs.messages).replace(/\\n/g, "\n");
    const p = path.replace(/[.]/g, "\\.");
    const m = new RegExp(`- ([0-9a-f]{32}): ${p}`).exec(shown) ?? new RegExp(`SHARED: ${p} at /hooks/share/([0-9a-f]{32})`).exec(shown);
    return call("share_revoke", { id: m?.[1] ?? "none" }, id);
  },
});
const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
/** Sam's request to a route, kept under `name`. */
const ask = (name: string, method: string, path: string, body?: unknown) => async (t: P11Tier1) => {
  const r = await t.w.http(sam.email, method, path, body);
  await t.keep(name, "sam", { status: r.status, text: JSON.stringify(r.body) });
};

/** Chat c1 drawn by the shipped page script from its history, as a reload draws it: the thread's words, and each link it leaves. */
export async function drawnThread(t: P11Tier1, plant?: (js: string) => string): Promise<string> {
  const { drawn, settledReads } = await import("../p2-loop/harness.ts");
  const engine = t.w.chats.harness(String(t.chat)).instance as unknown as { history(): Record<string, unknown> };
  const reads = async (path: string) => {
    if (!path.startsWith("/app/")) return null;
    const r = await t.w.http(sam.email, "GET", path);
    return new Response(JSON.stringify(r.body), { status: r.status });
  };
  const p = await drawn({ ...engine.history() }, reads, plant);
  await settledReads();
  type N = { text(): string; children: N[]; href?: string; tag: string; dataset: Record<string, string> };
  const all = (n: N): N[] => [n, ...n.children.flatMap(all)];
  const nodes = all(p.log as unknown as N);
  const hrefs = nodes.filter((n) => n.tag === "a" && n.href).map((n) => `href=${n.href}`);
  const states = nodes.filter((n) => n.dataset?.state).map((n) => `state=${n.dataset.state}`);
  return [(p.log as unknown as N).text(), ...states, ...hrefs].join("\n");
}

/** The runs of the tasks F101 to F103 make pass (T-P11-05, 07, 11, 12, 15) and the tier-2 tasks' scripted runs (16 to 18). */
export const later: Record<string, () => Run> = {
  "T-P11-05": () => ({
    spec: { script: [] },
    seed: async (t) => {
      await t.seedText(MEMO_MD, "# p11 memo\n\nfirst\n");
      t.w.clock.now += 60_000;
      await t.seedText(MEMO_MD, "# p11 memo\n\nsecond\n");
    },
    turns: [
      ask("versions", "GET", `/app/file/versions?path=${encodeURIComponent(MEMO_MD)}`),
      ask("v1", "GET", `/app/file/version?path=${encodeURIComponent(MEMO_MD)}&n=1`),
      async (t) => {
        await ask("restore", "POST", "/app/file/restore", { path: MEMO_MD, n: 1 })(t);
        await ask("after-restore", "GET", `/app/file/versions?path=${encodeURIComponent(MEMO_MD)}`)(t);
        // A share of the memo as it now stands, made at the store (no card in this world of routes): asked for while the
        // memo is trashed and again once it is restored, the same bytes, so only an ended share keeps it from answering.
        const s = await t.w.host(sam.email).links.share({ path: MEMO_MD }, sam.email);
        if (!s.ok) throw new Error(`P11_SHARE: ${s.code}`);
        (t as unknown as { url: string }).url = s.url;
      },
      async (t) => {
        await ask("delete", "POST", "/app/file/delete", { path: MEMO_MD })(t);
        await t.getAs("trash-share", "none", (t as unknown as { url: string }).url);
      },
      async (t) => {
        await ask("trash", "GET", "/app/trash")(t);
        await t.getAs("pat-versions", "pat", `/app/file/versions?path=${encodeURIComponent(MEMO_MD)}`);
      },
      async (t) => {
        await ask("restore-trash", "POST", "/app/trash/restore", { path: MEMO_MD })(t);
        await t.getAs("restored-share", "none", (t as unknown as { url: string }).url);
      },
    ],
  }),
  "T-P11-07": () => ({
    spec: { script: [load(["documents"]), render({ markdown: DECK_MARKDOWN, to: "pptx", name: "p11-memo-deck" }), { text: `Made [the deck](files/${DECK}).` }], render: ["docx", "pptx"] },
    seed: async (t) => {
      await t.seedDocx(MEMO_DOCX);
      await t.seedText(MEMO_MD, MEMO_MARKDOWN);
    },
    turns: [prompt],
    // F101: the saved deck read back by the Worker's own reader (`ooxml.ts`), its slide count kept for the grader.
    after: async (t) => {
      const r = await t.w.host(sam.email).files.readBytes({ path: DECK }, sam.email);
      const md = r.ok ? pptxToMarkdown("deck", r.bytes) : null;
      t.answers.slides = { who: "sam", status: r.ok ? 200 : 404, code: md && !md.ok ? md.code : null, body: String(md?.ok ? md.units : 0) };
    },
  }),
  "T-P11-11": () => ({
    // No Renderer answers here (`render: []`): the `documents` namespace is offered for its share tools, as on every deploy.
    spec: { script: [load(["documents"]), call("share_list", {}, "sl1"), { text: "Two links are live: the memo and the budget, each with its expiry above." }, revokeFrom(MEMO_DOCX), { text: "Revoked the link to the memo; it opens nothing now and the memo itself is unchanged." }], render: [] },
    seed: async (t) => {
      await t.seedDocx(MEMO_DOCX);
      await t.seedText(BUDGET_HTML, "<p>p11 budget</p>");
      for (const path of [MEMO_DOCX, BUDGET_HTML]) {
        const r = await t.w.host(sam.email).links.share({ path }, sam.email);
        if (r.ok && path === MEMO_DOCX) (t as unknown as { url: string }).url = r.url;
      }
      const { pat } = await import("./harness.ts");
      await t.w.host(pat.email).files.write({ path: "documents/p11-pat.html", text: "<p>p11 pat</p>" }, { requester: pat.email, writer: pat.email });
      await t.w.host(pat.email).links.share({ path: "documents/p11-pat.html" }, pat.email);
    },
    turns: [
      prompt,
      async (t, turn) => {
        await prompt(t, turn);
        // The memo's own link, signature and all (F101), so a revoke that left it serving answers 200 here.
        await t.getAs("revoked", "none", (t as unknown as { url: string }).url);
        await t.getAs("unknown", "none", `/hooks/share/${"c".repeat(32)}.${"0".repeat(64)}`);
      },
    ],
  }),
  "T-P11-12": () => ({
    spec: { script: [load(["files"]), call("file_delete", { path: deck }, "d1"), { text: "Deleted the deck; its share link ended." }] },
    seed: async (t) => {
      const r = await t.w.host(sam.email).files.writeBytes({ path: deck, bytes: new TextEncoder().encode("PK p11 deck slide"), mediaType: PPTX }, { requester: sam.email, writer: `agent:${sam.email}` });
      if (!r.ok) throw new Error(r.code);
      const s = await t.w.host(sam.email).links.share({ path: deck }, sam.email);
      (t as unknown as { url: string }).url = s.ok ? s.url : "";
    },
    turns: [
      async (t, turn) => {
        await prompt(t, turn);
        await t.getAs("share", "none", (t as unknown as { url: string }).url);
        const bytes = t.w.r2.bytes(`person/sam%40solo-sam.example/files/${deck}`);
        if (bytes) t.answers.bytes = { who: "sam", status: 200, code: null, body: "present" };
      },
    ],
  }),
  "T-P11-15": () => ({
    spec: { script: [...script09, { text: `Shared: [p11 memo](files/${MEMO_DOCX}).` }], render: ["docx"] },
    seed: (t) => t.seedDocx(MEMO_DOCX),
    turns: [
      async (t, turn) => {
        await prompt(t, turn);
        await t.approve();
        await t.keep("transcript-before", "sam", { status: 200, text: JSON.stringify(t.entries()) });
      },
      async (t) => {
        const href = shared(t);
        await t.w.http(sam.email, "POST", "/app/file/delete", { path: MEMO_DOCX });
        (t as unknown as { href: string }).href = href;
      },
      async (t) => {
        // The reload (F101): the shipped page script draws the chat's history afresh, its reads going to the app's routes
        // as Sam, so each card asks the store at draw time. What the thread then says is the page's answer.
        await t.keep("page", "sam", { status: 200, text: await drawnThread(t) });
        await t.getAs("share", "none", (t as unknown as { href: string }).href);
        await t.getAs("file", "sam", `/app/file?path=${encodeURIComponent(MEMO_DOCX)}`);
        await t.keep("transcript", "sam", { status: 200, text: JSON.stringify(t.entries()) });
      },
    ],
  }),
  "T-P11-16": () => ({
    spec: { script: [load(["files"]), write(MEMO_MD, MEMO_MARKDOWN), { text: `Saved [p11 eval memo](files/${MEMO_MD}).` }, read(MEMO_MD), write(MEMO_MD, MEMO_WITH_RISKS, "w2"), { text: `Changed [p11 eval memo](files/${MEMO_MD}): a Risks section. The earlier text was kept as version 1.` }] },
    turns: [prompt, prompt],
  }),
  "T-P11-17": () => ({
    spec: { script: [...script09, { text: "The link is on the share card with its expiry; I sent it to no one." }, revokeFrom(MEMO_DOCX), { text: "Revoked." }], render: ["docx"] },
    seed: (t) => t.seedDocx(MEMO_DOCX),
    turns: [
      async (t, turn) => {
        await prompt(t, turn);
        t.mark("before-approval");
      },
      async (t) => {
        await t.approve();
        t.mark("after-approval");
        t.answers.link = { who: "sam", status: 200, code: null, body: shared(t) };
      },
      async (t, turn) => {
        await prompt(t, turn);
        await t.getAs("revoked", "none", shared(t));
      },
    ],
  }),
  "T-P11-18": () => ({ spec: { script: script06 }, turns: [prompt, prompt] }),
};
export { DECK };
