// The person's working tree, `work/` (M24.3, spec P3): the Agents SDK `Workspace` from
// `@cloudflare/computer` in the person's own Durable Object SQLite. Work, uploads (`work/uploads/`)
// and spills (`work/spill/`) live here; the home tree's standing files, memory and skills stay in
// `files/store.ts`. The agent reaches this store only through the one `files` namespace
// (`files/tools.ts`), and this store decides the owner on every call: whoever asks for anyone's tree
// but their own is refused with TREE_NOT_OWNER. A path is validated against one pattern, so no call
// reaches outside `/work` in the object's filesystem.

/** What this store needs of `Workspace.fs`; the production object passes `new Workspace({ storage }).fs`. */
export interface TreeFs {
  readFile(path: string): Promise<ReadableStream<Uint8Array>>;
  stat(path: string): Promise<{ size: number; isFile: boolean; isDirectory: boolean }>;
  find(directory: string, pattern?: string, options?: { limit?: number }): Promise<Array<{ path: string; type: "file" | "dir" }>>;
  grep(pattern: string, path: string, options?: { ignoreCase?: boolean; regex?: boolean; limit?: number; include?: string }): Promise<Array<{ path: string; line: number; text: string }>>;
  writeFile(path: string, content: string | Uint8Array): Promise<void>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
}

export const TREE_ROOT = "work";
/** A page of `file_read` on the tree: at most this many lines and this many bytes (well under the spill threshold). */
export const TREE_PAGE_LINES = 200;
export const TREE_PAGE_BYTES = 12 * 1024;
/** A text file the agent writes or edits; uploads are bytes and take the byte cap. */
export const TREE_TEXT_MAX = 4 * 1024 * 1024;
export const TREE_BYTES_MAX = 25 * 1024 * 1024;
/** An image handed to the model as image input: under the chat store's 2 MB row once base64 (DECISIONS-LOG M24.3). */
export const IMAGE_INPUT_MAX = 1024 * 1024;
export const TREE_LIST_MAX = 500;
export const TREE_MATCH_MAX = 200;

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;
export const IMAGE_TYPES: Readonly<Record<string, string>> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

export type TreeCode =
  | "TREE_NOT_OWNER"
  | "TREE_PATH_INVALID"
  | "TREE_NOT_FOUND"
  | "TREE_IS_DIRECTORY"
  | "TREE_NOT_TEXT"
  | "TREE_TOO_LARGE"
  | "TREE_EDIT_INVALID"
  | "TREE_EDIT_NOT_FOUND"
  | "TREE_EDIT_NOT_UNIQUE"
  | "TREE_PATTERN_INVALID"
  | "TREE_UNAVAILABLE";
export type TreeRefusal = { ok: false; code: TreeCode; reason: string };
export type TreeLine = { n: number; text: string };
export type TreeReadResult =
  | { ok: true; kind: "text"; path: string; size: number; total: number; lines: TreeLine[]; next: number | null; pages: number; cut: number[] }
  | { ok: true; kind: "image"; path: string; size: number; mimeType: string; base64: string | null; caption: string | null }
  | TreeRefusal;
export type TreeWriteResult = { ok: true; path: string; size: number } | TreeRefusal;
export type TreeEditResult = { ok: true; path: string; size: number; line: number } | TreeRefusal;
export type TreeEntry = { path: string; type: "file" | "dir"; size: number };
export type TreeListResult = { ok: true; entries: TreeEntry[]; truncated: boolean } | TreeRefusal;
export type TreeGrepResult = { ok: true; matches: Array<{ path: string; line: number; text: string }>; truncated: boolean } | TreeRefusal;
export type TreeFindResult = { ok: true; paths: Array<{ path: string; type: "file" | "dir" }>; truncated: boolean } | TreeRefusal;
export type TreeDeleteResult = { ok: true; path: string } | TreeRefusal;
export type TreeBytesResult = { ok: true; path: string; bytes: Uint8Array } | TreeRefusal;

const refuse = (code: TreeCode, reason: string): TreeRefusal => ({ ok: false, code, reason });

/** True when `path` names the working tree (`work` or under `work/`): the paths this store serves. */
export const inTree = (path: unknown): boolean => typeof path === "string" && (path === TREE_ROOT || path.startsWith(`${TREE_ROOT}/`));

/** A tree path, or null: under `work/`, segments only, no `..`, bounded. */
export function parseTreePath(path: string, allowRoot = false): string | null {
  if (typeof path !== "string" || path.length > 400) return null;
  const trimmed = path.replace(/\/+$/, "");
  if (trimmed === TREE_ROOT) return allowRoot ? TREE_ROOT : null;
  if (!trimmed.startsWith(`${TREE_ROOT}/`)) return null;
  const parts = trimmed.split("/");
  if (parts.length > 12 || parts.some((p) => !SEGMENT.test(p))) return null;
  return trimmed;
}

/** A file name turned into one safe segment: anything outside the pattern becomes `_`. */
export function safeSegment(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._-]+/, "").slice(0, 100);
  return cleaned || "file";
}

export const imageType = (path: string): string | undefined => IMAGE_TYPES[path.split(".").pop()?.toLowerCase() ?? ""];

const abs = (path: string) => `/${path}`;
const rel = (path: string) => path.replace(/^\/+/, "");
const utf8 = new TextEncoder();
const fsCode = (err: unknown): string | undefined => (err as { code?: string } | null)?.code;

/** Pages of a text as `file_read` on the tree serves them: line and byte bounded, a line past the byte bound cut. */
export function pageOf(all: string[], from: number, limit = TREE_PAGE_LINES): { lines: TreeLine[]; next: number | null; cut: number[] } {
  const lines: TreeLine[] = [];
  const cut: number[] = [];
  let bytes = 0;
  let i = from - 1;
  for (; i < all.length && lines.length < limit; i++) {
    const text = all[i] as string;
    const size = utf8.encode(text).byteLength + 8;
    if (lines.length && bytes + size > TREE_PAGE_BYTES) break;
    if (size > TREE_PAGE_BYTES) {
      cut.push(i + 1);
      lines.push({ n: i + 1, text: `${text.slice(0, TREE_PAGE_BYTES / 2)} [TREE_LINE_CUT: this line is ${size - 8} bytes; the rest is not shown, use file_grep]` });
      i++;
      break;
    }
    bytes += size;
    lines.push({ n: i + 1, text });
  }
  return { lines, next: i < all.length ? i + 1 : null, cut };
}

/** How many `file_read` pages a text takes from line 1. */
export function pageCount(text: string): number {
  const all = text.split("\n");
  let pages = 0;
  for (let from: number | null = 1; from !== null; pages++) from = pageOf(all, from).next;
  return pages;
}

export class PersonTree {
  readonly owner: string;
  private readonly fs: TreeFs;

  constructor(fs: TreeFs, owner: string) {
    this.fs = fs;
    this.owner = owner;
  }

  private async bytesOf(path: string): Promise<Uint8Array | TreeRefusal> {
    let size: number;
    try {
      const st = await this.fs.stat(abs(path));
      if (st.isDirectory) return refuse("TREE_IS_DIRECTORY", `${path} is a directory; file_list or file_find shows what it holds`);
      size = st.size;
    } catch (err) {
      return fsCode(err) === "ENOENT" ? refuse("TREE_NOT_FOUND", `no file at ${path}`) : refuse("TREE_UNAVAILABLE", `the tree could not stat ${path}: ${String(err)}`);
    }
    try {
      const bytes = new Uint8Array(await new Response(await this.fs.readFile(abs(path))).arrayBuffer());
      // A short read is never passed on as the file.
      if (bytes.byteLength !== size) return refuse("TREE_UNAVAILABLE", `${path} read ${bytes.byteLength} of ${size} bytes`);
      return bytes;
    } catch (err) {
      return refuse("TREE_UNAVAILABLE", `the tree could not read ${path}: ${String(err)}`);
    }
  }

  private async textOf(path: string): Promise<string | TreeRefusal> {
    const bytes = await this.bytesOf(path);
    if (!(bytes instanceof Uint8Array)) return bytes;
    try {
      return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
    } catch {
      return refuse("TREE_NOT_TEXT", `${path} is ${bytes.byteLength} bytes of binary data, not text`);
    }
  }

  async read(input: { path: string; from?: number; limit?: number; images?: boolean }, requester: string): Promise<TreeReadResult> {
    if (requester !== this.owner) return refuse("TREE_NOT_OWNER", "only the owner reads their working tree");
    const path = parseTreePath(input.path);
    if (path === null) return refuse("TREE_PATH_INVALID", `not a working-tree path: ${input.path}`);
    const mimeType = imageType(path);
    if (mimeType) {
      const bytes = await this.bytesOf(path);
      if (!(bytes instanceof Uint8Array)) return bytes;
      const sidecar = await this.textOf(`${path}.caption.md`);
      const caption = typeof sidecar === "string" ? sidecar.trim() : null;
      const shown = input.images === true && bytes.byteLength <= IMAGE_INPUT_MAX;
      return { ok: true, kind: "image", path, size: bytes.byteLength, mimeType, base64: shown ? base64Of(bytes) : null, caption };
    }
    const text = await this.textOf(path);
    if (typeof text !== "string") return text;
    const all = text.split("\n");
    const from = Math.max(1, input.from ?? 1);
    const page = pageOf(all, from, Math.min(TREE_PAGE_LINES, Math.max(1, input.limit ?? TREE_PAGE_LINES)));
    return { ok: true, kind: "text", path, size: utf8.encode(text).byteLength, total: all.length, ...page, pages: pageCount(text) };
  }

  /** The file's bytes whole, for a download or a conversion; the owner alone. */
  async readBytes(input: { path: string }, requester: string): Promise<TreeBytesResult> {
    if (requester !== this.owner) return refuse("TREE_NOT_OWNER", "only the owner reads their working tree");
    const path = parseTreePath(input.path);
    if (path === null) return refuse("TREE_PATH_INVALID", `not a working-tree path: ${input.path}`);
    const bytes = await this.bytesOf(path);
    return bytes instanceof Uint8Array ? { ok: true, path, bytes } : bytes;
  }

  async write(input: { path: string; text?: string; bytes?: Uint8Array }, requester: string): Promise<TreeWriteResult> {
    if (requester !== this.owner) return refuse("TREE_NOT_OWNER", "only the owner writes their working tree");
    const path = parseTreePath(input.path);
    if (path === null) return refuse("TREE_PATH_INVALID", `not a working-tree path: ${input.path}`);
    const content = input.bytes ?? (typeof input.text === "string" ? input.text : null);
    if (content === null) return refuse("TREE_PATH_INVALID", "a write carries text or bytes");
    const size = typeof content === "string" ? utf8.encode(content).byteLength : content.byteLength;
    const max = typeof content === "string" ? TREE_TEXT_MAX : TREE_BYTES_MAX;
    if (size > max) return refuse("TREE_TOO_LARGE", `${size} bytes; the limit is ${max}`);
    try {
      await this.fs.mkdir(abs(path.slice(0, path.lastIndexOf("/"))), { recursive: true });
      await this.fs.writeFile(abs(path), content);
    } catch (err) {
      return fsCode(err) === "EISDIR" ? refuse("TREE_IS_DIRECTORY", `${path} is a directory`) : refuse("TREE_UNAVAILABLE", `the tree refused the write of ${path}: ${String(err)}`);
    }
    return { ok: true, path, size };
  }

  /** Replaces exactly one occurrence of `oldText` with `newText`; none or several is refused with its code. */
  async edit(input: { path: string; oldText: string; newText: string }, requester: string): Promise<TreeEditResult> {
    if (requester !== this.owner) return refuse("TREE_NOT_OWNER", "only the owner edits their working tree");
    const path = parseTreePath(input.path);
    if (path === null) return refuse("TREE_PATH_INVALID", `not a working-tree path: ${input.path}`);
    if (typeof input.oldText !== "string" || !input.oldText || typeof input.newText !== "string") return refuse("TREE_EDIT_INVALID", "oldText must be non-empty text and newText text");
    const text = await this.textOf(path);
    if (typeof text !== "string") return text;
    const at = text.indexOf(input.oldText);
    if (at < 0) return refuse("TREE_EDIT_NOT_FOUND", `oldText does not occur in ${path}; file_read it and copy the text exactly`);
    if (text.indexOf(input.oldText, at + 1) >= 0) return refuse("TREE_EDIT_NOT_UNIQUE", `oldText occurs more than once in ${path}; include more of the surrounding text`);
    const next = text.slice(0, at) + input.newText + text.slice(at + input.oldText.length);
    const w = await this.write({ path, text: next }, requester);
    if (!w.ok) return w;
    return { ok: true, path, size: w.size, line: text.slice(0, at).split("\n").length };
  }

  async list(input: { prefix?: string }, requester: string): Promise<TreeListResult> {
    if (requester !== this.owner) return refuse("TREE_NOT_OWNER", "only the owner lists their working tree");
    const dir = parseTreePath(input.prefix ?? TREE_ROOT, true);
    if (dir === null) return refuse("TREE_PATH_INVALID", `not a working-tree path: ${input.prefix}`);
    const found = await this.found(dir, "**/*", TREE_LIST_MAX + 1);
    if (!Array.isArray(found)) return found;
    const entries: TreeEntry[] = [];
    for (const f of found.slice(0, TREE_LIST_MAX)) {
      const size = f.type === "file" ? await this.fs.stat(abs(f.path)).then((s) => s.size, () => 0) : 0;
      entries.push({ path: f.path, type: f.type, size });
    }
    return { ok: true, entries, truncated: found.length > TREE_LIST_MAX };
  }

  async grep(input: { pattern: string; path?: string; regex?: boolean; ignoreCase?: boolean }, requester: string): Promise<TreeGrepResult> {
    if (requester !== this.owner) return refuse("TREE_NOT_OWNER", "only the owner searches their working tree");
    const path = parseTreePath(input.path ?? TREE_ROOT, true);
    if (path === null) return refuse("TREE_PATH_INVALID", `not a working-tree path: ${input.path}`);
    if (typeof input.pattern !== "string" || !input.pattern) return refuse("TREE_PATTERN_INVALID", "the pattern is empty");
    if (input.regex) {
      try {
        new RegExp(input.pattern);
      } catch (err) {
        return refuse("TREE_PATTERN_INVALID", `not a regular expression: ${String(err)}`);
      }
    }
    try {
      const matches = await this.fs.grep(input.pattern, abs(path), { regex: input.regex === true, ignoreCase: input.ignoreCase === true, limit: TREE_MATCH_MAX + 1 });
      return { ok: true, matches: matches.slice(0, TREE_MATCH_MAX).map((m) => ({ path: rel(m.path), line: m.line, text: m.text.slice(0, 400) })), truncated: matches.length > TREE_MATCH_MAX };
    } catch (err) {
      return fsCode(err) === "ENOENT" ? { ok: true, matches: [], truncated: false } : refuse("TREE_UNAVAILABLE", `the tree could not search ${path}: ${String(err)}`);
    }
  }

  async find(input: { pattern: string; path?: string }, requester: string): Promise<TreeFindResult> {
    if (requester !== this.owner) return refuse("TREE_NOT_OWNER", "only the owner searches their working tree");
    const path = parseTreePath(input.path ?? TREE_ROOT, true);
    if (path === null) return refuse("TREE_PATH_INVALID", `not a working-tree path: ${input.path}`);
    if (typeof input.pattern !== "string" || !input.pattern) return refuse("TREE_PATTERN_INVALID", "the pattern is empty");
    const found = await this.found(path, input.pattern, TREE_MATCH_MAX + 1);
    if (!Array.isArray(found)) return found;
    return { ok: true, paths: found.slice(0, TREE_MATCH_MAX), truncated: found.length > TREE_MATCH_MAX };
  }

  private async found(dir: string, pattern: string, limit: number): Promise<Array<{ path: string; type: "file" | "dir" }> | TreeRefusal> {
    try {
      return (await this.fs.find(abs(dir), pattern, { limit })).map((f) => ({ path: rel(f.path), type: f.type }));
    } catch (err) {
      return fsCode(err) === "ENOENT" ? [] : refuse("TREE_UNAVAILABLE", `the tree could not walk ${dir}: ${String(err)}`);
    }
  }

  /** Offboarding's purge (M24.3): the whole working tree, uploads and spills with it; how many files went. */
  async purgeAll(): Promise<number> {
    const found = await this.found(TREE_ROOT, "**/*", Number.MAX_SAFE_INTEGER);
    if (!Array.isArray(found)) throw new Error(`${found.code}: ${found.reason}`);
    await this.fs.rm(abs(TREE_ROOT), { recursive: true, force: true });
    return found.filter((f) => f.type === "file").length;
  }

  async remove(input: { path: string }, requester: string): Promise<TreeDeleteResult> {
    if (requester !== this.owner) return refuse("TREE_NOT_OWNER", "only the owner deletes from their working tree");
    const path = parseTreePath(input.path);
    if (path === null) return refuse("TREE_PATH_INVALID", `not a working-tree path: ${input.path}`);
    try {
      await this.fs.stat(abs(path));
      await this.fs.rm(abs(path), { recursive: true });
    } catch (err) {
      return fsCode(err) === "ENOENT" ? refuse("TREE_NOT_FOUND", `no file at ${path}`) : refuse("TREE_UNAVAILABLE", `the tree could not delete ${path}: ${String(err)}`);
    }
    return { ok: true, path };
  }
}

export function base64Of(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
