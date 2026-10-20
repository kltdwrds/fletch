// The personal rung of the promotion ladder (memory-and-learning.md): from a run or a conversation
// into the person's own skills. The referee is the person's own grant for self-learning, decided by
// the grants engine (action `skill.write`, subject the skill's name), and the merge key is the
// person. Under an automatic grant the agent's version is written at once and cites the grant; else
// it waits for the person. A skill the person wrote by hand is never replaced by the agent's version.
import type { Decision, Descriptor } from "../grants/types.ts";
import { homeKey } from "../memory/home.ts";
import { parseSkillFile } from "../skills/catalog.ts";
import { type Actor, skillText } from "./ladder.ts";
import { type SkillFileBucket, type SkillWrite, writeSkillFile } from "./skill-files.ts";

export const SCHEMA = "CREATE TABLE IF NOT EXISTS personal_learning (id TEXT PRIMARY KEY, name TEXT NOT NULL, text TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL);";

export interface PersonalLearningDeps {
  storage: Pick<DurableObjectStorage, "sql">;
  bucket: SkillFileBucket;
  person: string;
  commit(d: Descriptor, effectId: string): Promise<Decision>;
  now(): number;
}

type Refusal = { ok: false; code: string; reason: string };
export type LearnResult = { ok: true; status: "merged"; grantId: string; write: SkillWrite } | { ok: true; status: "pending"; id: string; decision: Decision["decision"] } | Refusal;

export const personalSkillsPrefix = (person: string) => homeKey(person, "skills/");

export class PersonalLearning {
  private readonly d: PersonalLearningDeps;

  constructor(deps: PersonalLearningDeps) {
    this.d = deps;
  }

  private get sql(): SqlStorage {
    return this.d.storage.sql;
  }

  /** The person's agent proposes a skill for the person's own scope. */
  async propose(input: { name: string; description: string; body: string; tools?: string[]; connectors?: string[] }): Promise<LearnResult> {
    const text = skillText(input, "personal");
    if (parseSkillFile(text)?.name !== input.name) return { ok: false, code: "SKILL_INVALID", reason: "a skill has a lower-case name and a one-line description" };
    const id = `pl-${crypto.randomUUID()}`;
    const at = this.d.now();
    const descriptor: Descriptor = {
      actor: `agent:${this.d.person}`,
      principal: this.d.person,
      actionKind: "skill.write",
      subject: { scope: "personal", skill: input.name, ref: `skill:${input.name}` },
      counterpart: { kind: "own-agent" },
      origin: this.d.person,
      hops: 0,
      at,
    };
    const decision = await this.d.commit(descriptor, id);
    if (decision.decision === "auto" && decision.grantId) {
      const write = await writeSkillFile(this.d.bucket, personalSkillsPrefix(this.d.person), input.name, text, `agent:${this.d.person}`, at);
      return { ok: true, status: "merged", grantId: decision.grantId, write };
    }
    this.sql.exec("INSERT INTO personal_learning (id, name, text, status, created_at) VALUES (?, ?, ?, 'pending', ?)", id, input.name, text, at);
    return { ok: true, status: "pending", id, decision: decision.decision };
  }

  /**
   * The weekly skill review's proposal (M12): it waits for the person whatever their grants say, since
   * a loop proposes and never merges; the person merges it in person like any other.
   */
  review(input: { name: string; description: string; body: string; tools?: string[]; connectors?: string[] }): { ok: true; id: string } | Refusal {
    const text = skillText(input, "personal");
    if (parseSkillFile(text)?.name !== input.name || text.length > 32_000) return { ok: false, code: "SKILL_INVALID", reason: "a skill has a lower-case name, a one-line description and at most 32000 characters" };
    const id = `pl-${crypto.randomUUID()}`;
    this.sql.exec("INSERT INTO personal_learning (id, name, text, status, created_at) VALUES (?, ?, ?, 'pending', ?)", id, input.name, text, this.d.now());
    return { ok: true, id };
  }

  /** The person's skills still waiting for them, by id and name. */
  pending(): Array<{ id: string; name: string; text: string }> {
    return this.sql.exec<{ id: string; name: string; text: string }>("SELECT id, name, text FROM personal_learning WHERE status = 'pending' ORDER BY created_at, id").toArray();
  }

  /** The person, in person, merges a pending version; it still never replaces their own hand edit. */
  async merge(actor: Actor, id: string): Promise<{ ok: true; write: SkillWrite } | Refusal> {
    if (actor.kind !== "person" || actor.email !== this.d.person) return { ok: false, code: "PROMOTION_PERSON_ONLY", reason: "only the person merges into their own skills" };
    const row = this.sql.exec<{ name: string; text: string; status: string }>("SELECT name, text, status FROM personal_learning WHERE id = ?", id).toArray()[0];
    if (row?.status !== "pending") return { ok: false, code: "PROMOTION_NOT_FOUND", reason: `no pending skill ${id}` };
    const write = await writeSkillFile(this.d.bucket, personalSkillsPrefix(this.d.person), row.name, row.text, `promotion:${id}`, this.d.now());
    this.sql.exec("UPDATE personal_learning SET status = 'merged' WHERE id = ?", id);
    return { ok: true, write };
  }

  /** The person edits their own skill by hand; from then on the agent's versions go beside it. */
  async editByHand(actor: Actor, input: { name: string; description: string; body: string; tools?: string[]; connectors?: string[] }): Promise<{ ok: true; write: SkillWrite } | Refusal> {
    if (actor.kind !== "person" || actor.email !== this.d.person) return { ok: false, code: "PROMOTION_PERSON_ONLY", reason: "only the person edits their own skills by hand" };
    const text = skillText(input, "personal");
    if (parseSkillFile(text)?.name !== input.name) return { ok: false, code: "SKILL_INVALID", reason: "a skill has a lower-case name and a one-line description" };
    return { ok: true, write: await writeSkillFile(this.d.bucket, personalSkillsPrefix(this.d.person), input.name, text, `person:${this.d.person}`, this.d.now()) };
  }
}
