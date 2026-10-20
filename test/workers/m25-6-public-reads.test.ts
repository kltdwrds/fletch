// M25.6: a job reads public sites. Through the tenant's real Vault (the production path), a job's GET or
// HEAD reaches any host the platform policy cap passes, with no credential and no redirect followed; a
// caller that is not a job still reaches only the listed hosts; a credential still needs its registered
// host. The hostile vendor of `vault-world` echoes any authorization it is sent. Ada and Bo of solo-sam.
import { describe, expect, it } from "vitest";
import { ada, SHOP_API, seedShop, vaultWorld } from "./support/vault-world.ts";

const JOB = "job:release-watch";
const read = (w: ReturnType<typeof vaultWorld>, person: string, url: string, purpose = JOB, method = "GET", headers: Array<[string, string]> = []) => w.vault().egress({ url, method, headers }, { person, purpose });

describe("[M25.6] a job reads any public site", () => {
  it("a GET to a host outside PUBLIC_HOSTS that passes the policy cap is fetched with no credential and no redirect followed", async () => {
    const w = vaultWorld();
    expect(await read(w, ada.email, "https://example.com/news")).toMatchObject({ ok: true, status: 200 });
    expect(w.requests).toEqual([{ url: "https://example.com/news", method: "GET", authorization: null, redirect: "manual" }]);
  });

  it("a HEAD is allowed the same way, and any other method is refused with a code and nothing sent", async () => {
    const w = vaultWorld();
    expect(await read(w, ada.email, "https://example.com/", JOB, "HEAD")).toMatchObject({ ok: true });
    for (const method of ["POST", "PUT", "DELETE"]) expect(await read(w, ada.email, "https://example.com/", JOB, method)).toMatchObject({ ok: false, code: "EGRESS_HOST_DENIED" });
    expect(w.requests.map((r) => r.method)).toEqual(["HEAD"]);
  });

  it("a caller that is not a job still reaches only the listed hosts: the same read from a connector or chat is refused", async () => {
    const w = vaultWorld();
    for (const purpose of ["hn_top", "github_repo", "m13_test", "browse_open", "jobs:release-watch", ""]) expect(await read(w, ada.email, "https://example.com/news", purpose)).toMatchObject({ ok: false, code: "EGRESS_HOST_DENIED" });
    expect(w.requests).toEqual([]);
  });

  it("the policy cap holds for a job: an IP literal, a private name, a platform host, http and a port are refused with a code and nothing sent", async () => {
    const w = vaultWorld();
    const refused: Array<[string, string]> = [
      ["https://203.0.113.9/", "EGRESS_HOST_DENIED"],
      ["https://[2001:db8::1]/", "EGRESS_HOST_DENIED"],
      ["https://0x7f000001/", "EGRESS_HOST_DENIED"],
      ["https://printer.local/", "EGRESS_HOST_DENIED"],
      ["https://metadata.internal/", "EGRESS_HOST_DENIED"],
      ["https://tenant.workers.dev/", "EGRESS_HOST_DENIED"],
      ["https://app.qyvr.ai/", "EGRESS_HOST_DENIED"],
      ["http://example.com/", "EGRESS_SCHEME_DENIED"],
      ["https://example.com:8443/", "EGRESS_URL_INVALID"],
      [`https://user:pw${"@"}example.com/`, "EGRESS_URL_INVALID"],
    ];
    for (const [url, code] of refused) expect(await read(w, ada.email, url), url).toMatchObject({ ok: false, code });
    expect(w.requests).toEqual([]);
  });

  it("a refusal says why: the reason names the policy, not only that the host is unlisted", async () => {
    const w = vaultWorld();
    const r = await read(w, ada.email, "https://203.0.113.9/");
    expect(r).toMatchObject({ ok: false, code: "EGRESS_HOST_DENIED", host: "203.0.113.9" });
    expect((r as { reason: string }).reason).toMatch(/IP address/);
  });
});

describe("[M25.6] a credential still needs its registered host", () => {
  it("a job carrying a credential to an unlisted host is refused, and the credential is never resolved", async () => {
    const w = vaultWorld();
    await seedShop(w, "standing");
    expect(await w.vault().egress({ url: "https://example.com/", method: "GET", headers: [["authorization", "Bearer cred://shop-api"]] }, { person: ada.email, purpose: JOB })).toMatchObject({ ok: false, code: "EGRESS_HOST_DENIED" });
    expect(await w.vault().egress({ url: "https://example.com/?k=cred://shop-api", method: "GET" }, { person: ada.email, purpose: JOB })).toMatchObject({ ok: false, code: "EGRESS_HOST_DENIED" });
    expect(w.requests).toEqual([]);
    expect(w.vault().audit().filter((a) => a.outcome === "resolved")).toEqual([]);
  });

  it("a public read of Ada's credentialed host carries no authorization, and her credential rides only a request that names it", async () => {
    const w = vaultWorld();
    await seedShop(w, "standing");
    expect(await read(w, ada.email, `https://${SHOP_API}/orders`)).toMatchObject({ ok: true });
    expect(w.requests.map((r) => r.authorization)).toEqual([null]);
    expect(await w.egress(ada.email, `https://${SHOP_API}/orders`, "cred://shop-api")).toMatchObject({ ok: true });
    expect(w.requests.map((r) => r.authorization)).toEqual([null, `Bearer ${w.token}`]);
  });

  it("two members: Bo's job cannot reach Ada's credentialed host with her credential, and the vendor sees none of it", async () => {
    const w = vaultWorld();
    await seedShop(w, "standing");
    expect(await w.vault().egress({ url: `https://${SHOP_API}/orders`, method: "GET", headers: [["authorization", "Bearer cred://shop-api"]] }, { person: "former-member", purpose: "job:bo-watch" })).toMatchObject({ ok: false, code: "EGRESS_CRED_UNKNOWN" });
    expect(w.requests).toEqual([]);
    expect(JSON.stringify(w.vault().audit())).not.toContain(w.token);
  });
});
