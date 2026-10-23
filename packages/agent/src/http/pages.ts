// The page grammar (F4, D-0009): every address the app answers with its page, as data both sides read. The server
// serves `APP_PAGE` for a GET on exactly these paths (routes.ts) and the page with a 404 to a browser asking for any
// other path; the page script gets the same rows as JSON (app/router.ts) and draws the view a row names. A pattern is
// a regular expression's source, anchored, so the one table serves `RegExp` on both sides; its first group is the
// row's id. A row with no `view` is reserved (the Library's collections for F6): it is a page the server serves, and
// the shell says it draws nothing there yet. Settings' addresses (F5) are its panes, each drawn over the page it was
// opened from: `/settings`, `/settings/<pane>`, a nested pane under its parent's and a connector at
// `/settings/connectors/<id>`. A message's position is the fragment (`/chats/<id>#<mid>`), which the server never
// sees. No API path is a page (`test/workers/f4-pages.test.ts`).

/** A chat's id as the Person mints it (routes.ts' `CHAT_ID`, the same shape). */
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

export interface PageRow {
  /** The row's name, which a test and the router branch on. */
  name: string;
  /** An anchored regular expression's source; the first group, when there is one, is the page's id. */
  pattern: string;
  /** The `#stage` view it draws, or null for a row reserved for a later part. */
  view: "chat" | "feed" | "goals" | "library" | "settings" | null;
  /** A path that matches, for the tests and the docs. */
  example: string;
}

export const PAGES: readonly PageRow[] = [
  { name: "home", pattern: "^/$", view: "chat", example: "/" },
  { name: "chat", pattern: `^/chats/(${UUID})$`, view: "chat", example: "/chats/6f1c2a4e-8b3d-4c5e-9f70-1a2b3c4d5e6f" },
  { name: "feed", pattern: "^/feed$", view: "feed", example: "/feed" },
  { name: "goals", pattern: "^/goals$", view: "goals", example: "/goals" },
  { name: "library", pattern: "^/library$", view: "library", example: "/library" },
  { name: "collection", pattern: "^/library/([a-z][a-z0-9-]*/[^/]+(?:/[^/]+)*)$", view: null, example: "/library/files/notes/plan.md" },
  { name: "settings", pattern: "^/settings(?:/(?:general(?:/(?:company|loops))?|connectors(?:/[^/]+)?|permissions|devices|messaging|help))?$", view: "settings", example: "/settings/connectors" },
];

const COMPILED = PAGES.map((p) => ({ row: p, re: new RegExp(p.pattern) }));

/** The row a path is, and its id, or null when the path is no page. */
export function pageOf(path: string): { row: PageRow; id: string | null } | null {
  for (const { row, re } of COMPILED) {
    const m = re.exec(path);
    if (m) return { row, id: m[1] ?? null };
  }
  return null;
}

/** A browser navigating to a page, as opposed to a script or API caller reading JSON. */
export const wantsPage = (request: Request) => request.method === "GET" && (request.headers.get("accept") ?? "").includes("text/html");

/** A chat's address, and a message's in it (the fragment names the bubble's `mid`). */
export const chatPath = (chatId: string, mid?: string | null) => `/chats/${encodeURIComponent(chatId)}${mid ? `#${encodeURIComponent(mid)}` : ""}`;
