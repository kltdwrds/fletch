// The F72 surfaces as drawn: the shipped page script under the page harness (`test/workers/support/page-harness.ts`),
// its requests going to the agent script's real routes as Sam over the P13 world's real `Person` objects, so what the
// Library's Audio section lists, what the chat's audio item holds and what Settings > Voice writes is the owning store's
// answer. A hermetic DOM holds which node is where and what each control did to the store; the pixels are Kyle's UAT.
import { type El, page } from "../../workers/support/page-harness.ts";
import { type P13Tier1World, sam } from "./harness.ts";

type Layout = { desktop?: boolean; tablet?: boolean; path?: string };
const settle = async () => {
  for (let i = 0; i < 40; i++) await new Promise((r) => setImmediate(r));
};
/** Every node under `n`, depth first. */
export const nodes = (n: El): El[] => n.children.flatMap((c) => [c, ...nodes(c)]);
/** Waits, bounded, for every player under `n` to hold its signed link (WebCrypto on the thread pool), then settles. */
async function players(n: () => El[]) {
  for (let i = 0; i < 20000 && n().some((a) => a.tag === "audio" && !(a as El & { src?: string }).src && !a.dataset.code); i++) await new Promise((r) => setImmediate(r));
  await settle();
}
export const isPlayer = (a: El) => a.tag === "audio" && /\/app\/file\/raw\?/.test(String((a as El & { src?: string }).src ?? ""));

/** Sam's page at `layout`, its requests answered by the world's real routes. */
export async function samPage(w: P13Tier1World, layout: Layout = {}, plant?: (js: string) => string) {
  const p = await page(
    {
      onSend() {},
      fetch: async (path, init) => {
        const r = await w.w.http(sam.email, init?.method ?? "GET", path, init?.body ? JSON.parse(init.body) : undefined);
        return new Response(JSON.stringify(r.body), { status: r.status });
      },
    },
    layout,
    plant,
  );
  await settle();
  return p;
}

/** The Library's Audio section as drawn at `layout`: each row's record id and whether it holds a player on a signed link. */
export async function libraryAsDrawn(w: P13Tier1World, layout: Layout = { desktop: true }, plant?: (js: string) => string) {
  const p = await samPage(w, layout, plant);
  await p.byId("to-library").onclick?.();
  await settle();
  if (p.ui.device() !== "desktop") {
    await p.byId("lib-pick").onclick?.();
    await settle();
  }
  await p.byId("lib-pick-audio").onclick?.();
  await settle();
  const rows = () => p.byId("lib-list").children.filter((c) => c.className === "lib-audio-row");
  await players(() => rows().flatMap(nodes));
  return { p, rows: rows().map((r) => ({ id: r.dataset.id as string, path: r.dataset.path as string, kind: r.dataset.kind as string, player: nodes(r).some(isPlayer), text: nodes(r).map((n) => n.textContent).join(" ") })) };
}

/** The chat's audio items as a page drawing the chat's own history draws them (a reload), at `layout`. */
export async function chatItemsAsDrawn(w: P13Tier1World, layout: Layout = { desktop: true }, plant?: (js: string) => string) {
  const p = await samPage(w, layout, plant);
  const s = p.sockets[0];
  if (!s) throw new Error("P13_NO_SOCKET: the page opened no chat socket");
  p.open(s);
  p.deliver(s, { type: "history", entries: w.engine().history().entries, running: null });
  const items = () => p.log.children.flatMap((c) => [c, ...nodes(c)]).filter((c) => c.dataset.kind === "audio" && c.dataset.link);
  await players(() => items().flatMap(nodes));
  return items().map((d) => ({ id: d.dataset.link as string, player: nodes(d).some(isPlayer), text: nodes(d).map((n) => n.textContent).join(" "), open: nodes(d).find((n) => n.tag === "a")?.attrs.href ?? (nodes(d).find((n) => n.tag === "a") as El & { href?: string })?.href ?? "" }));
}

/** Sam picks `speaker` in Settings > Voice: the page at `/settings/general`, the select set and changed. */
export async function pickVoice(w: P13Tier1World, speaker: string) {
  const p = await samPage(w, { desktop: true, path: "/settings/general" });
  const select = p.byId("set-voice");
  const offered = select.children.map((o) => o.value);
  select.value = speaker;
  await (select as El & { onchange?: () => unknown }).onchange?.();
  await settle();
  return { offered, note: p.byId("set-voice-note").textContent, code: p.byId("set-voice-note").dataset.code ?? "" };
}
