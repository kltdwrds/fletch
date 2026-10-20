// Code Mode (D2, M25.5): `code_execute` runs a model-written script as a Dynamic Worker loaded from
// the person's `Chat` object (`code/run.ts`). The script reaches the network only through the egress
// module, for the chat's owner (`code/egress.ts`): a listed host answers, anything else is refused
// with its code. Credentials are named by reference and the script receives a surrogate for each,
// which egress swaps back at an approved host; the result is scrubbed of surrogates at the tool
// boundary like every tool's. An observation: what the code reads it may also send, but only to the
// hosts and with the credentials the person's registry already allows. Because the code acts with the
// owner's egress, it runs on the owner's own turns alone: a colleague's request is refused in code.
import { Type } from "@earendil-works/pi-ai";
import type { Namespace, ToolSpec } from "../tools/registry.ts";
import type { CodeApi } from "./run.ts";

const Params = Type.Object({
  script: Type.String({
    minLength: 1,
    description:
      "JavaScript: the body of an async function (input, console, credentials) that returns a JSON value. No imports and no bindings. fetch() reaches only the person's listed hosts, through egress; any other request answers 403 with a JSON { code, reason } and the x-qyvr-egress-refused header. Raw sockets are refused.",
  }),
  input: Type.Optional(Type.Object({}, { additionalProperties: true, description: "JSON passed to the script as input." })),
  credentials: Type.Optional(
    Type.Array(Type.String({ pattern: "^cred://" }), {
      maxItems: 8,
      description: "References (cred://…) of the person's saved credentials the script needs; credentials[ref] is a token to send as the credential, to that credential's own hosts only.",
    }),
  ),
});

const LOG_LINES = 50;

/** `own` is false on a turn that serves someone other than the owner (a colleague's request): the code would act with the owner's egress. */
export function codeNamespace(code: CodeApi | undefined, own = true): Namespace {
  const execute: ToolSpec<typeof Params> = {
    name: "code_execute",
    kind: "observation",
    label: "Run JavaScript",
    description: "Run a short JavaScript script in an isolate and get its JSON result back: for computing, transforming or summarising data, or calling a listed API with the person's own credentials.",
    parameters: Params,
    external: true,
    execute: async (_id, p) => {
      if (!own) throw new Error("CODE_NOT_ON_REQUEST: code runs with the owner's own egress and credentials, on the owner's own turns; a colleague's request never runs it");
      if (!code) throw new Error("CODE_UNAVAILABLE: this agent has no Worker Loader");
      const r = await code.run({ script: p.script, input: p.input, ...(p.credentials ? { credentials: p.credentials } : {}) });
      const lines = "logs" in r ? (r.logs ?? []) : [];
      const logs = lines.length ? ["logs:", ...lines.slice(0, LOG_LINES).map((l) => `  ${l}`)] : [];
      if (!r.ok) throw new Error([`${r.code}: ${r.reason}`, ...logs].join("\n"));
      const text = [`result: ${JSON.stringify(r.result)}`, ...logs, `worker ${r.workerId} (${r.loaded ? "loaded" : "reused"})`].join("\n");
      return { content: [{ type: "text", text }], details: { workerId: r.workerId, loaded: r.loaded } };
    },
  };
  return { name: "code", description: "run JavaScript in an isolate; its network is the person's listed hosts, through egress", deferral: "names", tools: [execute] as ToolSpec[] };
}
