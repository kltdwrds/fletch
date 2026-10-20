// Spill (M24.3, spec P3): a tool result whose text is over SPILL_THRESHOLD never reaches the model's
// context whole. It is written to the person's working tree under `work/spill/` and the result is
// replaced by a stub naming its size and a `file_read` pointer (path and first page). `toAgentTool`
// (tools/registry.ts) applies this to every tool's result on the production path; nothing else does.
// A spill that cannot be stored says so with its code and shows only a marked head, never the whole
// output and never an empty or complete-looking result.
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { TreeApi } from "../files/tools.ts";
import { pageCount, safeSegment, TREE_PAGE_BYTES } from "./tree.ts";

/** 16 KiB of text: the home store's inline limit too, so one number means "too big to carry whole". */
export const SPILL_THRESHOLD = 16 * 1024;
/** A spilled line longer than this is wrapped, so every `file_read` page of a spill is whole. */
export const SPILL_WRAP = 2000;
export const SPILL_DIR = "work/spill";
const HEAD_LINES = 12;
const HEAD_BYTES = 1024;

/** Where a spill is written: the owner's tree, as `PersonTree.write` answers. */
export type SpillSink = (path: string, text: string) => Promise<{ ok: true } | { ok: false; code: string; reason: string }>;

const utf8 = new TextEncoder();
const textParts = (r: AgentToolResult<unknown>): string => (r.content ?? []).map((c) => (c.type === "text" ? c.text : "")).join("");

/** Wraps lines over SPILL_WRAP characters; the stub says so. */
export function wrapLong(text: string): { text: string; wrapped: boolean } {
  let wrapped = false;
  const out = text.split("\n").flatMap((line) => {
    if (line.length <= SPILL_WRAP) return [line];
    wrapped = true;
    const parts: string[] = [];
    for (let i = 0; i < line.length; i += SPILL_WRAP) parts.push(line.slice(i, i + SPILL_WRAP));
    return parts;
  });
  return { text: out.join("\n"), wrapped };
}

function head(text: string): string {
  const lines = text.split("\n").slice(0, HEAD_LINES).join("\n");
  return lines.length > HEAD_BYTES ? lines.slice(0, HEAD_BYTES) : lines;
}

/** The spill path for one call: the tool and the call id, made safe. */
export const spillPath = (tool: string, id: string): string => `${SPILL_DIR}/${safeSegment(`${tool}-${id}`).slice(0, 100)}.txt`;

/**
 * The result the model sees: unchanged when its text is at or under the threshold, else the stub.
 * Non-text parts (an image) are kept beside the stub.
 */
export async function spillResult(tool: string, id: string, result: AgentToolResult<unknown>, sink: SpillSink | undefined): Promise<AgentToolResult<unknown>> {
  const text = textParts(result);
  const bytes = utf8.encode(text).byteLength;
  if (bytes <= SPILL_THRESHOLD) return result;
  const others = (result.content ?? []).filter((c) => c.type !== "text");
  const lines = text.split("\n").length;
  const details = { ...(typeof result.details === "object" && result.details !== null ? result.details : {}), spilled: true, bytes };
  if (!sink) return refused(tool, bytes, lines, text, "SPILL_UNAVAILABLE", "this chat has no working tree", others, details);
  const path = spillPath(tool, id);
  const stored = wrapLong(text);
  const w = await sink(path, stored.text).catch((err: unknown) => ({ ok: false as const, code: "SPILL_UNAVAILABLE", reason: String(err) }));
  if (!w.ok) return refused(tool, bytes, lines, text, w.code, w.reason, others, details);
  const pages = pageCount(stored.text);
  const stub = [
    `SPILLED: the ${tool} result is ${bytes} bytes (${lines} lines), over the ${SPILL_THRESHOLD / 1024} KiB a result may carry into context.`,
    `It is stored whole at ${path}${stored.wrapped ? ` (lines over ${SPILL_WRAP} characters wrapped)` : ""}: read it with file_read {"path":"${path}","from":1}, ${pages} page${pages === 1 ? "" : "s"} of at most ${TREE_PAGE_BYTES / 1024} KiB; each page says where the next starts. file_grep searches it.`,
    `Its first lines, for orientation only (not the whole result):`,
    head(text),
  ].join("\n");
  return { content: [{ type: "text", text: stub }, ...others], details: { ...details, path, pages } };
}

function refused(tool: string, bytes: number, lines: number, text: string, code: string, reason: string, others: AgentToolResult<unknown>["content"], details: Record<string, unknown>): AgentToolResult<unknown> {
  const stub = `${code}: the ${tool} result is ${bytes} bytes (${lines} lines), over the ${SPILL_THRESHOLD / 1024} KiB a result may carry, and it could not be stored (${reason}). Only its first lines follow; the rest is not shown:\n${head(text)}`;
  return { content: [{ type: "text", text: stub }, ...others], details: { ...details, code } };
}

/** The spill sink over the owner's tree, as the chat reaches it; none without a tree. */
export function treeSpill(tree: Pick<TreeApi, "treeWrite"> | undefined, owner: string): SpillSink | undefined {
  if (!tree) return undefined;
  return async (path, text) => {
    const r = await tree.treeWrite({ path, text }, owner);
    return r.ok ? { ok: true } : r;
  };
}
