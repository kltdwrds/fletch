// The P8 readers over a preview slot (F61): T-P8-13's world on a real slot with the real model, apart from the slot
// client so a hermetic test reads them without its socket or passkey. Every read is an app route as Sam: the chat
// list (`/app/chats`, each chat's kind and id), the trial's tasks (`/app/activity`, those in the trial's chats) and each
// task's steps (`/app/activity/<chat>/<task>`, one step per tool call, named by code). A room ask needs no test host:
// what it could do wrong (a tool called, a chat opened) is on those routes, and its words are the chat's own history.
import type { P8SlotWorld } from "../../test/evals/p8-group-chats/world.ts";
import type { SlotEntry } from "../../test/support/evals.ts";

type Read = (path: string) => Promise<{ status: number; body: unknown }>;

interface Listed {
  id: string;
  kind: string;
}

export interface P8Slot {
  readers: Omit<P8SlotWorld, "snapshot">;
  /** The trial's start: the chats the list holds before any turn, kept aside. */
  begin(): Promise<void>;
}

const listOf = async (read: Read): Promise<Listed[]> => {
  const r = await read("/app/chats");
  if (r.status !== 200) throw new Error(`P8_CHATS_UNREAD: /app/chats answered ${r.status}`);
  return ((r.body as { chats?: Listed[] }).chats ?? []).map((c) => ({ id: c.id, kind: c.kind }));
};

/** The P8 readers over the trial's chats by label, each label's history as the page draws it, and the app's routes as Sam. */
export function p8Slot(chats: () => ReadonlyMap<string, string>, entries: (label: string) => SlotEntry[], read: Read): P8Slot {
  let before: Set<string> | null = null;
  const own = () => new Set(chats().values());
  const readers: Omit<P8SlotWorld, "snapshot"> = {
    replies: (label) => entries(label).flatMap((e) => (e.kind === "agent" && typeof e.text === "string" ? [e.text] : [])),
    async steps() {
      const a = await read("/app/activity");
      if (a.status !== 200) throw new Error(`P8_ACTIVITY_UNREAD: /app/activity answered ${a.status}`);
      const b = a.body as { tasks?: Array<{ id: string; chatId: string }>; unread?: Array<{ chatId: string; code: string }> };
      const mine = own();
      // A trial's chat that could not be read is the trial's failure to see, never an empty list of calls.
      const blind = (b.unread ?? []).find((u) => mine.has(u.chatId));
      if (blind) throw new Error(`P8_ACTIVITY_UNREAD: chat ${blind.chatId} answered ${blind.code}`);
      const out: Array<{ tool: string; kind: string }> = [];
      for (const t of (b.tasks ?? []).filter((x) => mine.has(x.chatId))) {
        const d = await read(`/app/activity/${t.chatId}/${t.id}`);
        if (d.status !== 200) throw new Error(`P8_TASK_UNREAD: /app/activity/${t.chatId}/${t.id} answered ${d.status}`);
        for (const s of (d.body as { steps?: Array<{ kind: string; tool: string }> }).steps ?? []) if (s.kind !== "summary" && s.tool) out.push({ tool: s.tool, kind: s.kind });
      }
      return out;
    },
    async chats() {
      const listed = new Map((await listOf(read)).map((c) => [c.id, c.kind]));
      return [...chats()].map(([label, id]) => ({ label, id, kind: listed.get(id) ?? "unlisted" }));
    },
    async opened() {
      if (!before) throw new Error("P8_NOT_BEGUN: the trial's start was not read");
      const start = before;
      const mine = own();
      return (await listOf(read)).map((c) => c.id).filter((id) => !start.has(id) && !mine.has(id));
    },
  };
  return {
    readers,
    async begin() {
      before = new Set((await listOf(read)).map((c) => c.id));
    },
  };
}
