// The page grammar (F4, D-0009): every address the app answers with its page, as data both sides read. The server
// serves `APP_PAGE` for a GET on exactly these paths (routes.ts) and the page with a 404 to a browser asking for any
// other path; the page script gets the same rows as JSON (app/router.ts) and draws the view a row names. A pattern is
// a regular expression's source, anchored, so the one table serves `RegExp` on both sides; its first group is the
// row's id. The Library's things are its collections (F6): `/library/<collection>/<id…>` is a page only for a
// collection registered in `COLLECTIONS`, its id the path segments after it, each encoded with `encodeURIComponent` and
// decoded one by one (`segmentsOf`); an empty, `.` or `..` segment, or one that decodes to a slash, is no page. `files`
// is registered here; `artifacts` is the artifact plan's row to add (D-0010), so `/library/artifacts/x` is the
// not-found page until then. Settings' addresses (F5) are its panes, each drawn over the page it was
// opened from: `/settings`, `/settings/<pane>`, a nested pane under its parent's and a connector at
// `/settings/connectors/<id>`. A message's position is the fragment (`/chats/<id>#<mid>`), which the server never
// sees. A new chat is the literal `/chats/new` (F8): a page of the chat view with no id, matched before the uuid row,
// which holds a draft on the page and nothing on the server until its first message is sent. No API path is a page
// (`test/workers/f4-pages.test.ts`).

/** A chat's id as the Person mints it (routes.ts' `CHAT_ID`, the same shape). */
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

export interface PageRow {
  /** The row's name, which a test and the router branch on. */
  name: string;
  /** An anchored regular expression's source; the first group, when there is one, is the page's id. */
  pattern: string;
  /** The `#stage` view it draws. */
  view: "chat" | "feed" | "goals" | "library" | "settings";
  /** The id is path segments, decoded one by one (`segmentsOf`); a row of a Library collection. */
  segments?: true;
  /** A path that matches, for the tests and the docs. */
  example: string;
}

/** The Library's collections, each with an example id: one row registers one (`artifacts` is D-0010's to add). */
export const COLLECTIONS: Record<string, string> = { files: "notes/plan.md" };

export const PAGES: readonly PageRow[] = [
  { name: "home", pattern: "^/$", view: "chat", example: "/" },
  { name: "new", pattern: "^/chats/new$", view: "chat", example: "/chats/new" },
  { name: "chat", pattern: `^/chats/(${UUID})$`, view: "chat", example: "/chats/6f1c2a4e-8b3d-4c5e-9f70-1a2b3c4d5e6f" },
  { name: "feed", pattern: "^/feed$", view: "feed", example: "/feed" },
  { name: "goals", pattern: "^/goals$", view: "goals", example: "/goals" },
  { name: "library", pattern: "^/library$", view: "library", example: "/library" },
  ...Object.entries(COLLECTIONS).map(([c, id]) => ({ name: c, pattern: `^/library/${c}/(.+)$`, view: "library" as const, segments: true as const, example: `/library/${c}/${id}` })),
  { name: "settings", pattern: "^/settings(?:/(?:general(?:/(?:company|loops))?|connectors(?:/[^/]+)?|permissions|devices|messaging|help))?$", view: "settings", example: "/settings/connectors" },
];

const COMPILED = PAGES.map((p) => ({ row: p, re: new RegExp(p.pattern) }));

/**
 * A collection id's path from its address segments, each decoded alone, or null when one is empty, `.` or `..`, is not
 * percent-encoding or decodes to a slash: two addresses never name one file, and none climbs out of the collection.
 */
export function segmentsOf(encoded: string): string | null {
  const out: string[] = [];
  for (const seg of encoded.split("/")) {
    let s: string;
    try {
      s = decodeURIComponent(seg);
    } catch {
      return null;
    }
    if (s === "" || s === "." || s === ".." || s.includes("/")) return null;
    out.push(s);
  }
  return out.join("/");
}

/** The row a path is, and its id, or null when the path is no page. */
export function pageOf(path: string): { row: PageRow; id: string | null } | null {
  for (const { row, re } of COMPILED) {
    const m = re.exec(path);
    if (!m) continue;
    if (!row.segments) return { row, id: m[1] ?? null };
    const id = segmentsOf(m[1] ?? "");
    return id === null ? null : { row, id };
  }
  return null;
}

/** A Library thing's address: its collection and its path, each segment encoded alone. */
export const collectionPath = (collection: string, path: string) => `/library/${collection}/${path.split("/").map(encodeURIComponent).join("/")}`;

/** A browser navigating to a page, as opposed to a script or API caller reading JSON. */
export const wantsPage = (request: Request) => request.method === "GET" && (request.headers.get("accept") ?? "").includes("text/html");

/** A chat's address, and a message's in it (the fragment names the bubble's `mid`). */
export const chatPath = (chatId: string, mid?: string | null) => `/chats/${encodeURIComponent(chatId)}${mid ? `#${encodeURIComponent(mid)}` : ""}`;

/** The drafted placeholder's address (F8): a chat not yet made. */
export const NEW_CHAT_PATH = "/chats/new";
