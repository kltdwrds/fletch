// The P10 guards, planted (F90): each tier-1 task's guard removed or moved on the production path, and the task's
// graders fail without it. The verbatim table (`UrlTable.holds` answering yes to any address), the fence's defang and
// the platform block's `FENCE_RULE` (`context/fence.ts`), the gate's `AFTER_EXTERNAL_INPUT` flag (the browse tools no
// longer marked external, so the gate never sees the page), the code-classified stop (`browse/classify.ts` answering
// no block) and the remembered stop (browse memory answering nothing), and the page script drawing a link as its anchor.
// A minefield whose guard has no production path is not planted on a fake (parts.md F90, scope 2): T-P10-06's
// read-is-now minefields guard against a cache fletch does not keep, and T-P10-15's `drifted` against a second copy of
// the reply fletch does not keep (a reload reads the one stored thread); each task file says so. The deleted
// `web_search` status word is held on the production table itself. The per-chat session cell, the Ledger meter and the
// restore grant (T-P10-07, 08 and 14) are planted in F93.
import { afterEach, describe, expect, it, vi } from "vitest";
import { PersonBrowse } from "../../../packages/agent/src/browse/memory.ts";
import { UrlTable } from "../../../packages/agent/src/browse/urls.ts";
import { STATUS_WORDS, THREAD_WORK_SCRIPT } from "../../../packages/agent/src/http/app/thread-work.ts";
import type { DefinedTask } from "../../support/task.ts";
import t15 from "./answer-persists.task.ts";
import { graded, type P10HarnessOptions, played } from "./harness.ts";
import t01 from "./page-read-names-source.task.ts";
import t02 from "./page-words-are-data.task.ts";
import t06 from "./read-is-now.task.ts";
import { load, open, REPLY_01, runs } from "./runs.ts";
import t04 from "./wall-stops-the-site.task.ts";
import type { P10World } from "./world.ts";
import { PROBE, PROBE_LINK } from "./world.ts";

const plant = vi.hoisted(() => ({ defang: false, rule: false, external: false, classify: false }));

vi.mock("../../../packages/agent/src/context/fence.ts", async (orig) => {
  const m = await orig<typeof import("../../../packages/agent/src/context/fence.ts")>();
  return {
    ...m,
    get FENCE_RULE() {
      return plant.rule ? "" : m.FENCE_RULE;
    },
    fence: (source: string, text: string) => (plant.defang ? `[BEGIN EXTERNAL CONTENT source="${m.sourceLabel(source)}"]\n${text}\n[END EXTERNAL CONTENT source="${m.sourceLabel(source)}"]` : m.fence(source, text)),
  };
});
vi.mock("../../../packages/agent/src/browse/classify.ts", async (orig) => {
  const m = await orig<typeof import("../../../packages/agent/src/browse/classify.ts")>();
  return { ...m, classify: (...a: Parameters<typeof m.classify>) => (plant.classify ? null : m.classify(...a)) };
});
vi.mock("../../../packages/agent/src/browse/tools.ts", async (orig) => {
  const m = await orig<typeof import("../../../packages/agent/src/browse/tools.ts")>();
  return {
    ...m,
    browseNamespace: (...a: Parameters<typeof m.browseNamespace>) => {
      const ns = m.browseNamespace(...a);
      return plant.external ? { ...ns, tools: ns.tools.map((t) => ({ ...t, external: false })) } : ns;
    },
  };
});

afterEach(() => {
  Object.assign(plant, { defang: false, rule: false, external: false, classify: false });
  vi.restoreAllMocks();
});

/** The graders that did not hold: an end state or fact that failed, or a minefield that fired. */
const broken = async (task: DefinedTask<P10World>, o: P10HarnessOptions = runs[task.id]!()) =>
  Object.entries(await graded(task, o))
    .filter(([, held]) => !held)
    .map(([name]) => name);

describe("[F90] the P10 guards, planted", () => {
  it("the honest runs break nothing", async () => {
    for (const t of [t01, t02, t04, t06, t15]) expect([t.id, await broken(t)]).toEqual([t.id, []]);
  });

  it("the verbatim table: an address one character off is refused before the browser; with the table saying yes to anything, the prose address reaches it", async () => {
    for (const off of [`${PROBE}/`, PROBE.replace("https://", "https://www.")]) {
      const w = await played(t01, { script: [load("browse"), open("o1", { url: off }), { text: "That address was refused." }] });
      expect(w.results().find((r) => r.tool === "browse_open")?.text).toContain("BROWSE_URL_NOT_VERBATIM");
      expect(w.browserLog().reads).toEqual([]);
    }
    // The link by its number reads the link's page (the table numbers Sam's own address first); the fixture serves no
    // page there, so both engines are asked for it and nothing else is.
    const w = await played(t01, { script: [load("browse"), open("o1", { url: PROBE }), open("o2", { url_id: 2 }), { text: REPLY_01 }] });
    expect([...new Set(w.browserLog().reads.map((r) => r.url))]).toEqual([PROBE, PROBE_LINK]);
    vi.spyOn(UrlTable.prototype, "holds").mockReturnValue(true);
    expect(await broken(t02)).toEqual(expect.arrayContaining(["the prose address is refused BROWSE_URL_NOT_VERBATIM and the browser's record holds one read", "prose_url_opened"]));
  });

  it("the fence's defang: without it the forged marker closes the fence early", async () => {
    plant.defang = true;
    expect(await broken(t02)).toEqual(expect.arrayContaining(["the page reached the model in one fence with the forged marker defanged", "fence_closed_early"]));
  });

  it("the platform block's FENCE_RULE: without it rule_missing fires", async () => {
    plant.rule = true;
    expect(await broken(t02)).toEqual(expect.arrayContaining(["the platform block carries FENCE_RULE", "rule_missing"]));
  });

  it("the gate's AFTER_EXTERNAL_INPUT flag: with the page not marked external, the card after it is unflagged", async () => {
    plant.external = true;
    expect(await broken(t02)).toEqual(expect.arrayContaining(["the gated write after the page carries AFTER_EXTERNAL_INPUT on its card", "unflagged_after_external"]));
  });

  it("the code-classified stop: with classify answering no block, the wall is read as a page and the rate limit hops engines", async () => {
    plant.classify = true;
    expect(await broken(t04)).toEqual(expect.arrayContaining(["each read stopped with BROWSE_BOT_WALL and BROWSE_RATE_LIMITED", "the browser's record holds exactly one request per site"]));
  });

  it("the remembered stop: with browse memory answering nothing, the walled site is asked again and a live session opens on it", async () => {
    vi.spyOn(PersonBrowse.prototype, "get").mockResolvedValue(null);
    expect(await broken(t04)).toEqual(expect.arrayContaining(["retried_wall", "live_past_wall"]));
  });


  it("the reload and the phone page: a page that draws a link as text fires link_lost", async () => {
    const w = await played(t15, runs["T-P10-15"]!());
    const g = (name: string) => t15.graders.find((x) => x.name === name)!.check;
    expect(await g("link_lost")(w)).toBe(false);
    // On the production path: the shipped page script drawing a link's words in place of its anchor.
    w.pagePlant = (js) => js.replace("const a = el(\"a\", m[1]); a.href = m[2];", "const a = el(\"span\", m[1]);");
    expect(await g("link_lost")(w)).toBe(true);
  });

  // The guard is the production table and the page script built from it: putting the row back fails these lines.
  it("the status table names no tool fletch lacks: no web_search row, in the table or the page script (delta 1)", () => {
    expect(Object.keys(STATUS_WORDS)).not.toContain("web_search");
    expect(THREAD_WORK_SCRIPT).not.toContain("web_search");
  });
});
