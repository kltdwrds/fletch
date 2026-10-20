// Company skills (memory-and-learning.md "Writes", AD-7, M10.2): skills every member's agent may use,
// under `skills/company/` in the tenant bucket where the catalog (M3.1) already reads them. Company
// scope is written only by admins in person and by promotions an admin merged (M11, `learning/`); no
// tool writes here, so an agent, which can be steered by what it reads, never does.
import { parseSkillFile, SKILL_FILE } from "../skills/catalog.ts";
import { writeSkillFile } from "../learning/skill-files.ts";
import { isAdminRole, type CompanyMembers, normalizeEmail } from "./members.ts";

export const COMPANY_SKILLS_PREFIX = "skills/company/";
const MAX_SKILL_CHARS = 32_000;

export interface SkillsBucket {
  put(key: string, value: string, options?: { customMetadata?: Record<string, string> }): Promise<unknown>;
  get(key: string): Promise<{ text(): Promise<string>; customMetadata?: Record<string, string> } | null>;
  head(key: string): Promise<{ customMetadata?: Record<string, string> } | null>;
  delete(key: string): Promise<void>;
  list(options: { prefix: string }): Promise<{ objects: Array<{ key: string }> }>;
}

export interface CompanySkill {
  name: string;
  description: string;
  /** The whole SKILL.md as the catalog reads it. */
  text: string;
}

type Refusal = { ok: false; code: string; reason: string };
const notAdmin: Refusal = { ok: false, code: "NOT_AN_ADMIN", reason: "only an admin writes company skills" };
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

export const companySkillKey = (name: string) => `${COMPANY_SKILLS_PREFIX}${name}/${SKILL_FILE}`;

export class CompanySkills {
  private readonly members: CompanyMembers;
  private readonly bucket: SkillsBucket | undefined;
  private readonly shape: string;

  constructor(members: CompanyMembers, bucket: SkillsBucket | undefined, shape: string) {
    this.members = members;
    this.bucket = bucket;
    this.shape = shape;
  }

  private refuse(by: string): Refusal | null {
    if (!isAdminRole(this.members.lookup(by)?.role)) return notAdmin;
    if (this.shape !== "company") return { ok: false, code: "COMPANY_SKILLS_STANDALONE", reason: "a standalone tenant has no company scope" };
    if (!this.bucket) return { ok: false, code: "COMPANY_SKILLS_UNAVAILABLE", reason: "the tenant bucket is not bound" };
    return null;
  }

  /** An admin writes or replaces a company skill; the file must parse as the catalog reads it. */
  async write(by: string, input: unknown): Promise<{ ok: true; skill: CompanySkill } | Refusal> {
    const refused = this.refuse(by);
    if (refused) return refused;
    const i = (input ?? {}) as Record<string, unknown>;
    const name = typeof i.name === "string" ? i.name : "";
    const description = typeof i.description === "string" ? oneLine(i.description) : "";
    const body = typeof i.body === "string" ? i.body : "";
    const text = `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\nmetadata:\n  scope: company\n---\n${body}`;
    const parsed = parseSkillFile(text);
    if (!parsed || parsed.name !== name || parsed.description !== description || text.length > MAX_SKILL_CHARS) return { ok: false, code: "SKILL_INVALID", reason: `a skill has a lower-case name, a one-line description and at most ${MAX_SKILL_CHARS} characters` };
    // An admin's own write is a human edit: kept with history, and locked against agents' versions (M11).
    if (this.bucket) await writeSkillFile(this.bucket, COMPANY_SKILLS_PREFIX, name, text, `person:${normalizeEmail(by)}`, Date.now());
    return { ok: true, skill: { name, description, text } };
  }

  async remove(by: string, name: string): Promise<{ ok: true } | Refusal> {
    const refused = this.refuse(by);
    if (refused) return refused;
    if (!(await this.bucket?.get(companySkillKey(name)))) return { ok: false, code: "SKILL_NOT_FOUND", reason: `no company skill ${name}` };
    await this.bucket?.delete(companySkillKey(name));
    return { ok: true };
  }

  /** Every company skill that parses, by name. */
  async list(): Promise<CompanySkill[]> {
    if (!this.bucket || this.shape !== "company") return [];
    const out: CompanySkill[] = [];
    for (const obj of (await this.bucket.list({ prefix: COMPANY_SKILLS_PREFIX })).objects) {
      const m = new RegExp(`^${COMPANY_SKILLS_PREFIX}([^/]+)/${SKILL_FILE}$`).exec(obj.key);
      const file = m ? await this.bucket.get(obj.key) : null;
      const text = file ? await file.text() : "";
      const parsed = parseSkillFile(text);
      if (m && parsed && parsed.name === m[1]) out.push({ name: parsed.name, description: parsed.description, text });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }
}
