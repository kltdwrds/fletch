// covers: M8
// Credential redaction (acceptance-checks.md, M8; M3.2's share): 20 chat turns, each with its own
// seeded GitHub token in Ada's tenant Vault, a vendor that echoes the token back, and the fake model
// loading the github namespace and calling both tools. The value may appear only in the Vault's
// ciphertext (sealed, so not in the clear) and in the request the egress module sends to
// api.github.com; it must appear in none of: model messages and tool arguments (the fake's request
// bodies), the chat transcript and outbox, the Ledger, the Vault's other rows and audit, the frames
// on the socket, captured console output, or any outbound URL.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatEngine, type EngineCtx } from "../../packages/agent/src/chat/engine.ts";
import { egressFor } from "../../packages/agent/src/connectors/egress.ts";
import { Ledger } from "../../packages/agent/src/objects/ledger.ts";
import { FakeModel } from "../support/fake-model.ts";
import { harnessNamespace, ObjectHarness } from "../support/object-harness.ts";
import { FIXTURE_REPO, seededToken, vendors } from "../support/vendors/index.ts";
import { asPerson, keysFor, testMasterKey, vaultHarness } from "../workers/support/vault-harness.ts";
import people from "../fixtures/people.json" with { type: "json" };

const ada = people.people.find((p) => p.id === "sam-solo")!;
const RUNS = 20;

let logs: string[] = [];
beforeEach(() => {
  logs = [];
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logs.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    });
  }
});
afterEach(() => vi.restoreAllMocks());

/** Every row of every table in a harness's database, as one string. */
function dump<T extends object>(h: ObjectHarness<T>, skip: (table: string, column: string) => boolean = () => false): string {
  const tables = h.rows("SELECT name FROM sqlite_master WHERE type = 'table'").map((r) => String(r.name));
  const out: unknown[] = [];
  for (const t of tables) {
    for (const row of h.rows(`SELECT * FROM "${t}"`)) {
      out.push(Object.fromEntries(Object.entries(row).filter(([c]) => !skip(t, c)).map(([c, v]) => [c, v instanceof Uint8Array ? new TextDecoder().decode(v) : v])));
    }
  }
  return JSON.stringify(out);
}

async function oneRun(i: number) {
  const token = seededToken();
  const net = vendors({ githubToken: token, hostile: true });
  const v = vaultHarness({ tenant: ada.company, keys: keysFor(ada.company, testMasterKey()), fetch: net, name: `vault-${i}` });
  expect(await v.vault.capture({ ref: "cred://github", value: token, hosts: ["api.github.com"] }, asPerson(ada.email))).toMatchObject({ ok: true });

  const fake = new FakeModel([
    { toolCall: { name: "tool_search", arguments: { load: ["github"] } } },
    { toolCall: { name: "github_repo", arguments: { repo: FIXTURE_REPO } } },
    { toolCall: { name: "github_issues", arguments: { repo: FIXTURE_REPO, limit: 2 } } },
    { text: "The repository has two open issues." },
  ]);
  const ledgers = harnessNamespace((name) => new ObjectHarness(name, (ctx, env) => new Ledger(ctx as DurableObjectState, env as Env), {}));
  const env = { TENANT_ID: ada.company, TENANT_SHAPE: "company", QYVR_ENV: "staging", AI: fake.binding, LEDGER: ledgers.binding };
  const chat = new ObjectHarness(`chat-${i}`, (ctx, e) => new ChatEngine(ctx as EngineCtx, e as Env, { egress: (person) => egressFor(v.vault, person) }), env, (c) => {
    c.wait = async () => {};
  });
  const socket = chat.connect();
  const result = await chat.instance.send({ person: ada.email, text: `What is open on ${FIXTURE_REPO}?` });
  return { token, net, v, fake, ledgers, chat, socket, result };
}

describe("[M3.2] credential redaction", () => {
  it("20 runs with a seeded value: 0 occurrences outside the Vault's ciphertext and the egress module's request, across every sink", async () => {
    for (let i = 0; i < RUNS; i++) {
      const r = await oneRun(i);
      expect(r.result).toMatchObject({ status: "done" });
      // The tools ran against the vendor, which echoed the token in its body, a header and an issue title.
      const github = r.net.requests.filter((q) => q.url.startsWith("https://api.github.com/"));
      expect(github).toHaveLength(2);
      expect(github.map((q) => q.headers.authorization)).toEqual([`Bearer ${r.token}`, `Bearer ${r.token}`]);
      const toolResults = JSON.stringify(r.fake.requests.at(-1)?.inputs.messages);
      expect(toolResults).toContain("Fictional ledger tooling");
      expect(toolResults).toContain("[redacted cred://github]");

      const sinks: Record<string, string> = {
        "model messages, tool arguments and request bodies": JSON.stringify(r.fake.requests),
        "chat transcript, turns and outbox": dump(r.chat),
        ledger: dump(r.ledgers.harness(ada.company)),
        "vault rows other than the sealed value": dump(r.v.harness, (t, c) => t === "secrets" && c === "ct"),
        "socket frames": JSON.stringify(r.socket.frames),
        "captured logs": logs.join("\n"),
        "outbound URLs": JSON.stringify(r.net.requests.map((q) => q.url)),
        "headers sent anywhere but the credential's own header": JSON.stringify(r.net.requests.map((q) => ({ ...q.headers, authorization: q.url.startsWith("https://api.github.com/") ? "" : q.headers.authorization }))),
      };
      for (const [sink, text] of Object.entries(sinks)) expect({ sink, leaked: text.includes(r.token) }).toEqual({ sink, leaked: false });
      // The sealed value is ciphertext: it is not the token in the clear either.
      const ct = r.v.harness.rows("SELECT ct FROM secrets")[0]!.ct as Uint8Array;
      expect(new TextDecoder().decode(ct).includes(r.token)).toBe(false);
    }
  });

  it("the redaction is the guard: the same hostile vendor read without the egress module hands the token to the model", async () => {
    const token = seededToken();
    const net = vendors({ githubToken: token, hostile: true });
    const raw = await net(`https://api.github.com/repos/${FIXTURE_REPO}`, { headers: { authorization: `Bearer ${token}` } });
    expect(await raw.text()).toContain(token);
  });
});
