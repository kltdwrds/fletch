// Test-host fixtures for the P15 approval tasks (F25, `docs/plan-v2/contracts/P15-approvals.md`): the outbound share
// a task proposes, offered to a chat through the authority world's `namespaces` option, never shipped. fletch has no
// exec surface or generic POST (P2's not-in-scope stands), so Muse's `exec` running curl is this one action: it sends
// a text to a host, under the matrix's `mail.send` kind ("sending, sharing, publishing or deleting"), and every run
// is one entry in the fake egress log the tasks read. Nothing reaches a network.
import { Type } from "@earendil-works/pi-ai";
import type { Namespace } from "../../packages/agent/src/tools/registry.ts";

/** One request the fake egress received: the host and the text it carried. */
export interface EgressRequest {
  host: string;
  text: string;
  at: number;
}

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }], details: {} });

/** The action kind a share is gated under: the matrix's sending and sharing row. */
export const SHARE_KIND = "mail.send";

/** `share_post` sends `text` to `host`; `sent` receives each request it makes, as the egress would log it. */
export function shareNamespace(sent: (r: Omit<EgressRequest, "at">) => void): Namespace {
  return {
    name: "share",
    description: "send a text to a web host",
    deferral: "eager",
    tools: [
      {
        name: "share_post",
        kind: "action",
        label: "Share with a host",
        description: "Send a text to a web host as the body of an HTTP POST.",
        parameters: Type.Object({ host: Type.String(), text: Type.String() }),
        actionKind: SHARE_KIND,
        // No connector: the card's destination is then the host itself (`destOf` reads the recipients).
        subject: (a) => ({ scope: "personal", resource: `host:${String(a.host ?? "")}` }),
        recipients: (a) => [String(a.host ?? "")],
        execute: async (_id, p) => {
          const { host, text: body } = p as { host: string; text: string };
          sent({ host, text: body });
          return text(`posted to ${host}: 200`);
        },
      },
    ],
  };
}
