// The `todo` tool (M24.2): the agent's own checklist for the task in this chat, owner-only and per
// chat. The snapshot is kept in the chat's meta; at a compaction it is copied beside the summary and
// re-injected verbatim, so the list outlives the turns that wrote it. A turn that ends with open items
// leaves one continuation nudge for the next turn's context; it never starts a turn, and the same
// list is nudged once.
import { type Message, Type } from "@earendil-works/pi-ai";
import { fence } from "../context/fence.ts";
import type { Namespace, ToolSpec } from "../tools/registry.ts";

export const TODO_KEY = "todo";
/** The snapshot as it stood at the last compaction, re-injected after the summary. */
export const TODO_AT_COMPACTION_KEY = "todoAtCompaction";
/** The nudge waiting for the next turn, and the snapshot already nudged. */
export const TODO_NUDGE_KEY = "todoNudge";
export const TODO_NUDGED_KEY = "todoNudged";

export interface TodoItem {
  text: string;
  done: boolean;
}

interface Meta {
  meta(key: string): string | undefined;
  setMeta(key: string, value: string): void;
}

const TodoParams = Type.Object({
  items: Type.Array(Type.Object({ text: Type.String({ minLength: 1, maxLength: 500 }), done: Type.Boolean() }), { maxItems: 50, description: "The whole list, in order; it replaces the last one." }),
});

export function todoItems(store: Meta): TodoItem[] {
  const raw = store.meta(TODO_KEY);
  return raw ? (JSON.parse(raw) as TodoItem[]) : [];
}

export const renderTodo = (items: TodoItem[]) => items.map((i) => `- [${i.done ? "x" : " "}] ${i.text}`).join("\n");

/** The `todo` namespace; only a turn of the owner's own task gets it. */
export function todoNamespace(store: Meta & { transaction<T>(fn: () => T): T }): Namespace {
  // An observation: it writes the agent's own checklist in this chat and nothing outside it, so no grant decides it.
  const tool: ToolSpec<typeof TodoParams> = {
    name: "todo_write",
    kind: "observation",
    label: "todo write",
    description: "Write your checklist for the task in this chat: the whole list each time, each item open or done. It is kept across compactions; open items at the end of a turn are brought back to you once in the next.",
    parameters: TodoParams,
    execute: async (_id, args) => {
      const items = args.items as TodoItem[];
      store.transaction(() => store.setMeta(TODO_KEY, JSON.stringify(items)));
      const open = items.filter((i) => !i.done).length;
      return { content: [{ type: "text", text: `Saved: ${open} open, ${items.length - open} done.\n${renderTodo(items)}` }], details: { open } };
    },
  };
  return { name: "todo", description: "todo: your checklist for this chat's task", deferral: "eager", tools: [tool as unknown as ToolSpec] };
}

/** At a compaction: the list as it stands is kept beside the summary. */
export function keepTodoAtCompaction(store: Meta): void {
  const raw = store.meta(TODO_KEY);
  if (raw) store.setMeta(TODO_AT_COMPACTION_KEY, raw);
}

/** The verbatim list re-injected after the compaction summary, or none. */
export function todoAfterSummary(store: Meta): Message[] {
  const raw = store.meta(TODO_AT_COMPACTION_KEY);
  if (!raw) return [];
  return [{ role: "user", content: `Your checklist as it stood when the earlier turns were compacted, verbatim:\n${fence("chat:todo", renderTodo(JSON.parse(raw) as TodoItem[]))}`, timestamp: 0 }];
}

/** At the end of a turn that finished: open items leave one nudge for the next turn, once per list. */
export function noteOpenTodos(store: Meta): void {
  const items = todoItems(store);
  const raw = store.meta(TODO_KEY) ?? "";
  if (!items.some((i) => !i.done) || store.meta(TODO_NUDGED_KEY) === raw) return;
  store.setMeta(TODO_NUDGE_KEY, raw);
}

/** The nudge for this turn's context, taken once; null when none waits. */
export function takeTodoNudge(store: Meta, at: number): Message | null {
  const raw = store.meta(TODO_NUDGE_KEY);
  if (!raw) return null;
  store.setMeta(TODO_NUDGE_KEY, "");
  store.setMeta(TODO_NUDGED_KEY, raw);
  const open = (JSON.parse(raw) as TodoItem[]).filter((i) => !i.done);
  return { role: "user", content: `(From the harness.) Your last turn ended with ${open.length} open item(s) on your checklist. Carry them on only where the person's latest message leaves room for it:\n${fence("chat:todo", renderTodo(open))}`, timestamp: at };
}
