// The narrowing check (memory-and-learning.md "Promotion ladder", M5): promotion is a delegation and
// only narrows, so a skill promoted to a shared scope may use only capabilities every reader of that
// scope holds. A pure function of the skill's declared tools and connectors and what each member
// holds; the declaration is read from the skill file itself, and a `cred://` reference or a known
// tool named in the body but not declared is refused, so the declaration cannot understate the skill.
import { parseSkillFile } from "../skills/catalog.ts";

/** Every tool an agent carries, with the connector it needs (null: every member's agent has it). */
export const AGENT_TOOLS: Readonly<Record<string, string | null>> = {
  send_to_user: null,
  tool_search: null,
  memory_search: null,
  memory_get: null,
  memory_explain: null,
  memory_write: null,
  file_list: null,
  file_read: null,
  file_write: null,
  file_edit: null,
  file_grep: null,
  file_find: null,
  file_delete: null,
  skill_search: null,
  skill_read: null,
  code_execute: null,
  colleagues_directory: null,
  colleagues_check_grant: null,
  colleagues_request: null,
  subagents_delegate: null,
  subagents_close: null,
  subagents_status: null,
  browse_open: null,
  browse_live: null,
  browse_handoff: null,
  browse_fill: null,
  github_repo: "github",
  github_issues: "github",
  hn_top: "hackernews",
  hn_item: "hackernews",
  workspace_list: "workspace",
  workspace_create: "workspace",
  workspace_build: "workspace",
  workspace_app: "workspace",
  workspace_bind: "workspace",
  workspace_context: "workspace",
  workspace_hook: "workspace",
  workspace_hooks: "workspace",
  workspace_approvals: "workspace",
};

/** Connectors that need no credential: every member holds them. */
export const PUBLIC_CONNECTORS: readonly string[] = ["hackernews"];

export interface Declared {
  tools: string[];
  connectors: string[];
}

export interface Holding {
  member: string;
  connectors: readonly string[];
}

export type Shortfall = { member: string; tools: string[]; connectors: string[] };
export type NarrowingResult =
  | { ok: true }
  | { ok: false; code: "PROMOTION_EXCEEDS_SCOPE"; reason: string; shortfall: Shortfall[] }
  | { ok: false; code: "PROMOTION_UNDECLARED"; reason: string; undeclared: string[] }
  | { ok: false; code: "PROMOTION_NO_READERS"; reason: string };

const list = (front: string, key: string): string[] => {
  const raw = new RegExp(`^\\s*${key}:[ \\t]*(.*)$`, "m").exec(front)?.[1]?.trim() ?? "";
  return raw.replace(/^\[|\]$/g, "").split(",").map((s) => s.trim().replace(/^(['"])(.*)\1$/, "$2")).filter(Boolean);
};

/** The tools and connectors a skill file declares in its frontmatter (`tools:` and `connectors:`, comma lists). */
export function declaredOf(text: string): Declared | null {
  if (!parseSkillFile(text)) return null;
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? "";
  return { tools: list(front, "tools"), connectors: list(front, "connectors") };
}

/** What the body uses that the frontmatter does not declare: `cred://` references and known tool names. */
export function undeclaredUses(text: string, declared: Declared): string[] {
  const body = parseSkillFile(text)?.body ?? "";
  const out = new Set<string>();
  for (const m of body.matchAll(/cred:\/\/(?:company-)?([a-z][a-z0-9-]{0,39})/g)) if (m[1] && !declared.connectors.includes(m[1])) out.add(`cred://${m[1]}`);
  for (const tool of Object.keys(AGENT_TOOLS)) if (new RegExp(`\\b${tool}\\b`).test(body) && !declared.tools.includes(tool)) out.add(tool);
  return [...out].sort();
}

/** The connectors a declaration needs, its own and those its tools need. */
export function neededConnectors(d: Declared): string[] {
  const needed = new Set(d.connectors);
  for (const t of d.tools) {
    const c = AGENT_TOOLS[t];
    if (c) needed.add(c);
  }
  return [...needed].sort();
}

/**
 * The check itself: every declared tool must be a tool agents carry, and every member who will read
 * the target scope must hold every connector the skill needs. An unknown tool is held by nobody.
 */
export function narrowingCheck(text: string, holders: readonly Holding[]): NarrowingResult {
  const declared = declaredOf(text);
  if (!declared) return { ok: false, code: "PROMOTION_UNDECLARED", reason: "the skill file does not parse", undeclared: [] };
  const undeclared = undeclaredUses(text, declared);
  if (undeclared.length) return { ok: false, code: "PROMOTION_UNDECLARED", reason: `the skill uses what it does not declare: ${undeclared.join(", ")}`, undeclared };
  if (!holders.length) return { ok: false, code: "PROMOTION_NO_READERS", reason: "the target scope has no members to hold the skill's capabilities" };
  const needed = neededConnectors(declared);
  const unknown = declared.tools.filter((t) => !(t in AGENT_TOOLS));
  const shortfall: Shortfall[] = [];
  for (const h of holders) {
    const missing = needed.filter((c) => !h.connectors.includes(c));
    if (missing.length || unknown.length) shortfall.push({ member: h.member, tools: unknown, connectors: missing });
  }
  if (!shortfall.length) return { ok: true };
  const what = [...new Set(shortfall.flatMap((s) => [...s.tools, ...s.connectors]))].sort().join(", ");
  return { ok: false, code: "PROMOTION_EXCEEDS_SCOPE", reason: `not every member of the target scope holds: ${what}`, shortfall };
}
