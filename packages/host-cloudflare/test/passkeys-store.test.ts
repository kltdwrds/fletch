import { describe, expect, it } from "vitest";
import { type LoginCall, runLoginCall } from "../src/passkeys/call.ts";
import { PasskeyStore, RecoveryStore, SessionStore } from "../src/passkeys/store.ts";
import { memorySql } from "./sql-adapter.ts";

const DAY = 24 * 3600 * 1000;

function setup() {
  let t = 1_000_000;
  const clock = {
    now: () => t, advance: (ms: number) => {
      t += ms;
    },
  };
  const sql = memorySql();
  return { clock, sql, passkeys: new PasskeyStore(sql, clock.now), sessions: new SessionStore(sql, clock.now), recovery: new RecoveryStore(sql, clock.now) };
}

describe("[F1] passkey stores", () => {
  it("takeChallenge returns the challenge once, then null", () => {
    const { passkeys } = setup();
    passkeys.putChallenge("c1", "abc", "register");
    expect(passkeys.takeChallenge("c1", "register")).toBe("abc");
    expect(passkeys.takeChallenge("c1", "register")).toBeNull();
  });

  it("takeChallenge is null for the wrong kind and for a challenge older than 300 s", () => {
    const { passkeys, clock } = setup();
    passkeys.putChallenge("c1", "abc", "register");
    expect(passkeys.takeChallenge("c1", "authenticate")).toBeNull();
    passkeys.putChallenge("c2", "xyz", "authenticate");
    clock.advance(300_001);
    expect(passkeys.takeChallenge("c2", "authenticate")).toBeNull();
  });

  it("stores, finds, counts, bumps, lists and removes passkeys", () => {
    const { passkeys } = setup();
    expect(passkeys.count()).toBe(0);
    passkeys.add({ id: "k1", email: "Sam@Solo-Sam.example", publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ["internal"] });
    expect(passkeys.count()).toBe(1);
    const found = passkeys.byId("k1");
    expect(found?.email).toBe("sam@solo-sam.example");
    expect(Array.from(found?.publicKey ?? [])).toEqual([1, 2, 3]);
    passkeys.bump("k1", 7);
    expect(passkeys.byId("k1")?.counter).toBe(7);
    expect(passkeys.byId("nope")).toBeNull();
    const listed = passkeys.list();
    expect(listed).toEqual([{ id: "k1", email: "sam@solo-sam.example", at: 1_000_000 }]);
    expect(Object.keys(listed[0] ?? {})).not.toContain("publicKey");
    passkeys.remove("k1");
    expect(passkeys.count()).toBe(0);
  });

  it("sessions: lookup of a minted token, an unknown token, and an expired token", () => {
    const { sessions, clock, sql } = setup();
    const token = sessions.mint("Sam@Solo-Sam.example", true);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(sessions.lookup(token)).toEqual({ email: "sam@solo-sam.example", needsPasskey: true });
    expect(sessions.lookup("random-token")).toBe("unknown");
    // only the hash is stored
    const rows = sql.sql.exec("SELECT token_hash FROM sessions").toArray();
    expect(rows[0]?.token_hash).not.toBe(token);
    clock.advance(30 * DAY + 1);
    expect(sessions.lookup(token)).toBe("expired");
  });

  it("revoke makes a token unknown", () => {
    const { sessions } = setup();
    const token = sessions.mint("sam@solo-sam.example", false);
    sessions.revoke(token);
    expect(sessions.lookup(token)).toBe("unknown");
  });

  it("recovery: the issued code redeems once, then is SPENT", () => {
    const { recovery } = setup();
    const code = recovery.issue("sam@solo-sam.example");
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){3}$|^[0-9A-HJKMNP-TV-Z]{20}$/);
    expect(recovery.redeem("sam@solo-sam.example", code)).toEqual({ ok: true });
    expect(recovery.redeem("sam@solo-sam.example", code)).toEqual({ ok: false, code: "RECOVERY_CODE_SPENT" });
  });

  it("recovery: a wrong code is INVALID and does not spend the real one; none issued is INVALID", () => {
    const { recovery } = setup();
    expect(recovery.redeem("sam@solo-sam.example", "AAAAA")).toEqual({ ok: false, code: "RECOVERY_CODE_INVALID" });
    const code = recovery.issue("sam@solo-sam.example");
    expect(recovery.redeem("sam@solo-sam.example", "AAAAA-AAAAA-AAAAA-AAAAA")).toEqual({ ok: false, code: "RECOVERY_CODE_INVALID" });
    expect(recovery.redeem("sam@solo-sam.example", code)).toEqual({ ok: true });
  });

  it("recovery: issuing twice invalidates the first code", () => {
    const { recovery } = setup();
    const first = recovery.issue("sam@solo-sam.example");
    const second = recovery.issue("sam@solo-sam.example");
    expect(recovery.redeem("sam@solo-sam.example", first)).toEqual({ ok: false, code: "RECOVERY_CODE_INVALID" });
    expect(recovery.redeem("sam@solo-sam.example", second)).toEqual({ ok: true });
  });

  it("recovery: accepts the code with or without dashes and any case", () => {
    const { recovery } = setup();
    const code = recovery.issue("sam@solo-sam.example");
    expect(code.replaceAll("-", "")).toHaveLength(20);
    expect(recovery.redeem("sam@solo-sam.example", code.replaceAll("-", "").toLowerCase())).toEqual({ ok: true });
  });

  it("recovery: emails differing in case share one row", () => {
    const { recovery, sql } = setup();
    const code = recovery.issue("Sam@Solo-Sam.example");
    recovery.issue("sam@solo-sam.example");
    expect(sql.sql.exec("SELECT COUNT(*) AS n FROM recovery").one()?.n).toBe(1);
    const again = recovery.issue("SAM@solo-sam.example");
    expect(recovery.redeem("sam@SOLO-sam.example", code)).toEqual({ ok: false, code: "RECOVERY_CODE_INVALID" });
    expect(recovery.redeem("sam@SOLO-sam.example", again)).toEqual({ ok: true });
  });

  it("runLoginCall dispatches to the three stores over one schema", () => {
    const { sql, clock } = setup();
    const run = <C extends LoginCall>(c: C) => runLoginCall(sql, clock.now, c);
    expect(run({ op: "count" })).toBe(0);
    run({ op: "add", id: "k1", email: "sam@solo-sam.example", publicKey: new Uint8Array([9]), counter: 0, transports: [] });
    expect(run({ op: "count" })).toBe(1);
    expect(run({ op: "list" })).toEqual([{ id: "k1", email: "sam@solo-sam.example", at: 1_000_000 }]);
    const token = run({ op: "mint", email: "sam@solo-sam.example", needsPasskey: false });
    expect(run({ op: "lookup", token })).toEqual({ email: "sam@solo-sam.example", needsPasskey: false });
    run({ op: "revoke", token });
    expect(run({ op: "lookup", token })).toBe("unknown");
    const code = run({ op: "issueRecovery", email: "sam@solo-sam.example" });
    expect(run({ op: "redeemRecovery", email: "sam@solo-sam.example", code })).toEqual({ ok: true });
    run({ op: "putChallenge", id: "c", challenge: "x", kind: "register" });
    expect(run({ op: "takeChallenge", id: "c", kind: "register" })).toBe("x");
    run({ op: "remove", id: "k1" });
    expect(run({ op: "byId", id: "k1" })).toBeNull();
  });
  it("add binds the public key as an ArrayBuffer copy (the SqlStorage binding type) and byId returns a Uint8Array", () => {
    const { sql, clock } = setup();
    const seen: unknown[] = [];
    const exec = sql.sql.exec.bind(sql.sql);
    const spy = {
      sql: {
        exec: (q: string, ...b: unknown[]) => {
          seen.push(...b);
          return exec(q, ...(b as never[]));
        },
      },
      transactionSync: sql.transactionSync,
    } as unknown as typeof sql;
    const key = new Uint8Array([5, 6, 7]);
    const passkeys = new PasskeyStore(spy, clock.now);
    passkeys.add({ id: "k1", email: "sam@solo-sam.example", publicKey: key.subarray(1), counter: 0, transports: [] });
    const bound = seen.find((v) => v instanceof ArrayBuffer) as ArrayBuffer | undefined;
    expect(bound && Array.from(new Uint8Array(bound))).toEqual([6, 7]);
    const back = passkeys.byId("k1")?.publicKey;
    expect(back).toBeInstanceOf(Uint8Array);
    expect(Array.from(back ?? [])).toEqual([6, 7]);
  });

  it("runLoginCall refuses an op it does not know with LOGIN_CALL_UNKNOWN_OP", () => {
    const { sql, clock } = setup();
    expect(() => runLoginCall(sql, clock.now, { op: "drop" } as unknown as LoginCall)).toThrow(/LOGIN_CALL_UNKNOWN_OP/);
  });

  it("putChallenge sweeps challenges older than 300 s", () => {
    const { passkeys, clock, sql } = setup();
    passkeys.putChallenge("old", "a", "register");
    clock.advance(300_001);
    passkeys.putChallenge("new", "b", "authenticate");
    expect(sql.sql.exec("SELECT id FROM challenges").toArray().map((r) => r.id)).toEqual(["new"]);
  });

  it("addPasskey inserts atomically: requireEmpty refuses once one exists, and a known id is refused", () => {
    const { sql, clock } = setup();
    const run = <C extends LoginCall>(c: C) => runLoginCall(sql, clock.now, c);
    const key = { email: "sam@solo-sam.example", publicKey: new Uint8Array([1]), counter: 0, transports: [] };
    expect(run({ op: "addPasskey", id: "k1", ...key, requireEmpty: true })).toEqual({ ok: true });
    expect(run({ op: "addPasskey", id: "k2", ...key, requireEmpty: true })).toEqual({ ok: false, code: "LOGIN_ALREADY_REGISTERED" });
    expect(run({ op: "addPasskey", id: "k1", ...key, requireEmpty: false })).toEqual({ ok: false, code: "LOGIN_PASSKEY_EXISTS" });
    expect(run({ op: "addPasskey", id: "k2", ...key, requireEmpty: false })).toEqual({ ok: true });
    expect(run({ op: "count" })).toBe(2);
  });
});
