// The tier-1 runs of the P9 tasks that grade F36's surfaces (T-P9-02, 08, 09, 10): each task's script and seed for
// `p9SurfaceHarness`, shared by its `.test.ts` and by `planted-surface.test.ts`. A reply that reports what a tool
// returned is built from the request (`replyFrom`), so the hosts, words and count it names are the tool's; a reply to
// a question no tool answers (what Sam allowed, what a disconnect left) is the words `WORK_WORDS` gives the model.
import { WHAT_REMAINS } from "../../../packages/agent/src/vault/connections.ts";
import { seededToken } from "../../support/vendors/index.ts";
import type { P9HarnessOptions, P9Tier1World } from "./harness.ts";
import { asSam, exampleKey, sam } from "./harness.ts";
import { call, lastResult, load, replyFrom, setupReply } from "./runs.ts";
import { API_HOST, API_REF, LOGIN_HOST, LOGIN_REF, OLD_HOST, OLD_REF, PROBE_API } from "./world.ts";

const ok = <T extends { ok: boolean }>(r: T, what: string): T => {
  if (!r.ok) throw new Error(`P9_SEED_REFUSED: ${what}: ${JSON.stringify(r)}`);
  return r;
};
/** Three reads of the probe with Sam's key, each an audit row (T-P9-09). */
const readThrice = async (w: P9Tier1World) => {
  for (let i = 0; i < 3; i++) ok(await w.vault().egress({ url: PROBE_API, method: "GET", headers: [["authorization", `Bearer ${API_REF}`]] }, { person: sam.email, purpose: "fixture_read" }), "probe read");
};
/** A grant Sam's own agent holds over the fixture's action, naming her key as its resource. */
const naming = (mode: "auto" | "ask", oneShot: boolean) => ({ grantee: { kind: "own-agent" }, subject: { kind: "action-kind", ref: "fixture.create" }, mode, constraints: { resources: ["credential:example-api"] }, ...(oneShot ? { one_shot: true } : {}) });

/** The pane's rows as `credential_list` says them: each reference's host and stored status, and how many. */
const connectedReply = (r: Parameters<Parameters<typeof replyFrom>[0]>[0]) => {
  const lines = lastResult(r).split("\n").filter((l) => /^cred:\/\/\S+ \((secret|login)\)/.test(l));
  const rows = lines.map((l) => `${l.split("; ").at(-1)} (${/\): (\w+);/.exec(l)?.[1]})`);
  return `${lines.length} connections: ${rows.join(" and ")}. An expired key is refused until you reconnect it.`;
};

export const surfaceRuns: Record<string, () => P9HarnessOptions> = {
  "T-P9-02": () => ({
    script: [load("credentials"), call("credential_request", { host: API_HOST, name: "example-api" }, "req1"), setupReply(API_HOST)],
  }),
  "T-P9-08": () => ({
    probe: [200, 401],
    seed: async (w) => {
      ok(await w.vault().capture(exampleKey(), asSam()), "example-api");
      ok(await w.vault().capture(exampleKey(OLD_REF, OLD_HOST), asSam()), "example-old");
      w.vaultH.db.prepare("UPDATE secrets SET expires_at = ? WHERE owner = ? AND ref = ?").run(w.w.clock.now - 86_400_000, sam.email, OLD_REF);
    },
    script: [
      load("credentials"), call("credential_list", {}, "list1"), replyFrom(connectedReply),
      load("fixture"), call("fixture_read", { url: PROBE_API }, "read1"), replyFrom((r) => `The Example API answered: ${lastResult(r).includes("status 200") ? "it read fine" : "it did not answer"}.`),
      call("fixture_read", { url: PROBE_API }, "read2"),
      replyFrom((r) => (/status 401/.test(lastResult(r)) ? `${API_HOST} rejected your key (HTTP 401), so nothing was read. Only you can reconnect it, in Settings > Connectors.` : "It read fine.")),
      call("fixture_read", { url: `https://${OLD_HOST}/p9-probe`, credential: OLD_REF }, "read3"),
      replyFrom((r) => `Refused before anything was sent: ${/(EGRESS|VAULT)_[A-Z_]+/.exec(lastResult(r))?.[0] ?? "no code"}. Your key for ${OLD_HOST} has expired; only you can reconnect it.`),
    ],
  }),
  "T-P9-09": () => ({
    seed: async (w) => {
      ok(await w.vault().capture(exampleKey(), asSam()), "example-api");
      for (let i = 0; i < 2; i++) ok(await w.vault().issueGrant({ ref: API_REF, hosts: [API_HOST], methods: ["GET"], oneShot: true, expiresInMs: 5 * 60_000 }, asSam("settings")), "one-shot grant");
      await w.w.grant(sam.email, naming("auto", false));
      await readThrice(w);
    },
    script: [{ text: `Your key for ${API_HOST} is disconnected. ${WHAT_REMAINS.replace("{host}", API_HOST)} The next call to ${API_HOST} with it is refused.` }],
  }),
  "T-P9-10": () => ({
    seed: async (w) => {
      ok(await w.vault().capture(exampleKey(), asSam()), "example-api");
      ok(await w.vault().capture({ ref: LOGIN_REF, value: seededToken(), kind: "login", hosts: [{ host: LOGIN_HOST, methods: ["GET"], header: "authorization", prefix: "", fills: true }] }, asSam()), "example-login");
      ok(await w.vault().issueGrant({ ref: API_REF, hosts: [API_HOST], methods: ["GET"], oneShot: true, expiresInMs: 5 * 60_000 }, asSam("settings")), "one-shot grant");
      ok(await w.vault().issueGrant({ ref: API_REF, hosts: [API_HOST], methods: ["GET", "POST"], expiresInMs: 30 * 86_400_000 }, asSam("settings")), "standing grant");
      const code = ok(await w.vault().captureOneTimeCode({ person: sam.email, code: "482913", source: "mail" }), "code");
      ok(await w.vault().approveOneTimeCode({ ref: code.ok ? code.ref : "", host: LOGIN_HOST }, asSam("settings")), "code grant");
      const once = await w.w.grant(sam.email, naming("auto", true));
      w.w.personHarness(sam.email)?.db.prepare("UPDATE grants SET used_at = ? WHERE id = ?").run(w.w.clock.now, once.id);
      w.w.clock.now += 60_000;
      await w.w.grant(sam.email, naming("ask", false));
    },
    script: [
      {
        text: [
          "You have allowed 5 things:",
          `- ${API_REF} at ${API_HOST}: GET, POST, until you revoke it (the key's standing grant);`,
          `- ${API_REF} at ${API_HOST}: GET, one use;`,
          `- a one-time code at ${LOGIN_HOST}: fill, one use;`,
          "- fixture.create: asks you first, until you revoke it;",
          "- fixture.create: allowed, one use, already spent.",
          "Settings > Permissions lists the same five; revoke any of them there.",
        ].join("\n"),
      },
    ],
  }),
};
