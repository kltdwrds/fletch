// F1: the VAPID JWT a self-host deploy signs for a push service names the deploy's own owner as its contact
// (`sub: mailto:<OWNER_EMAIL>`, RFC 8292 section 2.1), never another party's. Run on the production `Vault` object
// with the test host's key service over a fixture master key.
import { describe, expect, it } from "vitest";
import { vapidClaims, vapidSubject } from "../../packages/agent/src/delivery/webpush.ts";
import { Vault } from "../../packages/agent/src/objects/vault.ts";
import { ObjectHarness } from "../support/object-harness.ts";
import people from "../fixtures/people.json" with { type: "json" };

const sam = people.people[0] as (typeof people.people)[number];
const MASTER_KEY = Buffer.alloc(32, 7).toString("base64url");
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/f1-vapid";

/** The claims of an `Authorization: vapid t=<jwt>, k=<key>` header. */
const claimsOf = (header: string) => JSON.parse(Buffer.from((header.match(/t=([^.]+)\.([^.]+)\./)?.[2] ?? ""), "base64url").toString()) as Record<string, unknown>;

describe("[F1] the VAPID contact is the deploy's owner", () => {
  it("the Vault signs sub = mailto:<OWNER_EMAIL>, with the endpoint's origin as aud", async () => {
    const h = new ObjectHarness("vault", (ctx, e) => new Vault(ctx as never, e as never), { TENANT_ID: sam.company, OWNER_EMAIL: sam.email, MASTER_KEY });
    const auth = await h.instance.pushAuthorization(ENDPOINT);
    if (!auth.ok) throw new Error(`not signed: ${auth.code}`);
    const claims = claimsOf(auth.header);
    expect(claims).toMatchObject({ aud: "https://fcm.googleapis.com", sub: `mailto:${sam.email}` });
    expect(JSON.stringify(claims)).not.toContain("qyvr.ai");
  });

  it("with no owner address the claim is left out rather than filled with another contact", () => {
    expect(vapidSubject("")).toBeUndefined();
    expect(vapidSubject(undefined)).toBeUndefined();
    expect(vapidSubject("not an address")).toBeUndefined();
    const { claims } = vapidClaims(new URL(ENDPOINT), 0, vapidSubject(""));
    expect(Object.keys(JSON.parse(Buffer.from(claims, "base64url").toString()))).toEqual(["aud", "exp"]);
  });
});
