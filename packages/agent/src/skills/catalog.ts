// Skills from R2 (AD-7, muse-reference section 4): a directory with a SKILL.md whose frontmatter
// carries `name`, `description` (the routing text) and optionally `metadata.includeInPrompt`. A
// skill has a scope by where it lives: platform skills under `skills/platform/`, company skills
// under `skills/company/` (a company tenant only), personal skills under the person's home. The
// catalog a person sees is the union of the scopes they may use, decided here on every call. From M11
// team skills live under `skills/teams/<id>/` and reach the team's members only. From M11.2 platform
// skills also ship with the script (`builtin.ts`), keyed `builtin:<name>`.
import { homeKey } from "../memory/home.ts";
import { searchTerms } from "../tools/registry.ts";
import type { BuiltinSkill } from "./builtin.ts";
import { DOCS_PREFIX, parseDoc } from "./platform-docs.ts";

export type SkillScope = "personal" | "team" | "company" | "platform" | "docs";
export type TenantShape = "company" | "standalone";

export interface SkillMeta {
  name: string;
  description: string;
  scope: SkillScope;
  includeInPrompt: boolean;
  /** The R2 key of the SKILL.md. */
  key: string;
}

export type SkillRefusal = { ok: false; code: "SKILL_NOT_FOUND" | "SKILL_UNAVAILABLE"; reason: string };
export type SkillRead = { ok: true; skill: SkillMeta; body: string } | SkillRefusal;

const SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const SKILL_FILE = "SKILL.md";

/** Minimal frontmatter: `key: value` lines between `---` fences; `includeInPrompt` read wherever it sits. */
export function parseSkillFile(text: string): { name: string; description: string; includeInPrompt: boolean; body: string } | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return null;
  const front = m[1] ?? "";
  const field = (key: string) => {
    const line = new RegExp(`^${key}:[ \\t]*(.*)$`, "m").exec(front)?.[1]?.trim() ?? "";
    return line.replace(/^(['"])(.*)\1$/, "$2");
  };
  const name = field("name");
  const description = field("description");
  if (!SKILL_NAME.test(name) || !description) return null;
  const includeInPrompt = /^\s*includeInPrompt:\s*true\s*$/m.test(front);
  return { name, description, includeInPrompt, body: m[2] ?? "" };
}

export interface SkillBucket {
  list(options: { prefix: string }): Promise<{ objects: Array<{ key: string }>; truncated: boolean }>;
  get(key: string): Promise<{ text(): Promise<string> } | null>;
}

export class SkillCatalog {
  private readonly bucket: SkillBucket;
  private readonly shape: TenantShape;

  private readonly teamsOf: ((person: string) => Promise<string[]>) | undefined;

  private readonly builtins: readonly BuiltinSkill[];

  /**
   * `teamsOf` names the person's teams, whose skills (`skills/teams/<id>/`, from M11's ladder) they
   * may use; `builtins` are platform skills shipped with the script (M11.2).
   */
  constructor(bucket: SkillBucket, shape: TenantShape, teamsOf?: (person: string) => Promise<string[]>, builtins: readonly BuiltinSkill[] = []) {
    this.bucket = bucket;
    this.shape = shape;
    this.teamsOf = teamsOf;
    this.builtins = builtins;
  }

  /** The scopes this person may use, and where each lives; a standalone tenant has no company scope. */
  scopes(person: string): Array<{ scope: SkillScope; prefix: string }> {
    const out: Array<{ scope: SkillScope; prefix: string }> = [{ scope: "platform", prefix: "skills/platform/" }];
    if (this.shape === "company") out.push({ scope: "company", prefix: "skills/company/" });
    out.push({ scope: "personal", prefix: homeKey(person, "skills/") });
    return out;
  }

  /** Every skill the person may use, with its scope. A SKILL.md that does not parse is skipped. */
  async list(person: string): Promise<SkillMeta[]> {
    const out: SkillMeta[] = [];
    const teams = this.shape === "company" && this.teamsOf ? await this.teamsOf(person) : [];
    const scopes = [...this.scopes(person), ...teams.map((t) => ({ scope: "team" as const, prefix: `skills/teams/${t}/` }))];
    for (const { scope, prefix } of scopes) {
      const listed = await this.bucket.list({ prefix });
      for (const obj of listed.objects) {
        const rest = obj.key.slice(prefix.length);
        const m = new RegExp(`^([^/]+)/${SKILL_FILE}$`).exec(rest);
        if (!m?.[1]) continue;
        const file = await this.bucket.get(obj.key);
        const parsed = file ? parseSkillFile(await file.text()) : null;
        if (!parsed || parsed.name !== m[1]) continue;
        out.push({ name: parsed.name, description: parsed.description, scope, includeInPrompt: parsed.includeInPrompt, key: obj.key });
      }
    }
    // The platform docs (M24.1): `docs/platform/<slug>.md`, named `docs/<slug>`; every tenant has them.
    const docs = await this.bucket.list({ prefix: DOCS_PREFIX });
    for (const obj of docs.objects) {
      const slug = /^([a-z0-9][a-z0-9-]*)\.md$/.exec(obj.key.slice(DOCS_PREFIX.length))?.[1];
      const file = slug ? await this.bucket.get(obj.key) : null;
      const parsed = file ? parseDoc(await file.text()) : null;
      if (slug && parsed) out.push({ name: `docs/${slug}`, description: `${parsed.summary} Read when: ${parsed.readWhen}`, scope: "docs", includeInPrompt: false, key: obj.key });
    }
    for (const b of this.builtins) {
      if (!out.some((s) => s.scope === "platform" && s.name === b.name)) out.push({ name: b.name, description: b.description, scope: "platform", includeInPrompt: b.includeInPrompt, key: `builtin:${b.name}` });
    }
    return out;
  }

  /** The prefix shortlist: skills marked for the prompt, within the person's union. */
  async shortlist(person: string): Promise<SkillMeta[]> {
    return (await this.list(person)).filter((s) => s.includeInPrompt);
  }

  /** Routing by description over the person's union, best match first; nothing outside it is ever returned. */
  async search(query: string, person: string): Promise<SkillMeta[]> {
    const terms = searchTerms(query);
    return (await this.list(person))
      .map((s) => ({ s, score: terms.filter((t) => `${s.name} ${s.description}`.toLowerCase().includes(t)).length }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.s.name.localeCompare(b.s.name))
      .map((x) => x.s);
  }

  /** The body of a skill in the person's union; a skill outside it does not exist for them. */
  async read(name: string, person: string): Promise<SkillRead> {
    const skill = (await this.list(person)).find((s) => s.name === name);
    if (!skill) return { ok: false, code: "SKILL_NOT_FOUND", reason: `no skill named ${name} that you may use` };
    const builtin = skill.key.startsWith("builtin:") ? this.builtins.find((b) => `builtin:${b.name}` === skill.key) : undefined;
    if (builtin) return { ok: true, skill, body: builtin.body };
    const file = await this.bucket.get(skill.key);
    if (skill.scope === "docs") {
      const doc = file ? parseDoc(await file.text()) : null;
      return doc ? { ok: true, skill, body: doc.body } : { ok: false, code: "SKILL_UNAVAILABLE", reason: `${name} could not be read` };
    }
    const parsed = file ? parseSkillFile(await file.text()) : null;
    if (!parsed) return { ok: false, code: "SKILL_UNAVAILABLE", reason: `${name} could not be read` };
    return { ok: true, skill, body: parsed.body };
  }
}
