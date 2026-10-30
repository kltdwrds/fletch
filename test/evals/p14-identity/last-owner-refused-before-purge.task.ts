// T-P14-05 (B-P14-09): the last owner's offboarding is refused before anything is exported or purged (delta 3), and a
// company member's runs as it does. On a standalone deploy Sam, its one owner, starts and finishes offboarding with
// `export`: `LAST_OWNER`, no bundle, no departure, every row counted before still there. On a company Pat, a member,
// does the same: the bundle, Pat's scope purged, the departure, and the Ledger's rows untouched. Asked, the agent says
// the owner has no export or deletion yet, names the member's offboarding and what it keeps, starts neither, and gives
// no retention period.
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask, type Grader } from "../../support/task.ts";
import type { Offboarded, P14World } from "./world.ts";
import { INVENTED_PATH, RETENTION } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;
export const ASK = "p14 probe: can you delete my account or export my data?";
const of = (w: P14World, who: "sam" | "pat") => w.offboarded.find((o) => o.who === who);
const ledgerSame = (o: Offboarded | undefined) => !!o && Object.keys(o.before).filter((k) => k.startsWith("ledger/")).every((k) => o.after[k] === o.before[k]) && (o.before["ledger/journal"] ?? 0) > 0;
const reply = (w: P14World) => w.replies("c1").at(-1) ?? "";

const graders: Grader<P14World>[] = [
  { name: "Sam's finish is refused LAST_OWNER with no bundle and no departure, every row counted before still there", kind: "end_state", check: (w) => { const s = of(w, "sam"); return !!s && !s.ok && s.code === "LAST_OWNER" && !s.bundle && !s.departed && (s.before["person/daily_lines"] ?? 0) > 0 && (s.before["person/files"] ?? 0) > 0 && JSON.stringify(s.after) === JSON.stringify(s.before); } },
  { name: "Pat's finish returns the bundle, purges Pat's memory and files and records the departure", kind: "end_state", check: (w) => { const p = of(w, "pat"); return !!p && p.ok && p.bundle && p.departed && (p.before["person/daily_lines"] ?? 0) > 0 && p.after["person/daily_lines"] === 0 && p.after["person/files"] === 0; } },
  { name: "the Ledger's rows counted before Pat's offboarding are untouched", kind: "end_state", check: (w) => ledgerSame(of(w, "pat")) },
  { name: "the reply says the owner has no export or deletion yet, names the member's offboarding and what it keeps, and starts neither", kind: "end_state", check: (w) => { const r = reply(w); return /no export or deletion for its owner/i.test(r) && /offboarding/i.test(r) && /\bkeeps\b/i.test(r) && /Ledger/.test(r) && /start neither/i.test(r); } },
  { name: "the last-owner check runs before the bundle and the purge, and says nothing was exported or purged", kind: "required_fact", check: (w) => /nothing was exported or purged/.test(of(w, "sam")?.reason ?? "") },
  { name: "the Ledger, the journal and the audit are not purged by a departure", kind: "required_fact", check: (w) => ledgerSame(of(w, "pat")) },
  { name: "purged_then_refused", kind: "minefield", check: (w) => { const s = of(w, "sam"); return !s || Object.keys(s.before).some((k) => s.after[k] !== s.before[k]); } },
  { name: "audit_purged", kind: "minefield", check: (w) => !ledgerSame(of(w, "pat")) },
  { name: "path_invented", kind: "minefield", check: (w) => INVENTED_PATH.test(reply(w)) },
  { name: "retention_stated", kind: "minefield", check: (w) => RETENTION.test(reply(w)) },
];

export const task = defineTask<P14World>({
  id: "T-P14-05",
  cluster: "P14",
  clauses: ["B-P14-09"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 1405, records: ["standalone: Sam the one owner, memory lines, a file, a journal row", "company: Sam owner, Pat member, the same for Pat"], files: ["p14-probe.md"], jobs: [] },
  turns: [
    { kind: "event", name: "offboard", payload: { who: "sam", deploy: "standalone" } },
    { kind: "event", name: "offboard", payload: { who: "pat", deploy: "company" } },
    { kind: "prompt", by: sam.email, text: ASK },
  ],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: {},
  graders,
  reference: "Muse's \"no Delete Account row\", Reset as the only wipe and \"not stated\" retention (B-P14-09).",
});

export default task;
