// The PWA (M4.1, M14.2, M23.1, M23.2, M26.1, M27.1, M27.2): one page with four routes, chat, feed, goals and library, each
// at its own address since F4 (the grammar in `pages.ts`, drawn by `app/router.ts`), the
// agent's panel and the Settings dialog, a web app manifest and a service worker, served only to a request
// that carries a verified session. The page is an assembler: the stylesheet, the frame, the chat, the list
// views, the panel and Settings are modules under
// `app/`, concatenated into one document with one script, because the page is script text the hermetic suite
// runs as shipped. The page holds no state the objects do not, and decides nothing: every action is a request
// the agent script and its objects answer with a code, and the page says the answer in words. Text from the
// server is always set as text, never as markup.
//
// The history of the chat's behaviour is kept in `app/chat.ts` where the code lives: M18.1 (a send is drawn as
// sent only once the chat answers `turn_started`), M19.1 (a socket quiet while a turn is shown working is
// asked for the chat's state, and a `turn_done` whose reply the page drew less of than the chat streamed asks
// for the history once) and M20.1 (a card is drawn once per id, and no code is shown as words).

import { ACTIVITY_CSS, ACTIVITY_MARKUP, ACTIVITY_SCRIPT } from "./app/activity.ts";
import { CHAT_CSS, CHAT_MARKUP, CHAT_SCRIPT } from "./app/chat.ts";
import { CONNECTOR_PANE, CONNECTORS_CSS, CONNECTORS_PANE, CONNECTORS_SCRIPT, PERMISSIONS_PANE } from "./app/connectors.ts";
import { GOALS_FEED_CSS, GOALS_FEED_MARKUP, GOALS_FEED_SCRIPT } from "./app/goals-feed.ts";
import { LIBRARY_CSS, LIBRARY_MARKUP, LIBRARY_SCRIPT } from "./app/library.ts";
import { PANEL_CSS, PANEL_MARKUP, PANEL_SCRIPT } from "./app/panel.ts";
import { CHATS_FILTER_CSS, CHATS_FILTER_SCRIPT } from "./app/chats-filter.ts";
import { SEARCH_CSS, SEARCH_MARKUP, SEARCH_SCRIPT } from "./app/search.ts";
import { SETTINGS_CSS, SETTINGS_SCRIPT, settingsMarkup } from "./app/settings.ts";
import { APP_VIEWS, COMMON_SCRIPT, SHELL_CSS, SHELL_SCRIPT, shellMarkup } from "./app/shell.ts";
import { BUNDLE_CSS, TOKENS_CSS } from "./app/tokens.ts";
import { ROUTER_MARKUP, ROUTER_SCRIPT } from "./app/router.ts";
import { RECONNECT_SCRIPT } from "./reconnect.ts";

export { NO_CHOICES_TEXT, NOT_DECIDED_TEXT, NOT_DONE_TEXT, NOT_SENT_TEXT, TURN_CHECK_MS } from "./app/chat.ts";
export { PUSH_REFUSED_TEXT } from "./app/settings.ts";
export { APP_VIEWS };

/**
 * The page's one stylesheet (M27.1): the Fletch system's custom properties (the canvas's tokens.css), its
 * `bundle.css` as it is (the `qf-` classes and the `.t-*` type roles), then each module's own rules. The fonts are
 * the stack the tokens name; nothing is shipped or fetched (Q-M27-1). The shell and the Settings frame are on the
 * `qf-` classes since M27.2; until M27.3 to M27.7 move the surfaces inside, their old markup renders unstyled.
 */
export const PAGE_CSS = `${TOKENS_CSS}${BUNDLE_CSS}\n${SHELL_CSS}${SETTINGS_CSS}${GOALS_FEED_CSS}${CONNECTORS_CSS}${SEARCH_CSS}${CHATS_FILTER_CSS}${CHAT_CSS}${PANEL_CSS}${ACTIVITY_CSS}${LIBRARY_CSS}`;

export const APP_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#F3F6F4" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#111714" media="(prefers-color-scheme: dark)">
<title>fletch</title>
<link rel="manifest" href="/manifest.webmanifest" crossorigin="use-credentials">
<style>${PAGE_CSS}</style>
</head>
<body>
${shellMarkup({ chat: CHAT_MARKUP, views: GOALS_FEED_MARKUP + LIBRARY_MARKUP + ROUTER_MARKUP, panel: PANEL_MARKUP, settings: settingsMarkup({ connectors: CONNECTORS_PANE, connector: CONNECTOR_PANE, permissions: PERMISSIONS_PANE }), search: SEARCH_MARKUP, task: ACTIVITY_MARKUP })}
<script>
${RECONNECT_SCRIPT}
${COMMON_SCRIPT}
${CHAT_SCRIPT}
${SETTINGS_SCRIPT}
${LIBRARY_SCRIPT}
${GOALS_FEED_SCRIPT}
${CONNECTORS_SCRIPT}
${SEARCH_SCRIPT}
${CHATS_FILTER_SCRIPT}
${PANEL_SCRIPT}
${ACTIVITY_SCRIPT}
${SHELL_SCRIPT}
${ROUTER_SCRIPT}
</script>
</body>
</html>`;

export const MANIFEST = JSON.stringify({
  name: "fletch",
  short_name: "fletch",
  start_url: "/",
  scope: "/",
  display: "standalone",
  background_color: "#ffffff",
  theme_color: "#2563eb",
  icons: [{ src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 96 96'%3E%3Crect width='96' height='96' rx='20' fill='%232563eb'/%3E%3C/svg%3E", sizes: "any", type: "image/svg+xml" }],
});

/** Installable shell only: every request goes to the network, so nothing a session saw is cached. */
export const SERVICE_WORKER = `self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  // Only this origin's own requests are answered here; anything else (an analytics beacon a content
  // blocker stops) goes to the network untouched, so its failure is the page's, not this worker's.
  if (new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(fetch(e.request));
});
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch {}
  e.waitUntil(self.registration.showNotification(d.title || "qyvr", { body: d.body || "", tag: (d.items || [])[0], data: { url: d.url || "/" } }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.openWindow((e.notification.data && e.notification.data.url) || "/"));
});
`;
