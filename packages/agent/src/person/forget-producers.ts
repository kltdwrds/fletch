// What a forget plan reads for the jobs and skills that would write a forgotten fact back (M25.4): the person's own job
// definitions, through each `Job` object (which checks the owner again), and the person's own skills from the bucket.
import type { JobDefinition } from "../jobs/body.ts";
import { personalSkillsPrefix } from "../learning/personal.ts";
import type { ForgetProducers } from "../memory/forget.ts";
import { jobName } from "../objects/job.ts";
import { PersonJobIndex } from "./job-index.ts";

type JobInspect = { ok: boolean; code?: string; job?: { def: JobDefinition } | null };

export function forgetProducers(o: { env: Pick<Env, "JOB" | "AGENT_BUCKET">; storage: Pick<DurableObjectStorage, "sql">; person: string }): ForgetProducers {
  return {
    jobs: async () => {
      const out: Array<{ id: string; text: string }> = [];
      for (const id of new PersonJobIndex(o.storage).list()) {
        const r = (await o.env.JOB.get(o.env.JOB.idFromName(jobName(o.person, id))).inspect(o.person)) as JobInspect;
        if (!r.ok || !r.job) throw new Error(`job ${id} could not be read: ${r.code ?? "no definition"}`);
        const d = r.job.def;
        out.push({ id, text: [d.title, d.instructions, ...d.steps.map((s) => ("prompt" in s && typeof s.prompt === "string" ? s.prompt : ""))].join("\n") });
      }
      return out;
    },
    skills: async () => {
      const prefix = personalSkillsPrefix(o.person);
      const out: Array<{ name: string; text: string }> = [];
      for (const obj of (await o.env.AGENT_BUCKET.list({ prefix })).objects) {
        const name = /^([^/]+)\/SKILL\.md$/.exec(obj.key.slice(prefix.length))?.[1];
        const body = name ? await o.env.AGENT_BUCKET.get(obj.key) : null;
        if (name && body) out.push({ name, text: await body.text() });
      }
      return out;
    },
  };
}
