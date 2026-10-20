// Skill files with history and the human-edited lock (memory-and-learning.md "Promotion ladder", M5).
// Every write keeps the previous version under `<dir>/history/`, which the catalog never reads, so a
// rollback is a revert. The writer travels on the object: `person:<email>` is a human's own edit,
// anything else (`promotion:<id>`, `agent:<email>`) is not. Once a human has written a skill, an
// agent's version never replaces it: it lands beside it as `<name>-v<n>`, the first free name.
import { SKILL_FILE } from "../skills/catalog.ts";

export interface SkillFileBucket {
  put(key: string, value: string, options?: { customMetadata?: Record<string, string> }): Promise<unknown>;
  get(key: string): Promise<{ text(): Promise<string>; customMetadata?: Record<string, string> } | null>;
  head(key: string): Promise<{ customMetadata?: Record<string, string> } | null>;
}

export const isHumanWriter = (writer: string | undefined) => !!writer && writer.startsWith("person:");

/** Whether the skill at `prefix<name>` was ever written by a human: the lock is sticky across versions. */
export async function humanEdited(bucket: SkillFileBucket, prefix: string, name: string): Promise<boolean> {
  const meta = (await bucket.head(`${prefix}${name}/${SKILL_FILE}`))?.customMetadata;
  return isHumanWriter(meta?.writer) || meta?.human_edited === "1";
}

export type SkillWrite = { ok: true; name: string; key: string; beside?: string; version: number };

/**
 * Writes `text` (whose frontmatter names `name`) as the skill `prefix<name>`; a human writer may
 * replace anything, an agent's or a promotion's version goes beside a human-edited skill.
 */
export async function writeSkillFile(bucket: SkillFileBucket, prefix: string, name: string, text: string, writer: string, now: number): Promise<SkillWrite> {
  let target = name;
  let beside: string | undefined;
  if (!isHumanWriter(writer) && (await humanEdited(bucket, prefix, name))) {
    beside = name;
    for (let n = 2; ; n++) {
      target = `${name}-v${n}`;
      if (!(await bucket.head(`${prefix}${target}/${SKILL_FILE}`))) break;
    }
  }
  const key = `${prefix}${target}/${SKILL_FILE}`;
  const body = target === name ? text : text.replace(/^(---\r?\n[\s\S]*?^name:[ \t]*)(.*)$/m, `$1${target}`);
  const previous = await bucket.get(key);
  const version = Number(previous?.customMetadata?.version ?? 0) + 1;
  if (previous) await bucket.put(`${prefix}${target}/history/${version - 1}.md`, await previous.text(), { customMetadata: { ...(previous.customMetadata ?? {}) } });
  const sticky = isHumanWriter(writer) || previous?.customMetadata?.human_edited === "1" || isHumanWriter(previous?.customMetadata?.writer);
  await bucket.put(key, body, { customMetadata: { writer, version: String(version), updated_at: String(now), ...(sticky ? { human_edited: "1" } : {}) } });
  return { ok: true, name: target, key, version, ...(beside ? { beside } : {}) };
}
