// F36 (P9 delta 1): a setup the person never submitted is theirs to end. Dismiss, from the page's own origin, voids
// that link: it opens no form (`VAULT_REF_INVALID`) and its submit saves nothing; a later ask for the same name gives a
// new link that works. A setup already entered, a forged setup id and another origin are refused; Pat's dismissal of a
// setup under the same name is Pat's alone. Run over the tenant's real `VaultCore` and the app's routes.
import { describe, expect, it } from "vitest";
import { credentialsNamespace } from "../../packages/agent/src/vault/tools.ts";
import people from "../fixtures/people.json" with { type: "json" };
import { ada, vaultWorld } from "./support/vault-world.ts";

const pat = people.people.find((p) => p.id === "pat-solo")!;
const HOST = "api.example.com";

/** The link `credential_request` gives, as its path and query. */
async function asked(w: ReturnType<typeof vaultWorld>, name = "example-api") {
  const ns = credentialsNamespace({ list: async () => w.vault().list(ada.email) });
  const out = await ns.tools[1]!.execute("q1", { host: HOST, name } as never);
  const link = /\/vault\/capture\?\S+/.exec(out.content.map((c) => ("text" in c ? c.text : "")).join(""))?.[0] ?? "";
  return { link, setup: new URL(link, "https://x.example").searchParams.get("setup") ?? "" };
}
const form = (link: string, value: string) => ({ ...Object.fromEntries(new URL(link, "https://x.example").searchParams), value, methods: "GET" });
const state = async (w: ReturnType<typeof vaultWorld>, as: string, setup: string) => JSON.parse((await w.http(as, "GET", `/vault/capture/state?ref=cred%3A%2F%2Fexample-api&setup=${setup}`)).text);

describe("[F36] a setup the person dismisses", () => {
  it("voids that link and its submit, and a new ask gives a link that works", async () => {
    const w = vaultWorld("vault-f36-dismiss");
    const first = await asked(w);
    expect(first.setup).toMatch(/^[0-9a-f]{16}$/);
    expect(await state(w, ada.email, first.setup)).toEqual({ ok: true, state: "pending", at: null });
    expect((await w.http(ada.email, "POST", "/vault/capture/dismiss", { json: { ref: "cred://example-api", setup: first.setup } })).status).toBe(200);
    expect(await state(w, ada.email, first.setup)).toMatchObject({ state: "dismissed", at: w.clock.now });
    const opened = await w.http(ada.email, "GET", first.link);
    expect([opened.status, /<strong>VAULT_REF_INVALID<\/strong>/.test(opened.text), opened.text.includes("<form")]).toEqual([410, true, false]);
    const late = await w.http(ada.email, "POST", "/vault/capture", { form: form(first.link, w.token) });
    expect([late.status, late.text.includes("VAULT_REF_INVALID"), late.text.includes(w.token)]).toEqual([400, true, false]);
    expect(w.vault().list(ada.email)).toEqual([]);
    // A second Dismiss of the same setup is refused: it is no longer waiting.
    expect(JSON.parse((await w.http(ada.email, "POST", "/vault/capture/dismiss", { json: { ref: "cred://example-api", setup: first.setup } })).text)).toMatchObject({ ok: false, code: "VAULT_REF_INVALID" });
    const second = await asked(w);
    expect(second.setup).not.toBe(first.setup);
    expect(await state(w, ada.email, second.setup)).toMatchObject({ state: "pending" });
    expect((await w.http(ada.email, "GET", second.link)).text).toContain("<form");
    expect((await w.http(ada.email, "POST", "/vault/capture", { form: form(second.link, w.token) })).status).toBe(201);
    expect(await state(w, ada.email, second.setup)).toMatchObject({ state: "entered", at: w.clock.now });
    expect(await state(w, ada.email, first.setup)).toMatchObject({ state: "entered" });
  });

  it("refuses an entered setup, a forged setup id and another origin; Pat's dismissal is Pat's alone", async () => {
    const w = vaultWorld("vault-f36-dismiss-guard");
    const { link, setup } = await asked(w);
    const dismiss = (as: string, body: unknown, from?: string | null) => w.http(as, "POST", "/vault/capture/dismiss", { json: body }, from);
    expect((await dismiss(ada.email, { ref: "cred://example-api", setup }, "https://evil.example")).status).toBe(403);
    for (const forged of ["", "not-a-setup", "<script>"]) expect(JSON.parse((await dismiss(ada.email, { ref: "cred://example-api", setup: forged })).text)).toMatchObject({ ok: false, code: "VAULT_REF_INVALID" });
    expect((await dismiss(pat.email, { ref: "cred://example-api", setup })).status).toBe(200);
    expect(await state(w, pat.email, setup)).toMatchObject({ state: "dismissed" });
    expect(await state(w, ada.email, setup)).toMatchObject({ state: "pending" });
    expect((await w.http(ada.email, "POST", "/vault/capture", { form: form(link, w.token) })).status).toBe(201);
    expect(JSON.parse((await dismiss(ada.email, { ref: "cred://example-api", setup })).text)).toMatchObject({ ok: false, code: "VAULT_REF_INVALID" });
    expect(w.vault().list(ada.email).map((c) => c.status)).toEqual(["active"]);
  });
});
