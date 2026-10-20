import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fromB64u } from "@qyvr/host-cloudflare";
import { afterEach, describe, expect, it } from "vitest";
import { type FakeAccount, fakeAccount, fakeCloudflare } from "../../host-cloudflare/test/fake-cloudflare.ts";
import { parseArgs } from "../src/args.ts";
import { type DeployRunner, type InitOptions, init, parseJsonc } from "../src/init.ts";

const ACCOUNT = "0123456789abcdef0123456789abcdef";
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A fake `wrangler deploy`: reads the written config and deploys its script into the fake account. */
function fakeWrangler(account: FakeAccount, fail: boolean | string = false) {
  const runs: { configPath: string; env: Record<string, string> }[] = [];
  const deploy: DeployRunner = async (configPath, env) => {
    runs.push({ configPath, env });
    if (fail) return { ok: false, output: typeof fail === "string" ? fail : "✘ [ERROR] A request to the Cloudflare API failed." };
    const config = parseJsonc(readFileSync(configPath, "utf8")) as { name: string };
    if (!account.scripts.has(config.name)) account.scripts.set(config.name, new Map());
    return { ok: true, output: `Uploaded ${config.name}` };
  };
  return { deploy, runs };
}

function setup(account = fakeAccount(), opts: Partial<InitOptions> = {}, failDeploy: boolean | string = false) {
  const cwd = mkdtempSync(join(tmpdir(), "create-fletch-"));
  dirs.push(cwd);
  const cf = fakeCloudflare(account);
  const wrangler = fakeWrangler(account, failDeploy);
  const lines: string[] = [];
  const options: InitOptions = { accountId: ACCOUNT, token: "test-token", name: "sam", ownerEmail: "sam@solo-sam.example", paid: false, cwd, ...opts };
  const run = () => init(options, { fetch: cf.fetch, deploy: wrangler.deploy, log: (l) => lines.push(l), agentMain: "/checkout/packages/agent/src/index.ts" });
  const config = () => parseJsonc(readFileSync(join(cwd, "wrangler.jsonc"), "utf8")) as Record<string, any>;
  return { cwd, cf, wrangler, lines, run, config, account };
}

const URL_ = "https://sam.sam-example.workers.dev";
const creates = (s: ReturnType<typeof setup>) => s.cf.writes().filter((c) => c.method === "POST");
const secretPuts = (s: ReturnType<typeof setup>) => s.cf.writes().filter((c) => c.method === "PUT" && c.path.endsWith("/secrets"));

describe("[F1] create-fletch init", () => {
  it("on a fresh account makes one bucket, one index, one deploy, and sets MASTER_KEY and SETUP_TOKEN once each", async () => {
    const s = setup();
    expect(await s.run()).toEqual({ ok: true, url: URL_ });
    expect(creates(s).map((c) => c.path)).toEqual([`/accounts/${ACCOUNT}/r2/buckets`, `/accounts/${ACCOUNT}/vectorize/v2/indexes`]);
    expect(s.account.buckets).toEqual(new Set(["sam-agent"]));
    expect([...s.account.indexes.keys()]).toEqual(["sam-memory"]);
    expect(s.wrangler.runs).toHaveLength(1);
    expect(secretPuts(s).map((c) => (c.body as { name: string }).name)).toEqual(["MASTER_KEY", "SETUP_TOKEN"]);
    const secrets = s.account.scripts.get("sam")!;
    expect(fromB64u(secrets.get("MASTER_KEY")!)?.byteLength).toBe(32);
    expect(fromB64u(secrets.get("SETUP_TOKEN")!)?.byteLength).toBe(32);
    expect(s.lines).toContain(`${URL_}/login?setup=${secrets.get("SETUP_TOKEN")}`);
  });

  it("a second run with the same inputs creates nothing, puts no secret, and returns the same URL", async () => {
    const s = setup();
    await s.run();
    const before = new Map(s.account.scripts.get("sam"));
    const writes = s.cf.writes().length;
    s.lines.length = 0;
    expect(await s.run()).toEqual({ ok: true, url: URL_ });
    expect(s.cf.writes()).toHaveLength(writes);
    expect(s.account.scripts.get("sam")).toEqual(before);
    expect(s.lines.join("\n")).not.toContain("setup=");
    expect(s.lines.join("\n")).toMatch(/already/);
    expect(s.lines).toContain(URL_);
  });

  it("a token missing R2 refuses with TOKEN_SCOPE_MISSING naming R2, before any write or deploy", async () => {
    const s = setup(fakeAccount({ scopes: new Set(["Workers Scripts", "Vectorize", "Workers AI"]) }));
    const r = await s.run();
    expect(r).toMatchObject({ ok: false, code: "TOKEN_SCOPE_MISSING" });
    expect(r.ok === false && r.reason).toMatch(/\bR2\b/);
    expect(r.ok === false && r.reason).not.toMatch(/Vectorize/);
    expect(s.wrangler.runs).toHaveLength(0);
    expect(s.cf.writes()).toHaveLength(0);
    expect(existsSync(join(s.cwd, "wrangler.jsonc"))).toBe(false);
  });

  it("a token neither verify endpoint accepts refuses with TOKEN_INVALID", async () => {
    const s = setup(fakeAccount({ kind: "invalid" }));
    expect(await s.run()).toMatchObject({ ok: false, code: "TOKEN_INVALID" });
    expect(s.wrangler.runs).toHaveLength(0);
  });

  it("an account token is accepted", async () => {
    expect(await setup(fakeAccount({ kind: "account" })).run()).toEqual({ ok: true, url: URL_ });
  });

  it("writes the deploy's wrangler.jsonc: name, account, bucket, index, owner and tenant, and no secret", async () => {
    const s = setup();
    await s.run();
    const c = s.config();
    expect(c).toMatchObject({ name: "sam", account_id: ACCOUNT, workers_dev: true, compatibility_date: "2026-10-01" });
    expect(c.r2_buckets).toEqual([{ binding: "AGENT_BUCKET", bucket_name: "sam-agent" }]);
    expect(c.vectorize).toEqual([{ binding: "MEMORY_INDEX", index_name: "sam-memory" }]);
    expect(c.vars).toEqual({ TENANT_ID: "sam", TENANT_SHAPE: "standalone", QYVR_ENV: "self-host", OWNER_EMAIL: "sam@solo-sam.example" });
    expect(c.worker_loaders).toBeUndefined();
    expect(c.images).toBeUndefined();
    expect(c.main).toMatch(/packages\/agent\/src\/index\.ts$/);
    const text = readFileSync(join(s.cwd, "wrangler.jsonc"), "utf8");
    const secrets = s.account.scripts.get("sam")!;
    for (const v of [...secrets.values(), "test-token"]) expect(text).not.toContain(v);
    expect(text).not.toMatch(/MASTER_KEY"|SETUP_TOKEN"/);
    expect(s.wrangler.runs[0]).toMatchObject({ configPath: join(s.cwd, "wrangler.jsonc"), env: { CLOUDFLARE_API_TOKEN: "test-token", CLOUDFLARE_ACCOUNT_ID: ACCOUNT } });
  });

  it("--paid adds the Worker Loader and Images bindings", async () => {
    const s = setup(fakeAccount(), { paid: true });
    await s.run();
    expect(s.config().worker_loaders).toEqual([{ binding: "LOADER" }]);
    expect(s.config().images).toEqual({ binding: "IMAGES" });
  });

  it("never prints the token or the master key", async () => {
    const s = setup();
    await s.run();
    const out = s.lines.join("\n");
    expect(out).not.toContain("test-token");
    expect(out).not.toContain(s.account.scripts.get("sam")!.get("MASTER_KEY"));
  });

  it("an existing MASTER_KEY is kept; only the missing SETUP_TOKEN is minted and its link printed", async () => {
    const s = setup(fakeAccount({ scripts: new Map([["sam", new Map([["MASTER_KEY", "kept"]])]]) }));
    await s.run();
    expect(secretPuts(s).map((c) => (c.body as { name: string }).name)).toEqual(["SETUP_TOKEN"]);
    expect(s.account.scripts.get("sam")!.get("MASTER_KEY")).toBe("kept");
    expect(s.lines.some((l) => l.startsWith(`${URL_}/login?setup=`))).toBe(true);
  });

  it.each([
    ["a name that is not a tenant id", { name: "Sam_1" }, "NAME_INVALID"],
    ["a one-letter name", { name: "s" }, "NAME_INVALID"],
    ["a missing owner email", { ownerEmail: "" }, "OWNER_EMAIL_INVALID"],
    ["a malformed owner email", { ownerEmail: "sam at example" }, "OWNER_EMAIL_INVALID"],
    ["an account id that is not 32 hex", { accountId: "acct" }, "ACCOUNT_ID_INVALID"],
    ["a missing token", { token: "" }, "TOKEN_MISSING"],
  ] as const)("[F1] refuses %s before any call", async (_label, over, code) => {
    const s = setup(fakeAccount(), over);
    expect(await s.run()).toMatchObject({ ok: false, code });
    expect(s.cf.calls).toHaveLength(0);
  });

  it("an account with no workers.dev subdomain refuses before the deploy", async () => {
    const s = setup(fakeAccount({ subdomain: null }));
    expect(await s.run()).toMatchObject({ ok: false, code: "WORKERS_DEV_SUBDOMAIN_MISSING" });
    expect(s.wrangler.runs).toHaveLength(0);
  });

  it("a failed deploy refuses with DEPLOY_FAILED and sets no secret", async () => {
    const s = setup(fakeAccount(), {}, true);
    const r = await s.run();
    expect(r).toMatchObject({ ok: false, code: "DEPLOY_FAILED" });
    expect(r.ok === false && r.reason).toContain("A request to the Cloudflare API failed");
    expect(secretPuts(s)).toHaveLength(0);
  });

  it.each([
    ["R2", "R2"],
    ["Vectorize", "Vectorize"],
  ] as const)("a token that reads but cannot create %s (403 on the create) refuses with TOKEN_SCOPE_MISSING naming it", async (scope, word) => {
    const s = setup(fakeAccount({ readOnly: new Set([scope]) }));
    const r = await s.run();
    expect(r).toMatchObject({ ok: false, code: "TOKEN_SCOPE_MISSING" });
    expect(r.ok === false && r.reason).toContain(word);
    expect(s.wrangler.runs).toHaveLength(0);
  });

  it("a deploy refused with 403 maps to TOKEN_SCOPE_MISSING naming Workers Scripts, and sets no secret", async () => {
    const s = setup(fakeAccount(), {}, "✘ [ERROR] A request to the Cloudflare API (/accounts/x/workers/scripts/sam) failed.\n  Authentication error [code: 10000]");
    const r = await s.run();
    expect(r).toMatchObject({ ok: false, code: "TOKEN_SCOPE_MISSING" });
    expect(r.ok === false && r.reason).toContain("Workers Scripts");
    expect(secretPuts(s)).toHaveLength(0);
  });

  it("refuses with INIT_CONFIG_EXISTS, before any call, over a wrangler.jsonc create-fletch did not write", async () => {
    const s = setup();
    writeFileSync(join(s.cwd, "wrangler.jsonc"), '{ "name": "mine" }\n');
    expect(await s.run()).toMatchObject({ ok: false, code: "INIT_CONFIG_EXISTS" });
    expect(s.cf.calls).toHaveLength(0);
    expect(s.wrangler.runs).toHaveLength(0);
    expect(readFileSync(join(s.cwd, "wrangler.jsonc"), "utf8")).toBe('{ "name": "mine" }\n');
  });

  it("overwrites a wrangler.jsonc that carries create-fletch's header (the second run)", async () => {
    const s = setup();
    await s.run();
    expect(await s.run()).toEqual({ ok: true, url: URL_ });
  });

  it("fills the template with literal values: $& and $1 in the email or the path stay as typed", async () => {
    const email = ["sam+$&$1", "solo-sam.example"].join("@");
    const s = setup(fakeAccount(), { ownerEmail: email });
    const options: InitOptions = { accountId: ACCOUNT, token: "test-token", name: "sam", ownerEmail: email, paid: false, cwd: s.cwd };
    const r = await init(options, { fetch: s.cf.fetch, deploy: s.wrangler.deploy, log: () => {}, agentMain: `${s.cwd}/co$&ck/agent/src/index.ts` });
    expect(r).toEqual({ ok: true, url: URL_ });
    expect(s.config().vars.OWNER_EMAIL).toBe(email);
    expect(s.config().main).toBe("co$&ck/agent/src/index.ts");
  });

  it("an error with no HTTP status (a missing directory) is INIT_FAILED, not CLOUDFLARE_API_ERROR", async () => {
    const s = setup(fakeAccount(), { cwd: "/nonexistent-create-fletch-dir/x" });
    const r = await s.run();
    expect(r).toMatchObject({ ok: false, code: "INIT_FAILED" });
    expect(r.ok === false && r.reason).toMatch(/ENOENT/);
  });

  it("a Cloudflare API error with a status other than 403 stays CLOUDFLARE_API_ERROR", async () => {
    const s = setup(fakeAccount({ subdomain: null }));
    const bad = (async () => Response.json({ success: false, errors: [{ code: 7003, message: "boom" }] }, { status: 500 })) as typeof globalThis.fetch;
    const r = await init({ accountId: ACCOUNT, token: "test-token", name: "sam", ownerEmail: "sam@solo-sam.example", paid: false, cwd: s.cwd }, { fetch: bad, deploy: s.wrangler.deploy, log: () => {} });
    expect(r).toMatchObject({ ok: false, code: "CLOUDFLARE_API_ERROR" });
  });

  it("a memory index of another shape refuses with MEMORY_INDEX_SHAPE before the deploy", async () => {
    const s = setup(fakeAccount({ indexes: new Map([["sam-memory", { dimensions: 384, metric: "cosine" }]]) }));
    expect(await s.run()).toMatchObject({ ok: false, code: "MEMORY_INDEX_SHAPE" });
    expect(s.wrangler.runs).toHaveLength(0);
  });
});

describe("[F1] create-fletch template", () => {
  it("matches packages/agent/wrangler.jsonc on everything the agent declares", () => {
    const read = (p: string) => parseJsonc(readFileSync(join(dirname(fileURLToPath(import.meta.url)), p), "utf8")) as Record<string, unknown>;
    const agent = read("../../agent/wrangler.jsonc");
    const template = read("../src/template/wrangler.jsonc");
    for (const key of ["compatibility_date", "compatibility_flags", "durable_objects", "exports", "ai", "observability"]) expect(template[key], key).toEqual(agent[key]);
    expect(Object.keys(template.vars as object).toSorted()).toEqual(Object.keys(agent.vars as object).toSorted());
    expect(template.services).toBeUndefined();
  });
});

describe("[F1] create-fletch arguments", () => {
  it("reads flags, and the token and account from the environment only", () => {
    const env = { CLOUDFLARE_API_TOKEN: "test-token", CLOUDFLARE_ACCOUNT_ID: ACCOUNT };
    expect(parseArgs(["--name", "sam", "--owner-email=sam@solo-sam.example", "--paid", "--dir", "/tmp/x"], env, "/here")).toEqual({
      ok: true,
      opts: { name: "sam", ownerEmail: "sam@solo-sam.example", paid: true, cwd: "/tmp/x", token: "test-token", accountId: ACCOUNT },
    });
  });

  it("leaves out what was not given, so the bin prompts for it", () => {
    expect(parseArgs([], {}, "/here")).toEqual({ ok: true, opts: { paid: false, cwd: "/here" } });
  });

  it("a --account-id flag overrides the environment", () => {
    const r = parseArgs(["--account-id", "abc"], { CLOUDFLARE_ACCOUNT_ID: ACCOUNT }, "/here");
    expect(r.ok && r.opts.accountId).toBe("abc");
  });

  it("refuses an unknown flag, a flag with no value, and a token on the command line", () => {
    expect(parseArgs(["--nope"], {}, "/here")).toMatchObject({ ok: false });
    expect(parseArgs(["--name"], {}, "/here")).toMatchObject({ ok: false });
    expect(parseArgs(["--token", "x"], {}, "/here")).toMatchObject({ ok: false, reason: expect.stringMatching(/CLOUDFLARE_API_TOKEN/) });
  });
});
