// Permission surfaces (AD-24 decision 1, M16.2): what the agent puts in its person's chat when a
// workshop decision is the person's. Each is a link card: words written here, a deep link under the
// tenant's `/workshop/` base path (patch 2), and no decide button. The person decides in the workshop,
// whose journal records who did. The agent never relays a connect flow's URL (upstream documents
// `ConnectFlowStart` as a bearer capability): a link is only ever built here, from the base path.
import type { ApprovalRef, ConnectionRequestRef, WorkspaceRef } from "./adapters.ts";

/** Where the dispatcher serves the workshop on the tenant's own host (M8.2). */
export const WORKSHOP_BASE = "/workshop/";

/** The Settings row that opens the workshop (M23.3): its words and path live here, where the workshop is named. */
export const APPS_LINK = { label: "Workshop", sub: "Apps your agents built", href: WORKSHOP_BASE } as const;

export type LinkCardKind = "workspace_actions" | "connection_request" | "connect" | "decide_in_workshop" | "share";

/**
 * A card that sends the person somewhere to decide. It has no choices: nothing the app draws from it
 * posts a decision, and the chat's card store, the only thing a decision reaches, never holds one.
 */
export interface LinkCard {
  id: string;
  kind: LinkCardKind;
  title: string;
  text: string;
  /** A path under `WORKSHOP_BASE`, relative to the tenant's host; a share card's (M24.3) is its public `/hooks/share/` link. */
  href: string;
}

const seg = (s: string) => encodeURIComponent(s);

/** A workspace's page; with a chat, that chat shown even where the pane hides it (upstream's `showChat`). */
export function workspacePath(workspace: string, chat?: string): string {
  return `${WORKSHOP_BASE}workspace/${seg(workspace)}${chat ? `?chat=${seg(chat)}&showChat=true` : ""}`;
}

/** The connectors page, where the person connects, reconnects or disconnects an account. */
export const CONNECT_PATH = `${WORKSHOP_BASE}gatekeepers`;

/** True only for a path this module builds: same host, under the base, no scheme, no host, no fragment. */
export function isWorkshopLink(href: string): boolean {
  if (!href.startsWith(WORKSHOP_BASE) || href.includes("//") || href.includes("#")) return false;
  const url = new URL(href, "https://tenant.invalid");
  return url.origin === "https://tenant.invalid" && url.pathname.startsWith(WORKSHOP_BASE);
}

/** One card per workspace with pending actions: "n actions wait in <workspace>". */
export function actionsCards(pending: ApprovalRef[], spaces: WorkspaceRef[]): LinkCard[] {
  const by = new Map<string, number>();
  for (const a of pending) if (a.state === "pending") by.set(a.workspace, (by.get(a.workspace) ?? 0) + 1);
  return [...by].map(([workspace, n]) => {
    const name = spaces.find((s) => s.id === workspace)?.name ?? workspace;
    return {
      id: `actions:${workspace}:${n}`,
      kind: "workspace_actions",
      title: `${n} action${n === 1 ? "" : "s"} wait${n === 1 ? "s" : ""} in ${name}`,
      text: "Your agent can't approve or reject these. Open the workspace to decide.",
      href: workspacePath(workspace),
    };
  });
}

/** The build agent asked for a connection: the person accepts or denies it in that chat. */
export function connectionRequestCard(workspace: string, request: ConnectionRequestRef): LinkCard {
  const what = request.resource ? `${request.vendorName} (${request.resource})` : request.vendorName;
  return {
    id: `connection:${workspace}:${request.id}`,
    kind: "connection_request",
    title: `The build agent asks for a connection to ${what}`,
    text: "Your agent can't accept or deny it. Open the workspace's chat to decide.",
    href: workspacePath(workspace, request.chat),
  };
}

/** The connect page for one vendor; the vendor is named in the words, the page lists every vendor. */
export function connectCard(vendor: string): LinkCard {
  return {
    id: `connect:${vendor}`,
    kind: "connect",
    title: `Connect ${vendor} in the workshop`,
    text: "Connecting an account is yours, not your agent's. Open the connectors page and choose this vendor.",
    href: CONNECT_PATH,
  };
}

/**
 * The cells of AD-24's access table the agent session is refused (patch 1's `AGENT_REFUSED`), as the
 * agent names them, each with where the person decides it.
 */
export const REFUSED_DECISIONS = {
  approve: { label: "approve a pending action", where: "workspace" },
  reject: { label: "reject a pending action", where: "workspace" },
  auto_approve: { label: "set or remove an auto-approval rule", where: "workspace" },
  connect: { label: "connect an account", where: "connect" },
  reconnect: { label: "reconnect an account", where: "connect" },
  disconnect: { label: "disconnect an account", where: "connect" },
  configure: { label: "configure an account's resources", where: "connect" },
  accept_connection: { label: "accept the build agent's connection request", where: "workspace" },
  deny_connection: { label: "deny the build agent's connection request", where: "workspace" },
  share: { label: "share a workspace or make a share link", where: "workspace" },
} as const satisfies Record<string, { label: string; where: "workspace" | "connect" }>;
export type RefusedDecision = keyof typeof REFUSED_DECISIONS;

/** Where the person makes a refused decision: the workspace when one is named, else the connectors page or the workshop's home. */
export function decisionCard(decision: RefusedDecision, workspace?: string): LinkCard {
  const d = REFUSED_DECISIONS[decision];
  const href = d.where === "connect" ? CONNECT_PATH : workspace ? workspacePath(workspace) : WORKSHOP_BASE;
  return {
    id: `decide:${decision}:${workspace ?? ""}`,
    kind: "decide_in_workshop",
    title: `Only you can ${d.label}`,
    text: "Your agent can't make this decision. Open the workshop to make it.",
    href,
  };
}
