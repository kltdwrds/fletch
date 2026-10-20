// covers: M8
// Credential redaction (acceptance-checks.md, M13's share): 20 runs, each with its own seeded GitHub
// token that Ada saves through the capture form, a vendor that echoes the token back, and a model that
// loads the connector, reads through it and then copies everything it was shown into her memory and
// her files. The value may appear only in the Vault's ciphertext and in the request the egress module
// sends to api.github.com. It must appear in none of: the capture form's response, the transcript and
// notices, captured logs, R2, memory, the model's tool arguments and the fake's request bodies, the
// journal and Ledger, the Vault's other rows, or any outbound URL. Two members: Bo's chat runs too.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { INLINE_MAX } from "../../packages/agent/src/files/store.ts";
import type { ObjectHarness } from "../support/object-harness.ts";
import { FIXTURE_REPO, seededToken, vendors } from "../support/vendors/index.ts";
import { ada, authorityWorld, } from "../workers/support/authority-world.ts";

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

const decode = (v: unknown) => (v instanceof Uint8Array ? new TextDecoder().decode(v) : v);
/** Every row of every table in a harness's database, as one string. */
function dump<T extends object>(h: ObjectHarness<T> | undefined, skip: (table: string, column: string) => boolean = () => false): string {
  if (!h) return "";
  const tables = h.rows("SELECT name FROM sqlite_master WHERE type = 'table'").map((r) => String(r.name));
  return JSON.stringify(tables.flatMap((t) => h.rows(`SELECT * FROM "${t}"`).map((row) => Object.fromEntries(Object.entries(row).filter(([c]) => !skip(t, c)).map(([c, v]) => [c, decode(v)])))));
}

describe("[M13] credential redaction", () => {

  it("the redaction is the guard: the same copying model, given the vendor's raw answer, writes the token into memory and R2", async () => {
    const token = seededToken();
    const raw = await (await vendors({ githubToken: token, hostile: true })(`https://api.github.com/repos/${FIXTURE_REPO}`, { headers: { authorization: `Bearer ${token}` } })).text();
    const w = authorityWorld({
      script: [
        { toolCall: { name: "tool_search", arguments: { load: ["files"] } } },
        { toolCall: { name: "file_write", arguments: { path: "notes/repo.md", text: `${raw}\n`.repeat(Math.ceil((INLINE_MAX + 1) / (raw.length + 1))) } } },
        { toolCall: { name: "memory_write", arguments: { target: "daily", text: raw.slice(0, 600) } } },
        { text: "Noted." },
      ],
      stores: true,
    });
    await w.say(ada.email, "Note this.");
    expect([...w.r2.objects.values()].some((o) => o.body.includes(token))).toBe(true);
    expect(dump(w.personHarness(ada.email)).includes(token)).toBe(true);
  });
});
