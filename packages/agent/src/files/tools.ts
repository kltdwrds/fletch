// The `files` namespace: the agent's one file vocabulary (M24.3, spec P3): read, write, edit, grep
// and find, with list and delete. A path under `work/` is the person's working tree (the Agents SDK
// `Workspace`, `tree/tree.ts`): work, uploads and spills. Any other path is the home tree's standing
// files in `PersonFiles` (`store.ts`), which keeps read, write, list and delete and has no edit, grep
// or find: those three refuse a path outside `work/` with FILES_TREE_ONLY. Both stores live on the
// owner's Person object and decide ownership on every call. The tools change only the person's own
// stores, so they are observations that commit when called, as the memory tools do; `file_write`,
// `file_edit` and `file_delete` carry `mutates` (M7.3): refused while a colleague's request runs.
// `scripts/check-boundaries.mjs` (`one-file-vocabulary`) holds every file tool to this module.
import { Type } from "@earendil-works/pi-ai";
import type { Namespace, ToolSpec } from "../tools/registry.ts";
import { inTree, type TreeDeleteResult, type TreeEditResult, type TreeFindResult, type TreeGrepResult, type TreeListResult, type TreeReadResult, type TreeWriteResult } from "../tree/tree.ts";
import type { DeleteResult, ListResult, ReadResult, WriteResult } from "./store.ts";

/** What the chat reaches on the owner's `Person` object for the home tree, over RPC in production. */
export interface FilesApi {
  fileList(input: { prefix?: string }, requester: string): Promise<ListResult>;
  fileRead(input: { path: string; from?: number; limit?: number }, requester: string): Promise<ReadResult>;
  fileWrite(input: { path: string; text: string }, ctx: { requester: string; writer: string }): Promise<WriteResult>;
  fileDelete(input: { path: string }, requester: string): Promise<DeleteResult>;
}

/** What the chat reaches on the owner's `Person` object for the working tree, over RPC in production. */
export interface TreeApi {
  treeRead(input: { path: string; from?: number; limit?: number; images?: boolean }, requester: string): Promise<TreeReadResult>;
  treeWrite(input: { path: string; text: string }, requester: string): Promise<TreeWriteResult>;
  treeEdit(input: { path: string; oldText: string; newText: string }, requester: string): Promise<TreeEditResult>;
  treeList(input: { prefix?: string }, requester: string): Promise<TreeListResult>;
  treeGrep(input: { pattern: string; path?: string; regex?: boolean; ignoreCase?: boolean }, requester: string): Promise<TreeGrepResult>;
  treeFind(input: { pattern: string; path?: string }, requester: string): Promise<TreeFindResult>;
  treeDelete(input: { path: string }, requester: string): Promise<TreeDeleteResult>;
}

export interface FilesOptions {
  /** The working tree; without it a `work/` path is refused with TREE_UNAVAILABLE. */
  tree?: TreeApi;
  /** The chat route's model takes image input (model/routes.ts), so `file_read` of an image shows it. */
  imageInput?: boolean;
}

const text = (t: string, details: unknown = {}) => ({ content: [{ type: "text" as const, text: t }], details });
function unwrap<T extends { ok: boolean }>(r: T): Exclude<T, { ok: false }> {
  if (!r.ok) {
    const f = r as unknown as { code: string; reason: string };
    throw new Error(`${f.code}: ${f.reason}`);
  }
  return r as Exclude<T, { ok: false }>;
}
const treeOnly = (tool: string, path: string) =>
  new Error(`FILES_TREE_ONLY: ${tool} works on the working tree, work/ (work, uploads and spills); ${path} is a home file: file_read it and file_write the whole text`);

const PATH = Type.String({ minLength: 1, description: "A path: work/... is your working tree (work, uploads under work/uploads/, spills under work/spill/); any other path, such as notes/todo.md, is a home file. Segments of letters, digits, dot, dash and underscore." });
const TREE_PATH = Type.Optional(Type.String({ description: "A directory or file under work/ to search; work/ when omitted." }));
const ListParams = Type.Object({ prefix: Type.Optional(Type.String({ description: "Only files whose path starts with this; work/ lists the working tree." })) });
const ReadParams = Type.Object({ path: PATH, from: Type.Optional(Type.Integer({ minimum: 1 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })) });
const WriteParams = Type.Object({ path: PATH, text: Type.String({ description: "The whole file; an existing file is replaced." }) });
const EditParams = Type.Object({ path: PATH, oldText: Type.String({ minLength: 1, description: "Text that occurs exactly once in the file, copied exactly." }), newText: Type.String({ description: "What replaces it." }) });
const GrepParams = Type.Object({ pattern: Type.String({ minLength: 1 }), path: TREE_PATH, regex: Type.Optional(Type.Boolean()), ignoreCase: Type.Optional(Type.Boolean()) });
const FindParams = Type.Object({ pattern: Type.String({ minLength: 1, description: "A glob such as **/*.md, relative to the path." }), path: TREE_PATH });
const DeleteParams = Type.Object({ path: PATH });

export function filesNamespace(api: FilesApi, requester: string, writer: string, options: FilesOptions = {}): Namespace {
  const tree = (): TreeApi => {
    if (!options.tree) throw new Error("TREE_UNAVAILABLE: this chat has no working tree");
    return options.tree;
  };
  const list: ToolSpec<typeof ListParams> = {
    name: "file_list",
    kind: "observation",
    label: "List files",
    description: "List your files, optionally under a prefix (work/ for the working tree), with sizes.",
    parameters: ListParams,
    execute: async (_id, p) => {
      const lines: string[] = [];
      let truncated = false;
      if (!inTree(p.prefix)) {
        const r = unwrap(await api.fileList(p, requester));
        lines.push(...r.files.map((f) => `${f.path} (${f.size} bytes, sha256 ${f.sha256.slice(0, 12)}${f.spilled ? ", in R2" : ""})`));
      }
      if (options.tree && (p.prefix === undefined || p.prefix === "" || inTree(p.prefix))) {
        const r = unwrap(await options.tree.treeList({ prefix: p.prefix || undefined }, requester));
        lines.push(...r.entries.map((e) => (e.type === "dir" ? `${e.path}/` : `${e.path} (${e.size} bytes)`)));
        truncated = r.truncated;
      }
      return text(lines.length ? `${lines.join("\n")}${truncated ? "\n[the listing stops here; narrow the prefix]" : ""}` : "no files", { count: lines.length, truncated });
    },
  };
  const read: ToolSpec<typeof ReadParams> = {
    name: "file_read",
    kind: "observation",
    label: "Read a file",
    description: "Read one of your files in pages of numbered lines; an image in the working tree is shown to you.",
    parameters: ReadParams,
    execute: async (_id, p) => {
      if (inTree(p.path)) {
        const r = unwrap(await tree().treeRead({ ...p, images: options.imageInput === true }, requester));
        if (r.kind === "image") {
          if (r.base64) return { content: [{ type: "text" as const, text: `${r.path}: an image (${r.mimeType}, ${r.size} bytes), shown below.` }, { type: "image" as const, data: r.base64, mimeType: r.mimeType }], details: { image: true } };
          const why = options.imageInput ? "it is over the size the model is shown" : "this chat's model does not take image input";
          return text(`${r.path}: an image (${r.mimeType}, ${r.size} bytes), not shown to you because ${why}. ${r.caption ? `Its caption: ${r.caption}` : "It has no caption."}`, { image: true });
        }
        const head = `${r.path}, lines ${r.lines[0]?.n ?? 0}-${r.lines.at(-1)?.n ?? 0} of ${r.total} (${r.pages} page${r.pages === 1 ? "" : "s"})${r.next ? `; next page from ${r.next}` : ""}${r.cut.length ? `; line ${r.cut.join(", ")} cut` : ""}`;
        return text([head, ...r.lines.map((l) => `${l.n}: ${l.text}`)].join("\n"), { next: r.next });
      }
      const r = unwrap(await api.fileRead(p, requester));
      const head = `${r.path} sha256 ${r.sha256}, lines ${r.lines[0]?.n ?? 0}-${r.lines.at(-1)?.n ?? 0} of ${r.total}${r.next ? `; next page from ${r.next}` : ""}`;
      return text([head, ...r.lines.map((l) => `${l.n}: ${l.text}`)].join("\n"), { next: r.next });
    },
  };
  const write: ToolSpec<typeof WriteParams> = {
    name: "file_write",
    kind: "observation",
    mutates: true,
    label: "Write a file",
    description: "Write the whole text of one of your files (home files up to 1 MiB); say it is saved only after this returns. To hand the person a file, link it in your reply as [name](files/<path>): their thread draws it as the file's card.",
    parameters: WriteParams,
    execute: async (_id, p) => {
      if (inTree(p.path)) {
        const r = unwrap(await tree().treeWrite(p, requester));
        return text(`saved ${r.path}, ${r.size} bytes`, r);
      }
      const r = unwrap(await api.fileWrite(p, { requester, writer }));
      return text(`saved ${r.path}, ${r.size} bytes, sha256 ${r.sha256}${r.spilled ? " (stored in R2)" : ""}`, r);
    },
  };
  const edit: ToolSpec<typeof EditParams> = {
    name: "file_edit",
    kind: "observation",
    mutates: true,
    label: "Edit a file",
    description: "Replace text that occurs exactly once in a working-tree file (work/...) with new text.",
    parameters: EditParams,
    execute: async (_id, p) => {
      if (!inTree(p.path)) throw treeOnly("file_edit", p.path);
      const r = unwrap(await tree().treeEdit(p, requester));
      return text(`edited ${r.path} at line ${r.line}, now ${r.size} bytes`, r);
    },
  };
  const grep: ToolSpec<typeof GrepParams> = {
    name: "file_grep",
    kind: "observation",
    label: "Search file contents",
    description: "Search the working tree (work/...) for lines matching text or a regular expression.",
    parameters: GrepParams,
    execute: async (_id, p) => {
      if (p.path !== undefined && !inTree(p.path)) throw treeOnly("file_grep", p.path);
      const r = unwrap(await tree().treeGrep(p, requester));
      const lines = r.matches.map((m) => `${m.path}:${m.line}: ${m.text}`);
      return text(lines.length ? `${lines.join("\n")}${r.truncated ? "\n[more matches; narrow the search]" : ""}` : "no matches", { count: lines.length, truncated: r.truncated });
    },
  };
  const find: ToolSpec<typeof FindParams> = {
    name: "file_find",
    kind: "observation",
    label: "Find files",
    description: "Find files and directories in the working tree (work/...) by a glob such as **/*.md.",
    parameters: FindParams,
    execute: async (_id, p) => {
      if (p.path !== undefined && !inTree(p.path)) throw treeOnly("file_find", p.path);
      const r = unwrap(await tree().treeFind(p, requester));
      const lines = r.paths.map((f) => (f.type === "dir" ? `${f.path}/` : f.path));
      return text(lines.length ? `${lines.join("\n")}${r.truncated ? "\n[more paths; narrow the pattern]" : ""}` : "nothing found", { count: lines.length, truncated: r.truncated });
    },
  };
  const remove: ToolSpec<typeof DeleteParams> = {
    name: "file_delete",
    kind: "observation",
    mutates: true,
    label: "Delete a file",
    description: "Delete one of your files.",
    parameters: DeleteParams,
    execute: async (_id, p) => text(`deleted ${unwrap(inTree(p.path) ? await tree().treeDelete(p, requester) : await api.fileDelete(p, requester)).path}`),
  };
  return { name: "files", description: "your files: the working tree work/ (work, uploads, spills) and your home notes and drafts", deferral: "names", tools: [list, read, write, edit, grep, find, remove] as ToolSpec[] };
}
