// The login storage as one serialisable call, so it can cross the Company object's RPC boundary (R3).
import { PasskeyStore, RecoveryStore, SessionStore, type Sql } from "./store.ts";

type Kind = "register" | "authenticate";

export type LoginCall =
  | { op: "count" }
  | { op: "add"; id: string; email: string; publicKey: Uint8Array; counter: number; transports: string[] }
  | { op: "byId"; id: string }
  | { op: "bump"; id: string; counter: number }
  | { op: "putChallenge"; id: string; challenge: string; kind: Kind }
  | { op: "takeChallenge"; id: string; kind: Kind }
  | { op: "mint"; email: string; needsPasskey: boolean }
  | { op: "lookup"; token: string }
  | { op: "revoke"; token: string }
  | { op: "issueRecovery"; email: string }
  | { op: "redeemRecovery"; email: string; code: string }
  | { op: "list" }
  | { op: "remove"; id: string };

export type LoginResults = {
  count: number;
  add: void;
  byId: { id: string; email: string; publicKey: Uint8Array; counter: number } | null;
  bump: void;
  putChallenge: void;
  takeChallenge: string | null;
  mint: string;
  lookup: { email: string; needsPasskey: boolean } | "unknown" | "expired";
  revoke: void;
  issueRecovery: string;
  redeemRecovery: { ok: true } | { ok: false; code: "RECOVERY_CODE_INVALID" | "RECOVERY_CODE_SPENT" };
  list: { id: string; email: string; at: number }[];
  remove: void;
};

/** The result type of one call, by its `op`. */
export type LoginResultOf<C extends LoginCall> = LoginResults[C["op"]];
export type LoginResult = LoginResults[keyof LoginResults];

export function runLoginCall<C extends LoginCall>(storage: Sql, now: () => number, call: C): LoginResultOf<C>;
export function runLoginCall(storage: Sql, now: () => number, call: LoginCall): LoginResult {
  const passkeys = new PasskeyStore(storage, now);
  switch (call.op) {
    case "count":
      return passkeys.count();
    case "add":
      return passkeys.add(call);
    case "byId":
      return passkeys.byId(call.id);
    case "bump":
      return passkeys.bump(call.id, call.counter);
    case "putChallenge":
      return passkeys.putChallenge(call.id, call.challenge, call.kind);
    case "takeChallenge":
      return passkeys.takeChallenge(call.id, call.kind);
    case "list":
      return passkeys.list();
    case "remove":
      return passkeys.remove(call.id);
    case "mint":
      return new SessionStore(storage, now).mint(call.email, call.needsPasskey);
    case "lookup":
      return new SessionStore(storage, now).lookup(call.token);
    case "revoke":
      return new SessionStore(storage, now).revoke(call.token);
    case "issueRecovery":
      return new RecoveryStore(storage, now).issue(call.email);
    case "redeemRecovery":
      return new RecoveryStore(storage, now).redeem(call.email, call.code);
  }
}
