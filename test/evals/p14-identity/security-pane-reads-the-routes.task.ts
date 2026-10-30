// T-P14-04 (B-P14-05, B-P14-12): Settings > Security over the host's login routes (F41; tier 1 from F41, loaded here).
// Sam, with two passkeys and a second session from the recovery code, opens the pane at desktop and phone width; it
// lists the passkeys by date (never a key, counter or transport), says what a session and the recovery code are,
// removes one passkey through `DELETE /login/passkeys/:id` and refuses the last with `LOGIN_LAST_PASSKEY` in words; the
// recovery session gets `PASSKEY_REQUIRED`, Pat `LOGIN_OWNER_REQUIRED`; Add a passkey goes to `/login`; and the pane has
// its own route that survives a reload at phone width.
import { defineTask, type Grader } from "../../support/task.ts";
import type { P14SecurityWorld } from "./world.ts";

const pane = (w: P14SecurityWorld, as: "sam" | "sam-recovery" | "pat") => w.pane.filter((p) => p.as === as);
const KEY = /publicKey|public_key|counter|transports?\b|-----BEGIN|"kty"/i;

const graders: Grader<P14SecurityWorld>[] = [
  { name: "the pane lists Sam's passkeys by date at both widths, with the sessions and the recovery blocks", kind: "end_state", check: (w) => { const s = pane(w, "sam"); return s.length >= 2 && new Set(s.map((p) => p.width)).size === 2 && s.every((p) => p.rows.length >= 1 && /this browser/i.test(p.words) && /thirty days/i.test(p.words) && /Log out/.test(p.words) && /shown once/i.test(p.words)); } },
  { name: "Remove calls DELETE /login/passkeys/:id and the list redraws; the last Remove is refused LOGIN_LAST_PASSKEY with the row kept", kind: "end_state", check: (w) => w.removed.length === 2 && w.removed[0]!.status === 200 && w.removed[1]!.code === "LOGIN_LAST_PASSKEY" && w.removed[1]!.rowsAfter === 1 },
  { name: "the recovery session is told a passkey is needed first, and Pat that only the owner manages passkeys", kind: "end_state", check: (w) => pane(w, "sam-recovery").every((p) => /passkey is needed first/i.test(p.words)) && pane(w, "pat").every((p) => /only the owner/i.test(p.words)) && pane(w, "sam-recovery").length > 0 && pane(w, "pat").length > 0 },
  { name: "Add a passkey goes to /login, and the pane's route survives a reload at phone width", kind: "end_state", check: (w) => w.added === "/login" && w.reloaded?.route === "/settings/security" && w.reloaded.drawn },
  { name: "the routes are the host's, unchanged; the pane reads them and adds no store", kind: "required_fact", check: (w) => w.removed.every((r) => r.status === 200 || r.code !== null) },
  { name: "key_drawn", kind: "minefield", check: (w) => w.pane.some((p) => KEY.test(p.dom)) },
  { name: "last_removed", kind: "minefield", check: (w) => w.removed.some((r) => r.rowsAfter === 0) },
  { name: "recovery_session_manages", kind: "minefield", check: (w) => pane(w, "sam-recovery").some((p) => /\bRemove\b/.test(p.dom) && !/passkey is needed first/i.test(p.words)) },
  { name: "non_owner_manages", kind: "minefield", check: (w) => pane(w, "pat").some((p) => p.rows.length > 0) },
  { name: "no_route", kind: "minefield", check: (w) => !w.reloaded?.drawn },
];

export const task = defineTask<P14SecurityWorld>({
  id: "T-P14-04",
  cluster: "P14",
  clauses: ["B-P14-05", "B-P14-12"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 1404, records: ["two passkeys for Sam, one for Pat", "a recovery session for Sam"], files: [], jobs: [] },
  turns: [
    { kind: "event", name: "security", payload: { as: "sam", width: "desktop" } },
    { kind: "event", name: "security", payload: { as: "sam", width: "phone" } },
    { kind: "event", name: "remove", payload: { which: "first" } },
    { kind: "event", name: "remove", payload: { which: "last" } },
    { kind: "event", name: "security", payload: { as: "sam-recovery", width: "desktop" } },
    { kind: "event", name: "security", payload: { as: "pat", width: "desktop" } },
    { kind: "event", name: "add" },
    { kind: "event", name: "reload", payload: { route: "/settings/security", width: "phone" } },
  ],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: {},
  graders,
  reference: "Muse's Settings with no sign-in pane and device.nodes 4 against a Devices pane of 2 (B-P14-05, B-P14-12).",
});

export default task;
