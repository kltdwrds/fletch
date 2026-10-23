// The Chromium tests' one route handler (F4): every path of the page grammar (`pages.ts`) is answered with the page,
// as the agent script answers it, and every other request with the world's JSON, so a page that moves its own address
// (`/` becomes `/chats/<id>`) reloads as it would on a deploy. Other origins are aborted: the tests see no network.
import type { BrowserContext } from "playwright-core";
import { APP_PAGE } from "../../../packages/agent/src/http/page.ts";
import { pageOf } from "../../../packages/agent/src/http/pages.ts";

export const PAGE_ORIGIN = "https://solo-sam.example";

/** What answers the page's API requests: a world's `http`, as the signed-in person. */
export type Answer = (method: string, path: string, body?: unknown) => Promise<{ status: number; body: unknown }>;

export function servePages(ctx: BrowserContext, answer: Answer, html: string = APP_PAGE) {
  return ctx.route("**/*", async (r) => {
    const url = new URL(r.request().url());
    if (url.origin !== PAGE_ORIGIN) return r.abort();
    if (r.request().method() === "GET" && pageOf(url.pathname)) return r.fulfill({ status: 200, contentType: "text/html", body: html });
    const body = r.request().postData();
    const a = await answer(r.request().method(), url.pathname + url.search, body ? JSON.parse(body) : undefined);
    return r.fulfill({ status: a.status, contentType: "application/json", body: JSON.stringify(a.body) });
  });
}
