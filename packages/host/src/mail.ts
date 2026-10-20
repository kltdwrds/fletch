// Types copied from qyvr-co: SealFields, SealCode and SealVerdict from packages/platform/dispatcher/src/mail.ts
// (the MailSeal entrypoint's verify), MailOutService from packages/agent/src/person/mail.ts.
export interface SealFields {
  tenant: string;
  to: string;
  from: string;
  at: number;
  /** sha256 of the raw message, hex. */
  digest: string;
}
export type SealCode = "MAIL_NO_TENANT" | "MAIL_SEAL_UNAVAILABLE" | "MAIL_SEAL_MISSING" | "MAIL_SEAL_STALE" | "MAIL_SEAL_INVALID";
export type SealVerdict = { ok: true } | { ok: false; code: SealCode; reason: string };

/** The seal check: the tenant is the binding's, so the caller passes every field but it. */
export interface MailSealService {
  verify(f: Omit<SealFields, "tenant"> & { seal: string }): Promise<SealVerdict>;
}

export interface MailOutService {
  send(input: { person: string; name?: string; to: string; subject: string; text: string; replyToken?: string; inReplyTo?: string }): Promise<{ ok: true; messageId: string } | { ok: false; code: string; reason: string }>;
}

export interface MailService {
  seal: MailSealService;
  out: MailOutService;
}
