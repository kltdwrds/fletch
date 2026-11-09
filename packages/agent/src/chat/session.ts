// The namespaces a chat turn offers (moved out of `engine.ts` at M24.2 to keep it under the file cap):
// every hook the host gave, for the turn's principal and context. From M24.2 the checklist and the
// agent's own records (`todo`, `db_query`) are the owner's: a colleague's request never reaches them.
import { chatBrowse } from "../browse/hook.ts";
import { URLS_KEY } from "../browse/urls.ts";
import { codeNamespace } from "../code/tool.ts";
import { colleaguesNamespace } from "../colleagues/tools.ts";
import { connectorNamespaces } from "../connectors/namespaces.ts";
import { filesNamespace } from "../files/tools.ts";
import { acceptsImages, type ModelConfig } from "../model/routes.ts";
import { jobsNamespace } from "../jobs/tools.ts";
import { memorySpecs } from "../memory/tools.ts";
import { documentsNamespace } from "../render/tools.ts";
import { skillsNamespace } from "../skills/tools.ts";
import { type SpeechWire, speechOf } from "../speech/speech.ts";
import type { JournalRow } from "../grants/journal.ts";
import { speechNamespace } from "../speech/tools.ts";
import { subagentsNamespace } from "../subagents/tools.ts";
import type { Namespace } from "../tools/registry.ts";
import type { ViewResult } from "../views/select.ts";
import { dbQueryNamespace } from "../views/tool.ts";
import { workspaceNamespace } from "../workspace/tools.ts";
import type { CardRow } from "./cards.ts";
import type { GateState, TurnContext } from "./gate.ts";
import type { EngineHooks } from "./hooks.ts";
import { otherReaders } from "./shared-context.ts";
import type { ChatStore } from "./store.ts";
import { todoNamespace } from "./todo.ts";
import type { EffectBuffer } from "./tools.ts";

/** Chat-meta key of the live browser session this chat reuses (M9). */
const BROWSE_SESSION_KEY = "browse:session";

export interface SessionDeps {
  store: ChatStore;
  hooks: EngineHooks;
  chatId: string;
  now: () => number;
  schedule: (fn: () => void, ms: number) => () => void;
  owner: () => string | null;
  pending: () => Array<{ tool: string; args: Record<string, unknown> }>;
  queryView: (input: { view: string; sql: string }) => Promise<ViewResult>;
  /** One of this chat's cards, by id: a proposed host is written only under its approval (M25.1). */
  card: (id: string) => CardRow | null;
  /** The deploy's model configuration (`modelConfig(env)`): whether the chat route's model takes images. */
  models: ModelConfig;
  /** The Ledger that admits and records each speech call (F71); without it there is no speech. */
  speechWire?: SpeechWire;
  /** The tenant's journal, for a change the person asked for outside a card (`voice_set`, F71). */
  journal?: (row: JournalRow) => Promise<unknown>;
}

export function chatNamespaces(d: SessionDeps, person: string, effects: EffectBuffer, context: TurnContext, gateState: GateState): Namespace[] {
  const { store, hooks } = d;
  const timeZone = store.meta("timeZone") ?? "UTC";
  // A chat-meta cell as the browser's url table reads and writes it.
  const metaCell = (key: string) => ({ get: () => store.meta(key) || null, set: (v: string | null) => store.transaction(() => store.setMeta(key, v ?? "")) });
  const namespaces: Namespace[] = [];
  const memory = hooks.memory?.(person);
  if (memory) {
    // The person's own typed words, read by code for a person page's name (F44); a colleague's turn carries none.
    const said = context.counterpart.kind === "own-agent" ? () => store.latestTypedText() : undefined;
    const tools = memorySpecs({ api: memory, requester: person, also: otherReaders(context, person), setting: { scope: "personal" }, source: `chat:${d.chatId}`, timeZone, ...(said ? { said } : {}) });
    namespaces.push({ name: "memory", description: "memory: the person's notes, MEMORY.md, people and groups, and their teams' and the company's", deferral: "eager", tools });
  }
  if (hooks.skills) namespaces.push(skillsNamespace(hooks.skills, person, hooks.skillSeen?.(person)));
  const files = hooks.files?.(person);
  const tree = hooks.tree?.(person);
  if (files) namespaces.push(filesNamespace(files, person, `agent:${person}`, { ...(tree ? { tree } : {}), imageInput: acceptsImages("chat", d.models) }));
  const documents = hooks.documents?.(person);
  if (documents) namespaces.push(documentsNamespace(documents, person, effects));
  // Code acts with the owner's egress: no outbound is even built for a turn that serves someone else.
  const ownTurn = context.counterpart.kind === "own-agent";
  namespaces.push(codeNamespace(ownTurn ? hooks.code?.(person) : undefined, ownTurn));
  const egress = hooks.egress?.(person);
  if (egress) namespaces.push(...connectorNamespaces(egress, hooks.credentials?.(person), { person, card: d.card }));
  if (hooks.browse) namespaces.push(chatBrowse(hooks.browse, person, { urls: metaCell(URLS_KEY), session: metaCell(BROWSE_SESSION_KEY) }, d.now));
  if (hooks.colleagues) namespaces.push(colleaguesNamespace(hooks.colleagues, { principal: person, context, chatId: d.chatId }));
  if (hooks.jobs) namespaces.push(jobsNamespace(hooks.jobs, { principal: person, chatId: d.chatId, zone: () => store.meta("timeZone"), request: () => store.latestTyped()?.turnId, now: d.now, separate: { text: () => store.latestTyped()?.text, spent: () => { const t = store.latestTyped(); return !t || store.meta(`separate:${t.turnId}`) !== undefined; }, spend: () => { const t = store.latestTyped(); if (t) store.setMeta(`separate:${t.turnId}`, "1"); } } }));
  if (hooks.workspace) namespaces.push(workspaceNamespace(hooks.workspace.api, { tenant: hooks.workspace.tenant, principal: person, effects }));
  if (hooks.subagents) namespaces.push(subagentsNamespace(hooks.subagents, { effects, context, latched: () => gateState.latched(), person }));
  if (context.counterpart.kind === "own-agent") namespaces.push(todoNamespace(store), dbQueryNamespace({ query: d.queryView }, d.schedule));
  // Speech (P13, F71): on where `AI` is bound, `SPEECH` is not off and the Ledger admits each call; the audio record is the
  // owner's, so a colleague's turn gets the refusals alone. Calls are refused VOICE_CALL_UNAVAILABLE on every deploy.
  const speechEnv = hooks.speech ?? {};
  const audio = context.counterpart.kind === "own-agent" ? hooks.audio?.(person) : undefined;
  const speechDeps = audio ? { person, chatId: d.chatId, audio, effects, said: () => store.latestTypedText(), now: d.now, ...(d.journal ? { journal: d.journal } : {}) } : undefined;
  namespaces.push(speechNamespace(speechOf(speechEnv, d.speechWire), speechEnv, speechDeps));
  const extra = hooks.namespaces;
  namespaces.push(...(typeof extra === "function" ? extra({ owner: d.owner, pending: d.pending }) : (extra ?? [])));
  return namespaces;
}
