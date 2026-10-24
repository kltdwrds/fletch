// A turn's first assembly (moved out of `engine.ts` at M24.2 to keep it under the file cap): compaction
// if due, the todo nudge, the skills shortlist and the shared context, then the assembler; the blocks it
// placed around the transcript are recorded, so a resumed step replays them (`projection.ts`).
import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import { assemble } from "../context/assemble.ts";
import type { Route } from "../model/routes.ts";
import { toolReference } from "../tools/reference.ts";
import type { ToolSession } from "../tools/registry.ts";
import { summaryMessage } from "./compaction.ts";
import { compactIfDue } from "./compact-turn.ts";
import type { TurnContext } from "./gate.ts";
import type { EngineHooks } from "./hooks.ts";
import { CHAT_TASK, PLATFORM_INSTRUCTIONS, REQUEST_TASK } from "./instructions.ts";
import { reactionsLead } from "./message-actions.ts";
import type { Projections } from "./projection.ts";
import { otherReaders, sharedContext } from "./shared-context.ts";
import { standingSnapshot } from "./standing-copy.ts";
import type { ChatStore } from "./store.ts";
import { takeTodoNudge, todoAfterSummary } from "./todo.ts";

/** The live transcript: the compaction summary and the checklist kept with it (M24.2), then every message kept. */
export function liveTranscript(store: ChatStore): Message[] {
  const summary = store.meta("summary");
  return [...(summary ? [summaryMessage(summary, 0), ...todoAfterSummary(store)] : []), ...store.transcript().map((r) => r.message)];
}

export interface AssembleDeps {
  store: ChatStore;
  hooks: EngineHooks;
  projections: Projections;
  now: () => number;
  streamFn: (route: Route, person: string, runId: string) => StreamFn;
  context: TurnContext;
}

export async function assembleTurn(d: AssembleDeps, turnId: string, person: string, session: ToolSession, modelId: string): Promise<{ ok: true; messages: Message[] } | { ok: false; code: string; detail: string }> {
  const { store, hooks } = d;
  const compacted = await compactIfDue(store, d.streamFn("compaction", person, turnId), turnId, d.now());
  if (!compacted.ok) return compacted;
  store.transaction(() => {
    const nudge = takeTodoNudge(store, d.now());
    if (nudge) store.appendMessage(`nudge:${turnId}`, nudge);
  });
  const timeZone = store.meta("timeZone") ?? "UTC";
  let shortlist: Array<{ name: string; description: string }> = [];
  if (hooks.skills) {
    try {
      shortlist = (await hooks.skills.shortlist(person)).map((s) => ({ name: s.name, description: `[${s.scope}] ${s.description}` }));
    } catch (err) {
      return { ok: false, code: "SKILLS_UNAVAILABLE", detail: String(err instanceof Error ? err.message : err) };
    }
  }
  const keep = (k: string, v: string) => store.transaction(() => store.setMeta(k, v));
  const shared = await sharedContext({ company: hooks.companyInstructions, memory: hooks.memory?.(person), meta: (k) => store.meta(k), keep, context: d.context, turnId, person });
  if (!shared.ok) return shared;
  const transcript = liveTranscript(store);
  const owner = store.meta("owner") ?? person;
  const messages = assemble({
    platform: PLATFORM_INSTRUCTIONS,
    // A chat opened for a colleague's request keeps its own task block for its whole life.
    task: store.meta("surface") === "request" ? REQUEST_TASK : CHAT_TASK,
    // Standing files are personal scope, which never passes to a turn answering anyone else (M10.1).
    standingFiles: otherReaders(d.context, person).length ? [] : standingSnapshot(store),
    ...(shared.company ? { company: shared.company } : {}),
    memory: shared.memory,
    skills: shortlist,
    toolReference: toolReference(session.registry.namespaces, session.loaded),
    // The reactions standing now (F10): per turn, in the envelope, since a reaction changes after the message it is on.
    envelope: { now: d.now(), timeZone, surface: "chat", modelId, owner: person, reactions: reactionsLead(store.history(), hooks.nameOf?.(owner) ?? owner) },
    tools: session.tools,
    transcript,
  });
  d.projections.record(turnId, messages, transcript, d.now());
  return { ok: true, messages };
}
