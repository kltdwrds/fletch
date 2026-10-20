// What a Worker-side conversion answers (M24.3): Markdown with the count of the source's own units
// (pages, sheets, slides), or a code with the reason. A partial parse is never passed on as whole.
export type Converted = { ok: true; markdown: string; units: number } | { ok: false; code: string; reason: string };
