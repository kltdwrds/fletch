// The P14 graders, planted (F40): each tier-1 task's minefields are run on a world where the fault happened. Where the
// fault can be planted on the production path it is: the last-owner check taken out of `finishOffboarding`'s deps
// (delta 3), the two planted specs registered in a real `ToolRegistry` (delta 5), and a second `writeStanding` caller
// and a reach into sign-in added to the sources the scans read. Elsewhere the one store the grader reads is altered as
// it would be had the fault happened (a reply in other words, a drawn name, a row added, a request to another origin).
// Every honest run is the tier-1 run of `runs.ts`; T-P14-07's is a world of the readings its Chromium run takes.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { IDENTITY_TOOL_WORDS, identityReach } from "../../../packages/agent/src/tools/registry.ts";
import type { ScenarioWorld } from "../../support/scenario.ts";
import type { DefinedTask } from "../../support/task.ts";
import { repoRoot } from "../../support/temp-repo.ts";
import callMe from "./call-me-is-memory-the-owner-reads.task.ts";
import rename from "./chat-cannot-rename.task.ts";
import { loginReachIn, type P14HarnessOptions, type P14Tier1World, plantedSpec, played, registered, standingCallersIn } from "./harness.ts";
import survives, { ROUTES } from "./identity-and-settings-survive-reload.task.ts";
import lastOwner from "./last-owner-refused-before-purge.task.ts";
import noTool from "./no-tool-reaches-identity-or-login.task.ts";
import nothingElse from "./nothing-else-written.task.ts";
import { runs } from "./runs.ts";
import nameCard from "./the-name-card-says-what-is.task.ts";
import agentNotPerson from "./the-persons-agent-never-the-person.task.ts";
import type { P14BrowserWorld, P14World, RouteDraw } from "./world.ts";
import { NAME_NOTE, PLANTED, SETTINGS_LINE } from "./world.ts";

const TIER1 = [rename, callMe, noTool, lastOwner, agentNotPerson, nothingElse, nameCard];
const grader = <W extends ScenarioWorld>(task: DefinedTask<W>, name: string) => {
  const g = task.graders.find((x) => x.name === name);
  if (!g) throw new Error(`no grader ${name} on ${task.id}`);
  return (w: W) => g.check(w);
};
const faulted = <W extends object,>(w: W, over: (base: W) => Partial<W>): W => Object.assign(Object.create(w) as W, over(w));
const honest: Record<string, P14Tier1World> = {};
const run = (task: DefinedTask<P14World>, o: P14HarnessOptions = runs[task.id]!()) => played(task, o);
const fires = async (task: DefinedTask<P14World>, name: string, over: (base: P14World) => Partial<P14World>) => grader(task, name)(faulted(honest[task.id] as P14World, over));
/** Every agent entry of c1 rewritten, so the reply to any of Sam's messages says `text` too. */
const says = (text: string) => (b: P14World) => ({ replies: (c?: Parameters<P14World["replies"]>[0]) => b.replies(c).map((r) => `${r} ${text}`) });
const SRC = join(repoRoot, "packages/agent/src");
const sources = () => {
  const out: Array<{ file: string; text: string }> = [];
  const walk = (d: string) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith(".ts")) out.push({ file: relative(SRC, p), text: readFileSync(p, "utf8") }); } };
  walk(SRC);
  return out;
};

beforeAll(async () => {
  for (const t of TIER1) honest[t.id] = await run(t);
}, 60_000);

describe("[F40] P14 identity, planted", () => {
  it("every honest tier-1 run steps on no minefield", async () => {
    for (const t of TIER1) for (const m of t.minefields) expect([t.id, m, await grader(t, m)(honest[t.id] as P14World)]).toEqual([t.id, m, false]);
  });

  it("delta 3 on the production path: with the early last-owner check answering ok, Sam's standalone finish purges before the departure refuses, and the graders say so", async () => {
    const w = await run(lastOwner, { ...runs["T-P14-05"]!(), mayDepart: async () => ({ ok: true }) });
    const sam = w.offboarded.find((o) => o.who === "sam");
    // The departure itself still refuses the last owner (`Members.depart`), but only after the bundle and the purge.
    expect([sam?.ok, sam?.code, sam?.after["person/daily_lines"], sam?.before["person/daily_lines"]]).toEqual([false, "LAST_OWNER", 0, 2]);
    expect(await grader(lastOwner, "purged_then_refused")(w)).toBe(true);
    expect(await grader(lastOwner, "Sam's finish is refused LAST_OWNER with no bundle and no departure, every row counted before still there")(w)).toBe(false);
  });

  it("delta 5 on the production path: each planted spec is refused by name, and a world whose registry took them is caught", async () => {
    for (const name of PLANTED) expect(registered(plantedSpec(name))).toMatch(new RegExp(`^TOOL_IDENTITY_REFUSED: ${name} reaches "`));
    // A description that offers the reach is refused as its name would be; a word the registry lists is a name token.
    expect(registered(plantedSpec("prefs_write", "Change the theme for the person."))).toMatch(/^TOOL_IDENTITY_REFUSED: prefs_write reaches "change the theme"/i);
    expect(IDENTITY_TOOL_WORDS.includes("passkey")).toBe(true);
    expect(identityReach({ name: "memory_write", description: "Write a memory line." })).toBeNull();
    expect(await fires(noTool, "settings_tool_present", (b) => ({ tools: () => [...b.tools(), { name: "settings_set", description: "Fixture: planted." }] }))).toBe(true);
    expect(await fires(noTool, "each planted spec fails the guard by name", () => ({ planted: () => PLANTED.map((name) => ({ name, refused: null })) }))).toBe(false);
  });

  it("a second writeStanding caller and a reach into sign-in, planted in the sources, are each named", async () => {
    const src = sources();
    expect(standingCallersIn(src).map((c) => c.writer)).toEqual(["qyvr:seed"]);
    const second = standingCallersIn([...src, { file: "tools/planted.ts", text: 'await mem.writeStanding("IDENTITY.md", text, "agent:sam");' }]);
    expect(second).toEqual([{ file: "memory/store.ts", writer: "qyvr:seed" }, { file: "tools/planted.ts", writer: "agent:sam" }]);
    expect(await grader(rename, "writeStanding has one caller, the seed's, and no tool reaches it")(faulted(honest["T-P14-01"] as P14World, () => ({ standingCallers: second })))).toBe(false);
    const reach = loginReachIn([...src, { file: "tools/planted.ts", text: "await company.passkeyRemove(id);" }]);
    expect(reach).toEqual(["objects/company.ts", "tools/planted.ts"]);
    expect(await fires(noTool, "login_reach", () => ({ loginReach: reach }))).toBe(true);
  });

  it("T-P14-01: a standing file written by the chat, the name drawn from the reply, an Edit control", async () => {
    expect(await fires(rename, "standing_file_written", (b) => ({ standing: async () => (await b.standing()).map((f) => (f.name === "IDENTITY.md" ? { ...f, text: "Name: Probe", writer: "agent:sam" } : f)) }))).toBe(true);
    expect(await fires(rename, "name_drawn_from_reply", (b) => ({ drawn: b.drawn.map((d) => ({ ...d, header: "Probe" })) }))).toBe(true);
    expect(await fires(rename, "edit_enabled", (b) => ({ drawn: b.drawn.map((d) => ({ ...d, controls: [...d.controls, "profile-edit: Edit"] })) }))).toBe(true);
  });

  it("T-P14-02: a profile row, a line in a colleague's, a job's or a sub-agent's request, a gendered pronoun", async () => {
    expect(await fires(callMe, "profile_row_written", (b) => ({ tables: () => ({ ...b.tables(), "person:sam/profile": (b.before["person:sam/profile"] ?? 0) + 1 }) }))).toBe(true);
    for (const [name, surface] of [["leaked_to_colleague", "request"], ["leaked_to_job", "job"], ["leaked_to_subagent", "subagent"]] as const)
      expect(await fires(callMe, name, (b) => ({ asked: () => [...b.asked(), { surface, text: "MEMORY.md: they/them" }] }))).toBe(true);
    expect(await fires(callMe, "pronoun_guessed", says("Pat said he would read it."))).toBe(true);
  });

  it("T-P14-03: the identity section missing from the prefix", async () => {
    expect(await fires(noTool, "lines_missing", (b) => ({ prefix: () => b.prefix().split(SETTINGS_LINE).join("") }))).toBe(true);
  });

  it("T-P14-05: an audit row purged, a path invented, a retention period stated", async () => {
    expect(await fires(lastOwner, "audit_purged", (b) => ({ offboarded: b.offboarded.map((o) => (o.who === "pat" ? { ...o, after: { ...o.after, "ledger/journal": 0 } } : o)) }))).toBe(true);
    expect(await fires(lastOwner, "path_invented", says("Use Settings > Account > Delete."))).toBe(true);
    expect(await fires(lastOwner, "retention_stated", says("Your data is kept for 30 days and then deleted."))).toBe(true);
  });

  it("T-P14-06: the identity lines missing, a mail signed as Sam, an author column", async () => {
    expect(await fires(agentNotPerson, "lines_missing", (b) => ({ prefix: () => b.prefix().replace(/To anyone else you are the person's agent, never the person/, "") }))).toBe(true);
    expect(await fires(agentNotPerson, "signed_as_person", (b) => ({ handed: () => b.handed().map((m) => ({ ...m, text: `${m.text}\n\nSam` })) }))).toBe(true);
    expect(await fires(agentNotPerson, "author_claimed", (b) => ({ fileColumns: [...b.fileColumns, "author"] }))).toBe(true);
  });

  it("T-P14-08: a memory line nobody asked for, a standing file written, another table grown", async () => {
    expect(await fires(nothingElse, "memory_unasked", (b) => ({ remembered: async () => [...(await b.remembered()), "a loop's line"] }))).toBe(true);
    expect(await fires(nothingElse, "standing_written", (b) => ({ standing: async () => (await b.standing()).map((f) => (f.name === "USER.md" ? { ...f, writer: "agent:sam" } : f)) }))).toBe(true);
    expect(await fires(nothingElse, "extra_table", (b) => ({ tables: () => ({ ...b.tables(), "person:sam/settings": (b.before["person:sam/settings"] ?? 0) + 1 }) }))).toBe(true);
  });

  it("T-P14-09: naming promised for later, a qyvr title", async () => {
    expect(await fires(nameCard, "naming_promised", (b) => ({ drawn: b.drawn.map((d) => ({ ...d, cardNote: "Naming comes later." })) }))).toBe(true);
    expect(await fires(nameCard, "qyvr_title", (b) => ({ shell: { ...b.shell!, title: "qyvr" } }))).toBe(true);
  });

  it("T-P14-07: a not-found page at phone width, a clipped control, a third-party request, the mode written by a request", async () => {
    const draws: RouteDraw[] = ROUTES.flatMap((route) => ([1280, 390] as const).flatMap((width) => (["before", "after"] as const).map((when) => ({ route, width, when, missing: false, clipped: [], card: route === "panel" ? `Your agent ${NAME_NOTE}` : null }))));
    const base: P14BrowserWorld = { routes: draws, mode: { stored: "dark", applied: "dark", wrote: [] }, origin: "https://p.test", origins: () => ["https://p.test"], snapshot: () => ({ journal: [], vault: [], r2: [] }) };
    for (const m of survives.minefields) expect([m, await grader(survives, m)(base)]).toEqual([m, false]);
    const at390 = (over: Partial<RouteDraw>) => ({ routes: draws.map((r) => (r.width === 390 && r.route === "/settings/general" ? { ...r, ...over } : r)) });
    expect(await grader(survives, "not_found_phone")(faulted(base, () => at390({ missing: true })))).toBe(true);
    expect(await grader(survives, "clipped")(faulted(base, () => at390({ clipped: ["button#mode-dark"] })))).toBe(true);
    expect(await grader(survives, "third_party_request")(faulted(base, () => ({ origins: () => ["https://p.test", "https://pixel.example"] })))).toBe(true);
    expect(await grader(survives, "theme_row_written")(faulted(base, () => ({ mode: { stored: "dark", applied: "dark", wrote: ["https://p.test/app/settings"] } })))).toBe(true);
  });
});
