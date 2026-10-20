// The workspace mirror (memory-and-learning.md "Scopes", AD-6, M10.2): company scope and the company
// instructions copied into upstream's public context collection and admin instructions, so the
// workspace's build agent reads the same knowledge as every member's agent. Company scope only: team
// lines never leave the `Company`, since a public collection is read by everyone in the domain.
//
// The mirror runs after an admin's write, as that admin's agent session through the adapter, so the
// workshop decides as it would for the admin in person (a public collection is an admin's to write).
// Each run is recorded with its outcome; a failed or partial mirror is reported, never shown as done.
import type { ActingAs, AdapterResult, CompanyMirrorAdapter, MirrorDocument } from "../workspace/adapters.ts";
import type { CompanySkill } from "./skills.ts";

export const SCHEMA = "CREATE TABLE IF NOT EXISTS mirror_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, by TEXT NOT NULL, ok INTEGER NOT NULL, code TEXT, collection TEXT, documents INTEGER NOT NULL);";

export const mirrorTitle = (tenant: string) => `Company: ${tenant}`;
export const MIRROR_DESCRIPTION = "The company's terminology, procedures, instructions and skills, kept in step with qyvr's company scope. Written by admins; read by everyone.";

export interface MirrorSource {
  instructions: string;
  /** Company-scope days as rendered (`company/memory/<date>.md`). */
  memory: Array<{ path: string; text: string }>;
  skills: CompanySkill[];
}

/** The documents a mirror writes; nothing outside company scope is ever among them. */
export function mirrorDocuments(s: MirrorSource): MirrorDocument[] {
  return [
    { path: "instructions.md", description: "The company instructions every agent reads.", text: s.instructions.trim() ? s.instructions : "(no company instructions)" },
    ...s.memory.filter((m) => /^company\/memory\/\d{4}-\d{2}-\d{2}\.md$/.test(m.path)).map((m) => ({ path: m.path.slice("company/".length), description: "Company memory for one day.", text: m.text })),
    ...s.skills.map((k) => ({ path: `skills/${k.name}/SKILL.md`, description: k.description, text: k.text })),
  ];
}

export type MirrorOutcome = { ok: true; collection: string; documents: number } | { ok: false; code: string; reason: string };

export interface MirrorRun {
  at: number;
  by: string;
  ok: boolean;
  code: string | null;
  collection: string | null;
  documents: number;
}

export class CompanyMirror {
  private readonly storage: Pick<DurableObjectStorage, "sql">;
  private readonly tenant: string;
  private readonly adapter: CompanyMirrorAdapter | null;
  private readonly now: () => number;

  constructor(storage: Pick<DurableObjectStorage, "sql">, tenant: string, adapter: CompanyMirrorAdapter | null, now: () => number) {
    this.storage = storage;
    this.tenant = tenant;
    this.adapter = adapter;
    this.now = now;
  }

  private get sql(): SqlStorage {
    return this.storage.sql;
  }

  /** One mirror as `by`'s agent session: the collection's documents first, then the instructions. */
  async run(by: string, source: MirrorSource): Promise<MirrorOutcome> {
    const outcome = await this.attempt(by, source);
    this.sql.exec(
      "INSERT INTO mirror_runs (at, by, ok, code, collection, documents) VALUES (?, ?, ?, ?, ?, ?)",
      this.now(), by, outcome.ok ? 1 : 0, outcome.ok ? null : outcome.code, outcome.ok ? outcome.collection : null, outcome.ok ? outcome.documents : 0,
    );
    return outcome;
  }

  private async attempt(by: string, source: MirrorSource): Promise<MirrorOutcome> {
    if (!this.adapter) return { ok: false, code: "MIRROR_UNAVAILABLE", reason: "this tenant has no workspace to mirror into" };
    const as: ActingAs = { tenant: this.tenant, person: by, agent: true };
    const docs = mirrorDocuments(source);
    const published = await this.adapter.publishContext(as, { title: mirrorTitle(this.tenant), description: MIRROR_DESCRIPTION }, docs);
    if (!published.ok) return failed(published);
    const set = await this.adapter.setInstructions(as, source.instructions);
    if (!set.ok) return { ok: false, code: `MIRROR_INSTRUCTIONS_${set.code}`, reason: `the collection was written but the admin instructions were not: ${set.reason}` };
    return { ok: true, collection: published.value.collection, documents: published.value.written };
  }

  history(limit = 20): MirrorRun[] {
    return this.sql
      .exec<{ at: number; by: string; ok: number; code: string | null; collection: string | null; documents: number }>("SELECT at, by, ok, code, collection, documents FROM mirror_runs ORDER BY id DESC LIMIT ?", limit)
      .toArray()
      .map((r) => ({ at: r.at, by: r.by, ok: r.ok === 1, code: r.code, collection: r.collection, documents: r.documents }));
  }
}

const failed = (r: Extract<AdapterResult<unknown>, { ok: false }>): MirrorOutcome => ({ ok: false, code: `MIRROR_${r.code}`, reason: r.reason });
