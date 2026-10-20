// F1: a host without mail, workspace, provisioning, members or render. Each object asks `hostOf(env)` and,
// where the host refuses a feature, says so with the feature's code and reason: nothing is shown as sent,
// requested, synced or read when it was not. The budget is null on such a host, so the Ledger writes its
// row and reports to no one.
import { describe, expect, it } from "vitest";
import { unavailable } from "@qyvr/host";
import { attachmentDeps } from "../../packages/agent/src/attachments/wiring.ts";
import { Company } from "../../packages/agent/src/objects/company.ts";
import { Ledger } from "../../packages/agent/src/objects/ledger.ts";
import { Person } from "../../packages/agent/src/objects/person.ts";
import type { ModelCallRow } from "../../packages/agent/src/ledger/types.ts";
import people from "../fixtures/people.json" with { type: "json" };
import { ObjectHarness } from "../support/object-harness.ts";
import type { TestHostOverrides } from "../support/host.ts";
import { asBucket, FakeR2 } from "./support/fake-r2.ts";

const sam = people.people[0] as (typeof people.people)[number];
const TENANT = "solo-sam";
const T0 = Date.UTC(2026, 9, 20, 9);

/** Every optional feature refused, as a self-host deploy refuses it; the budget null. */
const bare: TestHostOverrides = {
  mail: unavailable("mail", "mail is not part of this host"),
  workspace: unavailable("workspace", "workspace is not part of this host"),
  provisioning: unavailable("provisioning", "provisioning is not part of this host"),
  members: unavailable("members", "members is not part of this host"),
  render: unavailable("render", "render is not part of this host"),
  budget: null,
  memberSeed: JSON.stringify([{ email: sam.email, role: "owner", name: sam.name }]),
};
const env = (extra: Record<string, unknown> = {}) => ({ TENANT_ID: TENANT, TENANT_SHAPE: "standalone", QYVR_ENV: "self-host", HOST: bare, ...extra });

describe("[F1] a host without mail, workspace, render", () => {
  it("Person.sendMail refuses HOST_MAIL_UNAVAILABLE with the host's reason", async () => {
    const h = new ObjectHarness(sam.email, (ctx, e) => new Person(ctx as never, e as never), env());
    const r = await h.instance.sendMail(sam.email, { to: sam.email, subject: "s", text: "t", chatId: "c" });
    expect(r).toEqual({ ok: false, code: "HOST_MAIL_UNAVAILABLE", reason: "mail is not part of this host" });
  });

  it("the Company's workspace request refuses HOST_PROVISIONING_UNAVAILABLE, and its Access resync HOST_MEMBERS_UNAVAILABLE", async () => {
    const h = new ObjectHarness("company", (ctx, e) => new Company(ctx as never, e as never), env());
    expect(await h.instance.onboardingRequestWorkspace(sam.email)).toMatchObject({ ok: false, code: "HOST_PROVISIONING_UNAVAILABLE", reason: "provisioning is not part of this host" });
    expect(await h.instance.resyncAccess(sam.email)).toMatchObject({ ok: false, code: "HOST_MEMBERS_UNAVAILABLE", reason: "members is not part of this host" });
  });

  it("an attachment ingest of a .docx refuses HOST_RENDER_UNAVAILABLE; a .txt and a .png still ingest", async () => {
    const r2 = new FakeR2();
    const h = new ObjectHarness(sam.email, (ctx, e) => ({ deps: attachmentDeps(e as never, (ctx as DurableObjectState).storage, sam.email) }), env({ AGENT_BUCKET: asBucket(r2), LEDGER: { idFromName: (n: string) => ({ name: n }), get: () => ({}) } }));
    const ingest = (name: string, mime: string, bytes: Uint8Array) => h.instance.deps.ingest({ owner: sam.email, attachmentId: `a-${name}`, name, mime, bytes });
    const docx = await ingest("plan.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", new Uint8Array([0x50, 0x4b, 3, 4]));
    expect(docx).toMatchObject({ ok: false, code: "HOST_RENDER_UNAVAILABLE" });
    expect(await ingest("notes.txt", "text/plain", new TextEncoder().encode("the harbor review is on Thursday"))).toMatchObject({ ok: true, kind: "text" });
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect(await ingest("photo.png", "image/png", png)).toMatchObject({ ok: true, kind: "image" });
  });

  it("Ledger.record with a null budget writes the row and reports to no one", async () => {
    const reports: unknown[] = [];
    // A staging env with a BUDGET binding, as the platform's was: the Ledger now reads only the host's budget, which is null.
    const h = new ObjectHarness("ledger", (ctx, e) => new Ledger(ctx as never, e as never), env({ QYVR_ENV: "staging", BUDGET: { report: async (...a: unknown[]) => void reports.push(a), check: async () => ({ ok: true }) } }));
    const row: ModelCallRow = {
      tenant: TENANT, person: sam.email, runId: "r1", route: "chat", model: "m", provider: null, attempt: 0, status: "ok", code: null, httpStatus: 200,
      inputTokens: 10, outputTokens: 5, reasoningTokens: 0, cachedTokens: 0, at: T0, startedAt: T0, firstTokenAt: T0, finishedAt: T0,
    };
    await h.instance.record(row);
    expect(h.rows("SELECT person, run_id, input_tokens FROM model_calls")).toEqual([{ person: sam.email, run_id: "r1", input_tokens: 10 }]);
    expect(reports).toEqual([]);
    expect(await h.instance.admit({ person: sam.email, runId: "r2" })).toMatchObject({ ok: true });
  });
});
