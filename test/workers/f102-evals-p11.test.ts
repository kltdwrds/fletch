// F102: the P11 tier-2 tasks on a preview slot, and the reply's words that they measure. The runner drives T-P11-16,
// T-P11-17 and T-P11-18 (Sam's prompts and, for P11 alone, `approve`: the pending card allowed once through the page's
// route); before each trial Sam's Library is emptied through `/app/file/delete` and T-P11-17's memo is seeded by the
// test host's `p11` op (`scripts/preview-slot/test-host-p11.mjs`), which also reads chat c1's messages as the P11 world's
// entries; the readers (`scripts/evals/p11-slot.ts`) answer a P11 grader as the tier-1 world does. Hermetic: the readers
// run over Sam's real chat, Person and routes in the P11 tier-1 world, played by the scripted fake model, the op's rows
// read from the chat's own SQLite by the op's code. `FILE_WORDS` (`packages/agent/src/chat/instructions.ts`) is in the
// chat's task block with each claim of scope 1 in it, and every P11 hash in the contract matches its file (scope 3).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CHAT_TASK, FILE_WORDS } from "../../packages/agent/src/chat/instructions.ts";
import { pptxToMarkdown } from "../../packages/agent/src/files/convert/ooxml.ts";
import { APPROVE_CHOICE, memoDocx, P11_SLOT_MEMO, type P11SlotDeps, p11Slot } from "../../scripts/evals/p11-slot.ts";
import { CLUSTER_EVENTS, driveable, type Slot, trial } from "../../scripts/evals/runner.ts";
import { P11_SEED_MAX, p11Entries, p11Seed } from "../../scripts/preview-slot/test-host-p11.mjs";
import { call, load, P11Tier1, sam } from "../evals/p11-files/harness.ts";
import memoEdit from "../evals/p11-files/memo-and-edit.task.ts";
import { MEMO_MARKDOWN, MEMO_WITH_RISKS, revokeFrom } from "../evals/p11-files/runs.ts";
import shareRevoke from "../evals/p11-files/share-and-revoke.task.ts";
import sheetLive from "../evals/p11-files/sheet-total-live.task.ts";
import { MEMO_DOCX, type P11World } from "../evals/p11-files/world.ts";
import { EMPTY_SNAPSHOT, type SlotEntry, type SlotWorld } from "../support/evals.ts";
import type { FakeStep } from "../support/fake-model.ts";
import type { DefinedTask } from "../support/task.ts";
import { staleHashes } from "../support/task-hashes.ts";
import { repoRoot } from "../support/temp-repo.ts";

const MEMO = "documents/p11-eval-memo.md";
const SHEET = "sheets/p11-eval-budget.csv";
const write = (path: string, text: string, id: string) => call("file_write", { path, text }, id);
const read = (path: string, id: string) => call("file_read", { path }, id);
const B1 = "item,amount\nrent,1200\ntools,300\ntravel,250\ntotal,1750\n";
const B2 = "item,amount\nrent,1200\ntools,300\ntravel,500\ntotal,2000\n";

/** The scripted model's turns per task, as the real model is asked to answer them on the slot. */
const SCRIPTS: Record<string, FakeStep[]> = {
  "T-P11-16": [load(["files"]), write(MEMO, MEMO_MARKDOWN, "w1"), { text: `Saved [p11 eval memo](files/${MEMO}).` }, read(MEMO, "f1"), write(MEMO, MEMO_WITH_RISKS, "w2"), { text: `Added a Risks section to [p11 eval memo](files/${MEMO}); the earlier version was replaced and its earlier content was kept as version 1.` }],
  "T-P11-17": [load(["documents"]), call("share_document", { path: P11_SLOT_MEMO }, "s1"), { text: "The link is on the share card with its expiry; I sent it to no one." }, call("share_list", {}, "sl1"), revokeFrom(P11_SLOT_MEMO), { text: "Revoked the link to the memo; it opens nothing now and the memo itself is unchanged." }],
  "T-P11-18": [load(["files"]), write(SHEET, B1, "w1"), read(SHEET, "f1"), { text: `Saved [p11 eval budget](files/${SHEET}); the total row reads 1750.` }, write(SHEET, B2, "w2"), read(SHEET, "f2"), { text: `Travel is now 500; the saved total reads 2000 ([p11 eval budget](files/${SHEET})).` }],
};

type Sql = Parameters<typeof p11Entries>[0];
const chatSql = (t: P11Tier1): Sql => {
  const h = t.w.chats.harness(t.chat as string);
  return { exec: (q: string, ...b: unknown[]) => ({ toArray: () => h.rows(q, ...(b as never[])) }) };
};

/** The P11 readers' deps over a tier-1 world, as `scripts/evals/slot.ts` gives them on a slot; `plant` alters one. */
function depsOver(t: P11Tier1, plant: Partial<P11SlotDeps> = {}): P11SlotDeps {
  const history = () => (t.chat ? (t.w.chats.harness(t.chat).instance.history().entries as unknown as SlotEntry[]) : []);
  return {
    read: async (path) => t.w.http(sam.email, "GET", path),
    post: async (path, body) => t.w.http(sam.email, "POST", path, body),
    publicGet: async (path) => {
      const r = await t.publicGet(path);
      return { status: r.status, text: await r.text() };
    },
    history,
    op: async (callName, args = {}) => {
      if (callName === "entries") return { entries: t.chat ? p11Entries(chatSql(t)) : [] };
      const seed = p11Seed(args.seed);
      if (!seed.ok) return seed;
      const r = await t.w.host(sam.email).files.writeBytes({ path: seed.path, bytes: seed.bytes, mediaType: seed.mediaType }, { requester: sam.email, writer: sam.email });
      return r.ok ? { ok: true, path: seed.path } : { ok: false, code: r.code };
    },
    decide: async (cardId, choice) => {
      await t.w.http(sam.email, "POST", `/chats/${t.chat}/cards/decide`, { ids: [cardId], choice });
    },
    ...plant,
  };
}

/** A slot whose every trial is a fresh tier-1 world behind the P11 readers; `stray` is what an earlier trial left. */
function slotOver(opts: { script?: FakeStep[]; stray?: boolean; plant?: (t: P11Tier1) => Partial<P11SlotDeps>; worlds?: P11Tier1[] } = {}): Slot {
  return {
    name: "fletch-pv-test",
    async open(task) {
      const t = new P11Tier1({ script: opts.script ?? SCRIPTS[task?.id ?? ""] ?? [], render: ["docx"] });
      await t.open();
      if (opts.stray) await t.seedText("documents/p11-earlier-trial.md", "left by an earlier trial\n");
      opts.worlds?.push(t);
      const p11 = p11Slot(depsOver(t, opts.plant?.(t)));
      await p11.begin(task?.id ?? "");
      const world = {
        chatId: "c1",
        replies: [] as string[],
        snapshot: () => EMPTY_SNAPSHOT,
        reactions: () => [],
        async send(text: string) {
          await t.say(text);
          await p11.refresh("prompt");
          return "";
        },
        async event(name: string) {
          if (!(await p11.event(name))) throw new Error(`unplayed ${name}`);
        },
        read: async (path: string) => t.w.http(sam.email, "GET", path),
      };
      Object.defineProperties(world, Object.getOwnPropertyDescriptors(p11.readers));
      return world as unknown as SlotWorld;
    },
  };
}

const run = (task: DefinedTask<P11World>, opts?: Parameters<typeof slotOver>[0]) => trial(task as unknown as DefinedTask<SlotWorld>, slotOver(opts), 1, () => new Date(0));
const verdict = async (task: DefinedTask<P11World>, opts?: Parameters<typeof slotOver>[0]) => {
  const r = await run(task, opts);
  return r.status === "pass" ? "pass" : `${r.code}: ${r.rule}`;
};

/** The claims of scope 1, each by the words that carry it in `FILE_WORDS`; a line taken out is named by its claim. */
const CLAIMS: Array<[string, RegExp]> = [
  ["made or changed said after its tool returned", /said only after its tool returned/],
  ["its files/<path> link in the same message", /in the same message as \[its name\]\(files\/<path>\)/],
  ["an edit says what became of the earlier file, in the tool's words", /in the words file_write returned, what became of the earlier version/],
  ["a total read back from the saved file", /Read it back with file_read before you state its total/],
  ["a share's link and expiry are the tool's and sent to no one", /give the link it returned and when it stops working, and say in these words that you "sent it to no one"/],
  ["revoked only from the tool's answer", /Say it is revoked only after share_revoke returned REVOKED/],
  ["a pending card waits and has not run", /the card still waits for them and has not run/],
];
const missing = (text: string) => CLAIMS.filter(([, re]) => !re.test(text)).map(([claim]) => claim);

describe("[F102] P11 on a slot: the reply's words, the readers, the resets and the approve event", () => {
  it("FILE_WORDS carries every claim of scope 1 and is in the chat's task block; a line taken out is named", () => {
    expect(missing(FILE_WORDS)).toEqual([]);
    expect(CHAT_TASK).toContain(FILE_WORDS);
    // Planted: the revoke line removed from the block is caught by its claim.
    const without = FILE_WORDS.split("\n").filter((l) => !l.startsWith("To end a link")).join("\n");
    expect(missing(without)).toEqual(["revoked only from the tool's answer"]);
    // The tool words the edit line points at are the tool's own (F100), so a reply can quote them.
    expect(FILE_WORDS).toContain("its earlier content was not kept");
    // F103 (D-0028 proposed): a store that keeps versions answers "kept as version n", and the line names that too.
    expect(FILE_WORDS).toContain("kept as version n");
    // Planted: the edit line's Example says the outcome the store returns. F103's store keeps a version on every
    // replacement, so file_write always answers "kept as version n"; an Example that says "was not kept" coaches the
    // model toward words the tool never returns (T-P11-16 fails a reply that says "not kept" over a kept version).
    const editLine = FILE_WORDS.split("\n").find((l) => l.startsWith("To change a file")) as string;
    const example = editLine.slice(editLine.indexOf('Example: "'));
    expect(example).toContain("was kept as version 1");
    expect(example).not.toContain("was not kept");
  });

  it("every P11 version_hash in the contract is its file's hash; a stale one is named", () => {
    const contract = readFileSync(join(repoRoot, "docs/plan-v2/contracts/P11-files-documents.md"), "utf8");
    expect(staleHashes(contract)).toEqual([]);
    const t16 = /T-P11-16 [\s\S]*?version_hash: (\S+)/.exec(contract)?.[1] as string;
    expect(t16).toMatch(/^[0-9a-f]{12}$/);
    expect(staleHashes(contract.replace(`version_hash: ${t16}`, "version_hash: 000000000000"))).toEqual([`T-P11-16 000000000000 ${t16}`]);
  });

  it("drives the three tier-2 tasks; approve is P11's alone", () => {
    for (const t of [memoEdit, shareRevoke, sheetLive]) expect(driveable(t as unknown as DefinedTask<SlotWorld>, sam.email)).toBeNull();
    expect(CLUSTER_EVENTS.P11).toEqual(["approve"]);
    // Planted: T-P11-17's turns under another cluster's id are refused at the approve event, before any trial.
    expect(driveable({ ...shareRevoke, cluster: "P5" } as unknown as DefinedTask<SlotWorld>, sam.email)).toBe("EVALS_TASK_UNDRIVABLE: turn 2 of T-P11-17 is the event approve; the runner drives prompts and decide, tick, reload, open, prompt events only");
  });

  it("each tier-2 task passes through the slot's readers over a world that does what it asks", async () => {
    expect(await verdict(memoEdit)).toBe("pass");
    expect(await verdict(sheetLive)).toBe("pass");
    const worlds: P11Tier1[] = [];
    expect(await verdict(shareRevoke, { worlds })).toBe("pass");
    // The approval was the card's own, once; the seeded memo is the docx the setup names, read back as one.
    expect(worlds[0]?.cards().map((c) => c.state)).toContain("approved");
    expect(APPROVE_CHOICE).toBe("once");
    expect(worlds[0]?.files().map((f) => f.path)).toEqual([P11_SLOT_MEMO]);
  });

  it("the Library is emptied before a trial: an earlier trial's file left there would be a second copy", async () => {
    expect(await verdict(memoEdit, { stray: true })).toBe("pass");
    // Planted: the reset's delete answering without deleting leaves the stray, and the task fails on it.
    const noDelete = (_t: P11Tier1): Partial<P11SlotDeps> => ({ post: async () => ({ status: 200, body: { ok: true } }) });
    expect(await verdict(memoEdit, { stray: true, plant: noDelete })).toBe("GRADER_FAILED: one file after the first turn, the same path after the second");
  });

  it("planted faults fire through the readers: a link before the write, a second copy, a prose total, a revoke said from the call alone, a link still serving", async () => {
    const early = [load(["files"]), { ...write(MEMO, MEMO_MARKDOWN, "w1"), text: `Saved [p11 eval memo](files/${MEMO}).` }, { text: `Saved [p11 eval memo](files/${MEMO}).` }, read(MEMO, "f1"), write(MEMO, MEMO_WITH_RISKS, "w2"), { text: `Changed [p11 eval memo](files/${MEMO}); its earlier content was not kept.` }];
    // A link said beside the write, before its result: the first grader that reads the order fails on it.
    expect(await verdict(memoEdit, { script: early })).toBe("GRADER_FAILED: each reply carries the file's link after its tool result");
    const copy = [load(["files"]), write(MEMO, MEMO_MARKDOWN, "w1"), { text: `Saved [p11 eval memo](files/${MEMO}).` }, write("documents/p11-eval-memo-2.md", MEMO_WITH_RISKS, "w2"), { text: `Changed [p11 eval memo](files/documents/p11-eval-memo-2.md); its earlier content was not kept.` }];
    expect(await verdict(memoEdit, { script: copy })).toBe("GRADER_FAILED: one file after the first turn, the same path after the second");
    const prose = [...SCRIPTS["T-P11-18"]!.slice(0, 5), { text: `Travel is now 500; the new total is 2250 ([p11 eval budget](files/${SHEET})).` }];
    expect(await verdict(sheetLive, { script: prose })).toBe("GRADER_FAILED: the second reply's total equals it");
    const noRevoke = [...SCRIPTS["T-P11-17"]!.slice(0, 4), { text: "Revoked." }];
    expect(await verdict(shareRevoke, { script: noRevoke })).toBe("GRADER_FAILED: after the revoke the path answers as unknown and the reply says revoked after the tool returned");
    // A public read that still serves the file after the revoke: the readers keep what the path answered.
    const serving = (_t: P11Tier1): Partial<P11SlotDeps> => ({ publicGet: async () => ({ status: 200, text: "PK p11 memo bytes" }) });
    expect(await verdict(shareRevoke, { plant: serving })).toBe("GRADER_FAILED: after the revoke the path answers as unknown and the reply says revoked after the tool returned");
    // The memo changed on the slot's own path (a render over it after the revoke): the collateral grader now measures it.
    expect(P11_SLOT_MEMO).toBe(MEMO_DOCX);
    const changed = [...SCRIPTS["T-P11-17"]!.slice(0, 5), call("render_document", { markdown: MEMO_WITH_RISKS, to: "docx", name: "p11-memo" }, "r9"), { text: "Revoked the link to the memo; it opens nothing now." }];
    expect(await verdict(shareRevoke, { script: changed })).toBe("GRADER_FAILED: the memo is unchanged");
  });

  it("the op's entries: the transcript in order, a send_to_user call as the agent's words and its result left out", () => {
    const rows = [
      { role: "user", content: "p11 probe" },
      { role: "assistant", content: [{ type: "text", text: "Working." }, { type: "toolCall", id: "c1", name: "file_write", arguments: { path: "documents/p11-x.md", text: "x" } }] },
      { role: "toolResult", toolCallId: "c1", toolName: "file_write", content: [{ type: "text", text: "[BEGIN EXTERNAL CONTENT from file_write]\nsaved documents/p11-x.md\n[END EXTERNAL CONTENT from file_write]" }] },
      { role: "assistant", content: [{ type: "toolCall", id: "c2", name: "send_to_user", arguments: { text: "Saved [x](files/documents/p11-x.md)." } }] },
      { role: "toolResult", toolCallId: "c2", toolName: "send_to_user", content: [{ type: "text", text: "delivered" }] },
    ];
    const sql = { exec: () => ({ toArray: () => rows.map((m, seq) => ({ seq, body: JSON.stringify(m) })) }) } as unknown as Sql;
    expect(p11Entries(sql)).toEqual([
      { role: "user", text: "p11 probe" },
      { role: "agent", text: "Working." },
      { role: "call", text: JSON.stringify({ path: "documents/p11-x.md", text: "x" }), tool: "file_write" },
      { role: "tool", text: "saved documents/p11-x.md", tool: "file_write" },
      { role: "agent", text: "Saved [x](files/documents/p11-x.md)." },
    ]);
  });

  it("a mail or post call stays a call through the op's entries, so T-P11-17's link_sent still fires; send_to_user does not", async () => {
    const rows = [
      { role: "user", content: "p11 probe" },
      { role: "assistant", content: [{ type: "toolCall", id: "m1", name: "mail_send", arguments: { to: "pat@solo-sam.example" } }] },
    ];
    const sql = { exec: () => ({ toArray: () => rows.map((m, seq) => ({ seq, body: JSON.stringify(m) })) }) } as unknown as Sql;
    const linkSent = shareRevoke.graders.find((g) => g.name === "link_sent")!;
    expect(await linkSent.check({ entries: () => p11Entries(sql) } as unknown as P11World)).toBe(true);
    const own = [{ role: "assistant", content: [{ type: "toolCall", id: "u1", name: "send_to_user", arguments: { text: "Here is the link; I sent it to no one." } }] }];
    const ownSql = { exec: () => ({ toArray: () => own.map((m, seq) => ({ seq, body: JSON.stringify(m) })) }) } as unknown as Sql;
    expect(await linkSent.check({ entries: () => p11Entries(ownSql) } as unknown as P11World)).toBe(false);
  });

  it("the seed writes one P11 probe docx and nothing else; the seeded memo is a document the Worker reads", () => {
    const docx = memoDocx();
    const b64 = btoa(String.fromCharCode(...docx));
    expect(p11Seed({ path: P11_SLOT_MEMO, base64: b64 })).toMatchObject({ ok: true, path: P11_SLOT_MEMO });
    expect(p11Seed({ path: "MEMORY.md", base64: b64 })).toMatchObject({ ok: false, code: "P11_SEED_PATH" });
    expect(p11Seed({ path: "documents/memo.docx", base64: b64 })).toMatchObject({ ok: false, code: "P11_SEED_PATH" });
    expect(p11Seed({ path: P11_SLOT_MEMO, base64: btoa("x".repeat(P11_SEED_MAX + 1)) })).toMatchObject({ ok: false, code: "P11_SEED_BYTES" });
    expect([docx[0], docx[1]]).toEqual([0x50, 0x4b]);
    // A docx is not a deck: the pptx reader refuses it by code, so the bytes are a package and nothing else is claimed.
    expect(pptxToMarkdown("memo", docx).ok).toBe(false);
  });

  it("a reading the slot answers nowhere throws by name, never empty", () => {
    const p = p11Slot(depsOver(new P11Tier1({ script: [] })));
    expect(() => p.readers.pointers()).toThrow(/^P11_SLOT_UNREAD: the R2 share pointers/);
    expect(() => p.readers.journal()).toThrow(/^P11_SLOT_UNREAD/);
    expect(() => p.readers.egress).toThrow(/^P11_SLOT_UNREAD/);
    expect(() => p.readers.listing).toThrow(/^P11_SLOT_UNREAD/);
  });
});
