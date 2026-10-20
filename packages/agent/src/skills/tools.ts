// The `skills` namespace: `skill_search` routes by description over the person's union and
// `skill_read` loads a body, which the loop fences as tool output. Both are observations.
import { Type } from "@earendil-works/pi-ai";
import type { Namespace, ToolSpec } from "../tools/registry.ts";
import type { SkillCatalog, SkillMeta } from "./catalog.ts";
import { bodyHash, type SeenState, skillUpdatedNotice } from "./seen.ts";

const SearchParams = Type.Object({ query: Type.String({ minLength: 1, description: "What you need to do, in a few words; matched against skill names and descriptions." }) });
const ReadParams = Type.Object({ name: Type.String({ minLength: 1, description: "The skill's name from skill_search or the shortlist." }) });

const line = (s: SkillMeta) => `- ${s.name} [${s.scope}]: ${s.description}`;

/** Records what the person read and answers whether it changed since; the person's own object keeps it. */
export type SkillSeenCall = (name: string, hash: string) => Promise<SeenState>;

export function skillsNamespace(catalog: SkillCatalog, person: string, seen?: SkillSeenCall): Namespace {
  const search: ToolSpec<typeof SearchParams> = {
    name: "skill_search",
    kind: "observation",
    label: "Find a skill",
    description: "Find a skill by what it is for, across the skills you may use; read the best match before a task it covers.",
    parameters: SearchParams,
    execute: async (_id, p) => {
      const hits = await catalog.search(p.query, person);
      const text = hits.length ? [`${hits.length} skills match "${p.query}"`, ...hits.slice(0, 10).map(line)].join("\n") : `no skill matches "${p.query}"`;
      return { content: [{ type: "text", text }], details: { names: hits.map((h) => h.name) } };
    },
  };
  const read: ToolSpec<typeof ReadParams> = {
    name: "skill_read",
    kind: "observation",
    label: "Read a skill",
    description: "Read a skill's instructions by name.",
    parameters: ReadParams,
    execute: async (_id, p) => {
      const r = await catalog.read(p.name, person);
      if (!r.ok) throw new Error(`${r.code}: ${r.reason}`);
      const notice = seen && (await seen(r.skill.name, await bodyHash(r.body))) === "changed" ? skillUpdatedNotice(r.skill.name) : "";
      return { content: [{ type: "text", text: `${notice}${r.skill.name} [${r.skill.scope}]: ${r.skill.description}\n\n${r.body}` }], details: { scope: r.skill.scope, ...(notice ? { updated: true } : {}) } };
    },
  };
  return { name: "skills", description: "skills: written procedures for tasks", deferral: "eager", tools: [search, read] as ToolSpec[] };
}
