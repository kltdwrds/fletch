// Each F25 task's tier-1 run: the script and seed its `.test.ts` plays, shared with `planted.test.ts`, which plants
// each minefield on the world the same run leaves.
import type { TaskHarness } from "../../support/task.ts";
import * as once from "./allow-once-runs-once.task.ts";
import * as history from "./approvals-history-words.task.ts";
import * as drawn from "./card-drawn-in-chat.task.ts";
import * as parks from "./card-parks-action.task.ts";
import * as reload from "./cards-persist-reload.task.ts";
import * as final from "./decision-final.task.ts";
import { type P15PageTier1World, type P15Tier1World, p15Harness, p15PageHarness, sam } from "./harness.ts";
import * as stop from "./stop-mid-turn.task.ts";
import * as vault from "./vault-at-egress.task.ts";

const share = (id: string, host: string, text: string, said?: string) => ({ ...(said ? { text: said } : {}), toolCall: { id, name: "share_post", arguments: { host, text } } });

export const runs = {
  "T-P15-01": (): TaskHarness<P15Tier1World> => p15Harness({ script: [share(parks.CARD, parks.HOST, parks.TEXT, parks.WAITING)] }),

  "T-P15-02": (): TaskHarness<P15PageTier1World> =>
    p15PageHarness({
      script: [share(drawn.CARD, drawn.HOST, drawn.TEXT, "That post waits for your decision.")],
      seed: async (w) => {
        await w.chat().send({ person: sam.email, text: `post ${drawn.TEXT} to ${drawn.HOST}` });
        await w.chat().settled();
        await w.open("c2");
      },
    }),

  "T-P15-03": (): TaskHarness<P15Tier1World> =>
    p15Harness({
      seed: async (w) => {
        await w.chat().send({ person: sam.email, text: `post ${final.TEXT} to ${final.HOST}` });
        await w.chat().settled();
      },
      script: [
        share(final.FIRST, final.HOST, final.TEXT, "That post waits for your decision."),
        { text: "You declined it, so I have not sent it." },
        share(final.AGAIN, final.HOST, final.TEXT),
        share(final.ELSEWHERE, final.OTHER, final.TEXT, `The post to ${final.OTHER} waits for your decision.`),
      ],
    }),

  "T-P15-04": (): TaskHarness<P15Tier1World> =>
    p15Harness({
      seed: async (w) => {
        await w.chat().send({ person: sam.email, text: `post ${once.TEXT} to ${once.HOST}` });
        await w.chat().settled();
      },
      script: [share(once.FIRST, once.HOST, once.TEXT, "That post waits for your decision."), { text: `Posted it to ${once.HOST}.` }, share(once.AGAIN, once.HOST, once.TEXT, "This one waits for your decision too.")],
    }),

  // Three shares proposed in turn, one declined, one allowed for 30 days, one left waiting.
  "T-P15-06": (): TaskHarness<P15PageTier1World> => {
    const keys = ["approved", "declined", "pending"] as const;
    return p15PageHarness({
      script: keys.map((k, i) => share(history.IDS[k], history.HOSTS[k], history.TEXTS[i] as string, history.SAID[i])),
      seed: async (w) => {
        for (const p of history.PROMPTS) {
          await w.chat().send({ person: sam.email, text: p });
          await w.chat().settled();
          if (p === history.PROMPTS[1]) await w.decide(history.IDS.declined, "deny");
        }
        // Decided after the third was asked, so its standing grant covers no card still waiting.
        await w.decide(history.IDS.approved, "period");
      },
    });
  },

  "T-P15-07": (): TaskHarness<P15Tier1World> => {
    const fill = (id: string, text: string) => ({ text, toolCall: { id, name: "browse_fill", arguments: { selector: "#password", credential: vault.REF } } });
    const live = (id: string, host: string) => ({ toolCall: { id, name: "browse_live", arguments: { url: `https://${host}/` } } });
    return p15Harness({
      credential: true,
      sites: { [vault.SITE]: { page: { title: "Sign in", text: "Username and password." }, echoTyped: true }, [vault.OTHER]: { page: { title: "Sign in", text: "Sign in again." } } },
      script: [
        { toolCall: { id: "l1", name: "tool_search", arguments: { load: ["browse", "credentials"] } } },
        live("b1", vault.SITE),
        fill(vault.FIRST, "The fill on your login page waits for your decision."),
        live("b2", vault.OTHER),
        fill(vault.SECOND, `The fill on ${vault.OTHER} waits for your decision.`),
        live("b3", vault.SITE),
        { toolCall: { id: "c1", name: "credential_list", arguments: {} } },
        { toolCall: { id: "r1", name: "credential_reveal", arguments: { ref: vault.REF } } },
        { text: `You're signed in at ${vault.SITE}. Your login isn't saved for ${vault.OTHER}, so it was not filled there.` },
      ],
    });
  },

  // The turn held while its third step is proposed, Sam's message queued, Stop pressed.
  "T-P15-09": (): TaskHarness<P15Tier1World> =>
    p15Harness({
      hold: "third",
      script: [
        { toolCall: { id: "k1", name: "steps_lookup", arguments: { n: 1 } } },
        { toolCall: { id: "k2", name: "send_to_user", arguments: { text: stop.SAID } } },
        { checkpoint: "third", step: share("k3", stop.HOST, stop.TEXT) },
        { toolCall: { id: "k4", name: "steps_lookup", arguments: { n: 4 } } },
        { text: "All four steps are done and the summary is shared." },
      ],
    }),

  "T-P15-11": (): TaskHarness<P15PageTier1World> => {
    const keys = ["approved", "declined", "pending"] as const;
    return p15PageHarness({
      script: [
        share(reload.IDS.approved, reload.HOSTS.approved, "p15 probe", "The first share waits for you."),
        { text: "Posted it." },
        share(reload.IDS.declined, reload.HOSTS.declined, "p15 probe", "The second share waits for you."),
        { text: "You declined it; I did not send it." },
        share(reload.IDS.pending, reload.HOSTS.pending, "p15 probe", "The third share waits for you."),
      ],
      seed: async (w) => {
        for (const k of keys) {
          await w.chat().send({ person: sam.email, text: `share the probe with ${reload.HOSTS[k]}` });
          await w.chat().settled();
          if (k !== "pending") await w.decide(reload.IDS[k], k === "approved" ? "once" : "deny");
        }
      },
    });
  },
};
