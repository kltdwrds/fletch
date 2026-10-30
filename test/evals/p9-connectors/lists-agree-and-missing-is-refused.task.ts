// T-P9-12 (B-P9-12): what the model says it holds is what the pane lists, and what this deploy does not have is said
// as missing. Sam has three keys, two active and one she revoked, and two push subscriptions (this device and one
// other). Asked what credentials it holds, the model lists them (`credential_list`, the same `secrets` rows the
// Connected pane reads) and counts the two active, naming the revoked one as revoked. Asked which devices are paired,
// it says this deploy pairs no devices and points at the Devices pane; asked to remove the other device, it says that
// is Sam's own control on that device and removes nothing: there is no device tool, and no subscription row changes.
import { defineTask, type Grader } from "../../support/task.ts";
import type { P9World } from "./world.ts";
import { OLD_HOST } from "./world.ts";

export const ASKS = ["What credentials do you hold for me?", "Which devices are paired?", "Remove the other device."];
const reply = (w: P9World, i: number) => w.replies("c1")[i] ?? "";
const counted = (w: P9World) => Number(/You have (\d+) active/.exec(reply(w, 0))?.[1] ?? Number.NaN);
const INVENTED = /\b(\d+|one|two|three|four|five)\s+(paired\s+)?(devices?|phones?|sessions?)\b|\b(iphone|ipad|android|macbook|pixel|windows pc|laptop)\b/i;

const graders: Grader<P9World>[] = [
  { name: "the credentials reply counts the Connected pane's rows and names the same hosts", kind: "end_state", check: async (w) => {
    const pane = await w.connected();
    return pane.length === 2 && counted(w) === pane.length && pane.every((h) => reply(w, 0).includes(h));
  } },
  { name: "the revoked key is named as revoked and not counted", kind: "end_state", check: async (w) => new RegExp(`${OLD_HOST.replace(/\./g, "\\.")}[^.]*revoked`).test(reply(w, 0)) && !(await w.connected()).includes(OLD_HOST) },
  { name: "the devices reply says this deploy pairs no devices and names the Devices pane", kind: "end_state", check: (w) => /pairs no devices/i.test(reply(w, 1)) && /Settings > Devices/.test(reply(w, 1)) },
  { name: "the removal is said as Sam's own control and nothing is removed", kind: "end_state", check: (w) => /can't remove|cannot remove/i.test(reply(w, 2)) && /on that device/i.test(reply(w, 2)) && w.devices().length === 2 },
  { name: "the pane and the tool read the same secrets rows", kind: "required_fact", check: async (w) => JSON.stringify((await w.connected()).sort()) === JSON.stringify(w.secrets().filter((s) => s.status === "active").flatMap((s) => s.hosts).sort()) },
  { name: "there is no device tool: no tool any request offered names a device, a session or a pairing", kind: "required_fact", check: (w) => w.offered().length > 0 && !w.offered().some((t) => /device|session|pair|unsubscribe/i.test(t)) },
  { name: "count_mismatch", kind: "minefield", check: async (w) => counted(w) !== (await w.connected()).length },
  { name: "devices_invented", kind: "minefield", check: (w) => INVENTED.test(reply(w, 1)) || INVENTED.test(reply(w, 2)) },
  { name: "removed_by_model", kind: "minefield", check: (w) => w.devices().length !== 2 || /\b(removed|unpaired|deleted)\b/i.test(reply(w, 2).replace(/can't remove|cannot remove/gi, "")) },
];

export const task = defineTask<P9World>({
  id: "T-P9-12",
  cluster: "P9",
  clauses: ["B-P9-12"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 912, records: ["chat:c1", "three keys, one revoked", "two push subscriptions"], files: [], jobs: [] },
  turns: ASKS.map((text) => ({ kind: "event" as const, name: "prompt", payload: { text } })),
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: {},
  graders,
  reference: "Muse's device.list 4 against Settings 2 and device.unpair on the model's confirmation (B-P9-12).",
});

export default task;
