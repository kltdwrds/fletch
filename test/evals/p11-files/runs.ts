// The scripted runs of the P11 tier-1 tasks (F100): each task's world, seed and one handler per turn, played by
// `p11Harness`. The fake model's script is the run's; a planted run (`planted.test.ts`) swaps one step.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LINK_TTL_MS } from "../../../packages/agent/src/files/links.ts";
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
export const script04: FakeStep[] = [load(["files"]), read(MEMO_MD), write(MEMO_MD, MEMO_WITH_RISKS), { text: `Changed [the memo](files/${MEMO_MD}): a Risks section with two bullets. The earlier version was replaced and not kept.` }];
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
export { DECK };
