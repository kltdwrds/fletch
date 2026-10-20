export interface Session {
  tenant: string;
  person: string;
  role: "owner" | "admin" | "member";
}
export type IdentityRefusal = "SESSION_MISSING" | "SESSION_UNKNOWN" | "SESSION_EXPIRED" | "NOT_A_MEMBER" | "IDENTITY_UNAVAILABLE" | "PASSKEY_REQUIRED";
export type IdentityVerdict = { ok: true; session: Session } | { ok: false; code: IdentityRefusal; reason: string; status: 401 | 403 | 503 };

export interface Identity {
  verify(request: Request, lookup: (email: string) => Promise<{ email: string; role: Session["role"] } | null>): Promise<IdentityVerdict>;
  /** Routes the host owns before any session exists (login, logout, recovery); null when the path is not one of them. */
  routes(request: Request, url: URL): Promise<Response | null>;
}
