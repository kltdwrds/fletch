// The confirmation matrix (M24.1): per action kind, what happens without the person in the loop. The rows
// are data; the level of each is derived by running the grants engine's own `resolve` over probe grants,
// so a rule the engine changes changes the matrix, and the operating block that renders it, with it.
// Nothing here decides an action: the engine does, on every call.
import { resolve } from "./engine.ts";
import type { CompanyView, Descriptor, Grant } from "./types.ts";

export type Confirmation = "allowed" | "asks-once" | "standing-grant" | "never";

export interface MatrixRow {
  kind: string;
  /** What the person would call it. */
  label: string;
  /** Observations are not gated; everything else goes through the engine. */
  gated: boolean;
  /** For a gated kind a grant can cover: one approval covers this use, or only a standing grant lets it run unasked. */
  approval?: "asks-once" | "standing-grant";
}

export const MATRIX_ROWS: readonly MatrixRow[] = [
  { kind: "read", label: "reading, searching and drafting within your own access", gated: false },
  { kind: "skill.write", label: "saving a skill", gated: true, approval: "asks-once" },
  { kind: "jobs.enable", label: "turning a scheduled job on", gated: true, approval: "asks-once" },
  { kind: "workspace.create", label: "creating in the shared workspace", gated: true, approval: "asks-once" },
  { kind: "company.member.invite", label: "inviting a member", gated: true, approval: "asks-once" },
  { kind: "browse.fill", label: "filling a saved credential into a site", gated: true, approval: "standing-grant" },
  { kind: "colleagues.request", label: "asking a colleague's agent", gated: true, approval: "standing-grant" },
  { kind: "mail.send", label: "sending, sharing, publishing or deleting", gated: true, approval: "standing-grant" },
  { kind: "purchase", label: "buying or paying", gated: true, approval: "standing-grant" },
];

const PROBE_AT = 1;
const company: CompanyView = { roleOf: () => "member", teamsOf: () => [], policies: [], approverRole: "admin" };
const grant = (kind: string, oneShot: boolean): Grant => ({
  id: "probe",
  tenant: "probe",
  grantor: { kind: "person", id: "probe" },
  grantee: { kind: "own-agent" },
  subject: { kind: "action-kind", ref: kind },
  mode: "auto",
  constraints: {},
  ...(oneShot ? { one_shot: true } : {}),
  created_from: "chat-confirmation",
  created_at: 0,
});
const descriptor = (kind: string): Descriptor => ({
  actor: "agent:probe",
  principal: "probe",
  actionKind: kind,
  subject: { scope: "personal", ref: "probe" },
  counterpart: { kind: "own-agent" },
  origin: "probe",
  hops: 0,
  at: PROBE_AT,
});

/** The level the engine gives a row: no grant asks, a lasting grant that cannot apply makes it never automatic. */
export function levelOf(row: MatrixRow): Confirmation {
  if (!row.gated) return "allowed";
  const d = descriptor(row.kind);
  if (resolve(d, [], company).decision !== "ask") throw new Error(`${row.kind}: with no grant the engine must ask`);
  // A purchase is never automatic under a lasting grant (the engine's own rule); everything else can be.
  if (resolve(d, [grant(row.kind, false)], company).decision !== "auto") return "never";
  return row.approval ?? "standing-grant";
}

export const LEVEL_WORDS: Record<Confirmation, string> = {
  allowed: "just do it",
  "asks-once": "call the tool; code holds it for the person's one approval",
  "standing-grant": "call the tool; code runs it under a standing grant that covers it (citing the grant) and otherwise holds it for the person",
  never: "call the tool; code holds it for the person's card every time, and no standing grant ever applies",
};
