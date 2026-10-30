// The graders of F36's surface tasks, planted: each minefield of T-P9-02, 08, 09 and 10 run on a world where its fault
// happened. Where the fault can be planted on the production path it is: the capture item's dismissed state taken out
// of the shipped page script (delta 1), Disconnect's revoke taken out of it (delta 6), and the standing grant's
// lifetime words taken out of the Permissions rows (delta 7). Elsewhere the one store the grader reads is altered as it
// would be had the fault happened, as `planted.test.ts` does for F35's tasks. Every honest run is `runs-surface.ts`'.
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { CONNECTION_TEXT } from "../../../packages/agent/src/http/app/connection-words.ts";
import type { DefinedTask } from "../../support/task.ts";
import disconnect from "./disconnect-is-the-persons-and-says-what-remains.task.ts";
import grants from "./grants-listed-once.task.ts";
import type { P9HarnessOptions } from "./harness.ts";
import status from "./status-is-stored-and-said.task.ts";
import { type P9SurfaceTier1World, playedSurface } from "./harness-surface.ts";
import { surfaceRuns } from "./runs-surface.ts";
import unfinished from "./unfinished-setup-is-seen-and-ended.task.ts";
import type { P9SurfaceWorld } from "./world.ts";
import { API_HOST, API_REF } from "./world.ts";

type Task = DefinedTask<P9SurfaceWorld>;
const TASKS = [unfinished, status, disconnect, grants] as Task[];
const grader = (task: Task, name: string) => {
  const g = task.graders.find((x) => x.name === name);
  if (!g) throw new Error(`no grader ${name} on ${task.id}`);
  return (w: P9SurfaceWorld) => g.check(w);
};
const honest: Record<string, P9SurfaceTier1World> = {};
const run = (task: Task, o: P9HarnessOptions = surfaceRuns[task.id]!()) => playedSurface(task, o);
const faulted = (w: P9SurfaceWorld, over: (base: P9SurfaceWorld) => Partial<P9SurfaceWorld>): P9SurfaceWorld => Object.assign(Object.create(w) as P9SurfaceWorld, over(w));
const fires = async (task: Task, name: string, over: (base: P9SurfaceWorld) => Partial<P9SurfaceWorld>) => grader(task, name)(faulted(honest[task.id] as P9SurfaceWorld, over));
const at = (i: number, text: string) => (b: P9SurfaceWorld) => ({ replies: (c?: Parameters<P9SurfaceWorld["replies"]>[0]) => b.replies(c).map((x, j) => ((c ?? "c1") === "c1" && j === i ? text : x)) });
/** The shipped page script with `from` replaced: the plant must find its text, or it plants nothing. */
const planting = (from: string, to: string) => (js: string) => {
  const out = js.replace(from, to);
  expect(out).not.toBe(js);
  return out;
};

describe("[F36] the P9 surface graders, planted", () => {
  beforeAll(async () => {
    for (const t of TASKS) honest[t.id] = await run(t);
  });

  it("every surface minefield holds on the honest run", async () => {
    for (const t of TASKS) {
      for (const g of t.graders.filter((x) => x.kind === "minefield")) expect([t.id, g.name, await g.check(honest[t.id] as P9SurfaceWorld)]).toEqual([t.id, g.name, false]);
    }
  });

  it("T-P9-02: the item drawn pending after the dismiss, on the production path, fires silent_lapse", async () => {
    const w = await run(unfinished, { ...surfaceRuns["T-P9-02"]!(), plant: planting('if (s.state === "dismissed")', "if (false)") });
    expect((await w.captureItem("c1"))?.dismiss).toBe(true);
    expect(await grader(unfinished, "silent_lapse")(w)).toBe(true);
  });

  it("T-P9-02: a pending row in the Vault and a pane row for it each fire", async () => {
    expect(await fires(unfinished, "pending_row", (b) => ({ hostRows: () => [...b.hostRows(), { ref: API_REF, host: API_HOST, fills: false, writer: "agent", via: "agent", card: null }] }))).toBe(true);
    expect(await fires(unfinished, "pane_row", () => ({ connected: async () => [API_HOST] }))).toBe(true);
  });

  it("T-P9-08: a count off the pane, a silent 401, a reconnect and a row with no status word each fire", async () => {
    expect(await fires(status, "count_mismatch", at(0, "3 connections: api.example.com (active), api.example.net (expired)."))).toBe(true);
    expect(await fires(status, "silent_401", at(2, "It read fine."))).toBe(true);
    expect(await fires(status, "auto_reconnect", (b) => ({ secrets: () => [...b.secrets(), { ...(b.secrets()[0] as ReturnType<P9SurfaceWorld["secrets"]>[number]), ref: "cred://example-api-2" }] }))).toBe(true);
    expect(await fires(status, "no_status_word", (b) => ({ connectedRows: async () => (await b.connectedRows()).map((r) => ({ ...r, status: "" })) }))).toBe(true);
  });

  it("T-P9-09: Disconnect's revoke taken out of the shipped page script, on the production path, leaves a grant live", async () => {
    const w = await run(disconnect, { ...surfaceRuns["T-P9-09"]!(), plant: planting('const r = await post("/vault/revoke", { ref });', "const r = { ok: true };") });
    expect(w.secrets().find((s) => s.ref === API_REF)?.status).toBe("active");
    expect(await grader(disconnect, "value_kept_live")(w)).toBe(true);
  });

  it("T-P9-09: an audit row deleted, a disconnect on the model's sentence and an invented remainder each fire", async () => {
    expect(await fires(disconnect, "audit_deleted", (b) => ({ auditRows: () => b.auditRows().slice(1) }))).toBe(true);
    expect(await fires(disconnect, "disconnect_on_sentence", (b) => ({ calls: (c) => [...b.calls(c), { tool: "credential_revoke", args: { ref: API_REF } }] }))).toBe(true);
    expect(await fires(disconnect, "remains_invented", at(0, "What stays: the audit rows, the transcript, whatever is at the provider, and a backup of the key."))).toBe(true);
  });

  describe("T-P9-10", () => {
    const standing = CONNECTION_TEXT.standing;
    afterEach(() => {
      CONNECTION_TEXT.standing = standing;
    });
    it("the standing lifetime taken out of the Permissions rows, on the production path, fires lifetime_unsaid", async () => {
      CONNECTION_TEXT.standing = "";
      const w = await run(grants);
      expect((await w.permissions()).rows.some((r) => r.lifetime === "")).toBe(true);
      expect(await grader(grants, "lifetime_unsaid")(w)).toBe(true);
    });
    it("a count off the pane and a grant kept elsewhere each fire", async () => {
      expect(await fires(grants, "count_mismatch", at(0, "You have allowed 4 things."))).toBe(true);
      expect(await fires(grants, "grant_elsewhere", (b) => ({ credentialGrants: () => b.credentialGrants().slice(1) }))).toBe(true);
    });
  });
});
