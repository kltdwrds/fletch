// The tier-1 runs of the P9 tasks (F35): each task's script and seed for `p9Harness`, shared by its `.test.ts` and by
// `planted.test.ts`, which plays the same runs with the fault planted. A chat's requests take the next step in order;
// a step that needs what a tool returned reads it from the request (`fromRequest`), so the link, the reference and the
// count the reply names are the tool's, never the script's.
import type { FakeRequest, FakeStep } from "../../support/fake-model.ts";
import { seededToken } from "../../support/vendors/index.ts";
import { call, load } from "../p3-delegation/runs.ts";
import { toolResults } from "../p5-activity/harness.ts";
import type { P9HarnessOptions } from "./harness.ts";
import { asSam, exampleKey, sam } from "./harness.ts";
import { API_HOST, API_REF, GITHUB_HOST, LOGIN_HOST, LOGIN_REF, OLD_HOST, OLD_REF, OTHER_HOST, OTHER_REF, PROBE_OTHER, REPO, REPO_DENIED } from "./world.ts";

export { call, load };

/** The newest tool result the request carries. */
export const lastResult = (r: FakeRequest): string => toolResults(r).at(-1) ?? "";
/** The capture link in the newest tool result. */
export const linkIn = (r: FakeRequest): string => /\/vault\/capture\?\S+/.exec(lastResult(r))?.[0] ?? "";
/** A reply built from the request (the newest tool result). */
export const replyFrom = (f: (r: FakeRequest) => string): FakeStep => ({ fromRequest: (r) => ({ text: f(r) }) });

export const SIGN_IN = "https://login.example.com/";
/** `browse_fill` of the newest one-time code the chat was told of, into the verification-code field only. */
export const fillCode = (id: string): FakeStep => ({
  fromRequest: (r) => {
    const ref = [...JSON.stringify(r.inputs).matchAll(/\[credential:(cred:\/\/otp-[0-9a-f]+)\]/g)].at(-1)?.[1] ?? "cred://otp-none";
    return call("browse_fill", { selector: "#code", credential: ref, field: "verification_code" }, id);
  },
});

/** The setup reply: where to enter the value, the host, and nothing more (`WORK_WORDS`' setup line). */
export const setupReply = (host: string): FakeStep =>
  replyFrom((r) => `Open this secure form to enter your key for ${host}: ${linkIn(r)} It goes straight to your vault and I never see it. I'll stop here; ask me again once you've entered it.`);

export const runs: Record<string, () => P9HarnessOptions> = {
  "T-P9-01": () => ({
    script: [load("credentials"), call("credential_request", { host: API_HOST, name: "example-api" }, "req1"), setupReply(API_HOST)],
  }),
  "T-P9-03": () => ({
    script: [
      load("credentials"), call("credential_request", { host: LOGIN_HOST, name: "example-login", login: true }, "req1"), setupReply(LOGIN_HOST),
      call("credential_list", {}, "list1"), savedReply(LOGIN_REF, LOGIN_HOST),
      call("credential_list", {}, "list2"), savedReply(LOGIN_REF, LOGIN_HOST),
    ],
  }),
  "T-P9-04": () => ({ script: [{ text: TYPED_REPLY }] }),
  "T-P9-05": () => ({
    seed: async (w) => {
      await w.vault().capture(exampleKey(), asSam());
      await w.vault().capture(exampleKey(OTHER_REF, OTHER_HOST), asSam());
    },
    script: [
      load("fixture"), call("fixture_read", { url: PROBE_OTHER }, "read1"),
      replyFrom((r) => `I couldn't read it: ${/EGRESS_[A-Z_]+/.exec(lastResult(r))?.[0] ?? "a refusal"}. Your Example API key (${API_REF}) is not bound to ${OTHER_HOST}, so the request was refused before anything was sent. Only you can bind it to another host.`),
      load("credentials"), call("credential_host_propose", { ref: API_REF, host: OTHER_HOST }, "prop1"),
    ],
  }),
  "T-P9-06": () => ({
    seed: async (w) => {
      await w.vault().capture(exampleKey(), asSam());
    },
    script: [
      load("fixture"), call("fixture_count", {}, "count1"),
      replyFrom((r) => `Your fixture library holds ${/holds (\d+) items/.exec(lastResult(r))?.[1] ?? "an unknown number of"} items in all. The connector counts the whole library; it has no view by day.`),
      call("fixture_create", { name: "p9 probe" }, "create1"),
      load("fixture"), call("fixture_create", { name: "p9 probe" }, "create2"),
      replyFrom((r) => `Created the item p9 probe. Your standing grant ${/under grant (\S+);/.exec(lastResult(r))?.[1] ?? "(none named)"} for fixture.create covered it, so no card was needed.`),
    ],
  }),
  "T-P9-07": () => ({
    seed: async (w) => {
      await w.vault().capture({ ref: "cred://github", value: seededToken(), hosts: [{ host: GITHUB_HOST, methods: ["GET"], header: "authorization", prefix: "Bearer " }] }, asSam());
    },
    script: [
      load("github"), call("github_repo", { repo: REPO }, "gh1"),
      replyFrom((r) => `The description of ${REPO} is: ${new RegExp(`${REPO}: ([^\\n]+)`).exec(lastResult(r))?.[1] ?? "(not in the answer)"}.`),
      call("github_repo", { repo: REPO_DENIED }, "gh2"),
      replyFrom((r) => `GitHub refused that read: ${/CONNECTOR_HTTP_\d+/.exec(lastResult(r))?.[0] ?? "an error"}. The provider rejected your token for ${REPO_DENIED}; that says nothing about whether the repository exists.`),
      load("hackernews"), call("hn_top", { limit: 1 }, "hn1"),
      replyFrom((r) => `Top story: ${/A p9 probe story/.exec(lastResult(r))?.[0] ?? lastResult(r).slice(0, 80)}.`),
      replyFrom(() => `Today I sent two GitHub calls with your token: GET /repos/${REPO} (answered) and GET /repos/${REPO_DENIED} (refused by GitHub with 401). The Hacker News read carried nothing of yours.`),
    ],
  }),
  "T-P9-11": () => ({
    seed: async (w) => {
      await w.vault().capture({ ref: LOGIN_REF, value: seededToken(), kind: "login", hosts: [{ host: LOGIN_HOST, methods: ["GET"], header: "authorization", prefix: "", fills: true }] }, asSam());
      await w.w.grant(sam.email, { grantee: { kind: "own-agent" }, subject: { kind: "action-kind", ref: "browse.fill" }, mode: "auto" });
    },
    script: [
      load("browse"), call("browse_live", { url: SIGN_IN }, "live1"), fillCode("fill1"),
      replyFrom(() => `The code from your mail is held as a reference; it goes into the page only after you approve it for ${LOGIN_HOST} in Settings. Ask me again once you have.`),
      call("browse_live", { url: SIGN_IN }, "live2"), fillCode("fill2"),
      replyFrom(() => `I typed the code into the verification code field on ${LOGIN_HOST}.`),
      replyFrom(() => `No code for ${LOGIN_HOST} has reached your mailbox, so there is none I can use. Type the code here as "passcode is" and the digits; it is held at once and I never see it.`),
      { text: "The code you typed is held as a credential reference; I will not keep it in our chat." },
    ],
  }),
  "T-P9-12": () => ({
    seed: async (w) => {
      await w.vault().capture(exampleKey(), asSam());
      await w.vault().capture(exampleKey(OTHER_REF, OTHER_HOST), asSam());
      await w.vault().capture(exampleKey(OLD_REF, OLD_HOST), asSam());
      await w.vault().revoke(OLD_REF, asSam("settings"));
    },
    script: [
      load("credentials"), call("credential_list", {}, "list1"),
      replyFrom((r) => {
        const lines = lastResult(r).split("\n").filter((l) => l.startsWith("cred://"));
        const active = lines.filter((l) => /: active;/.test(l)).map((l) => `${l.split(" ")[0]} for ${l.split("; ").at(-1)}`);
        const revoked = lines.filter((l) => /: revoked;/.test(l)).map((l) => `${l.split(" ")[0]} for ${l.split("; ").at(-1)}`);
        return `You have ${active.length} active credentials: ${active.join(" and ")}.${revoked.length ? ` ${revoked.join(", ")} is revoked and no longer used.` : ""}`;
      }),
      { text: "This deploy pairs no devices and keeps no session list. The devices that get your notifications are listed under Settings > Devices, and your passkeys are managed at sign-in." },
      { text: "I can't remove a device: there is no tool for it, and nothing was changed. Turn notifications off on that device itself; it then leaves the list under Settings > Devices." },
    ],
  }),
  "T-P9-13": () => ({
    script: [load("credentials"), call("credential_request", { host: API_HOST, name: "example-api" }, "req1"), setupReply(API_HOST)],
  }),
  "T-P9-14": () => ({ script: [{ text: TYPED_REPLY }] }),
  "T-P9-15": () => ({
    seed: async (w) => {
      await w.vault().capture(exampleKey(), asSam());
    },
    script: [
      load("fixture"), call("fixture_read", { url: PROBE_OTHER }, "read1"),
      replyFrom((r) => (/EGRESS_(CRED_)?HOST_DENIED/.test(lastResult(r)) ? BOUND_REPLY : `The read of ${OTHER_HOST} came back: ${lastResult(r).slice(0, 80)}`)),
      load("credentials"), call("credential_host_propose", { ref: API_REF, host: OTHER_HOST }, "prop1"),
    ],
  }),
  "T-P9-16": () => ({
    seed: async (w) => {
      await w.vault().capture(exampleKey(), asSam());
    },
    script: [
      load("fixture"), call("fixture_count", {}, "count1"),
      replyFrom((r) => `The fixture tool counted ${/holds (\d+) items/.exec(lastResult(r))?.[1] ?? "an unknown number of"} items in your whole library; it cannot count by day, so I can't say how many are from today.`),
      call("fixture_create", { name: "p9 probe" }, "create1"),
    ],
  }),
  "T-P9-18": () => ({
    seed: async (w) => {
      await w.vault().capture(exampleKey(), asSam());
      await w.vault().capture(exampleKey(OTHER_REF, OTHER_HOST), asSam());
    },
    script: [
      load("credentials"), call("credential_request", { host: API_HOST, name: "example-api-2" }, "req1"), setupReply(API_HOST),
      { text: TYPED_REPLY },
      load("fixture"), call("fixture_read", { url: PROBE_OTHER }, "read1"),
      replyFrom((r) => `I couldn't read it: ${/EGRESS_[A-Z_]+/.exec(lastResult(r))?.[0] ?? "a refusal"}. Your Example API key (${API_REF}) is not bound to ${OTHER_HOST}, so the request was refused before anything was sent. Only you can bind it to another host.`),
      call("credential_host_propose", { ref: API_REF, host: OTHER_HOST }, "prop1"),
      { text: LEFT_REPLY },
    ],
  }),
};

/** Answers "is it saved?" from the `credential_list` result alone. */
export const savedReply = (ref: string, host: string): FakeStep =>
  replyFrom((r) =>
    new RegExp(`${ref.replace(/[/.]/g, "\\$&")} \\(login\\): active`).test(lastResult(r))
      ? `Yes: your login for ${host} is saved as ${ref}, with the description you entered on the form. Its password stays in your vault; I can't see it.`
      : `No, not yet: nothing is saved for ${host} until you submit the secure form I linked.`,
  );

/** The answer to a typed secret: held, not kept, and where a key is saved instead (no four characters of it). */
export const TYPED_REPLY = "I won't keep a value typed in chat: I held it out of our conversation, so it shows only as a credential reference. To save an API key, tell me the host it is for and I'll give you the secure form to enter it on.";

/** The refusal on a host the key is not bound to, in the words of `WORK_WORDS`' bound-host line (F42), only when the tool said so. */
export const BOUND_REPLY = `Your Example API key is not bound to ${OTHER_HOST}, so nothing was sent there; only you can bind it to that host.`;

/** What T-P9-18's turns left, as the tables hold it. */
export const LEFT_REPLY = "That left: this chat's messages, with your typed key shown only as a reference; one held secret, which expires in 24 hours; one audit row for the refused read to api.example.org; and the card waiting on you for that host. Nothing reached a provider, so there is nothing to remove there, and no memory, file or job was written.";
