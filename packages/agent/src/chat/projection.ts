// The resume projection (M24.2): the blocks a turn's context was assembled with, recorded once per
// turn, so a step resumed after an eviction replays them instead of assembling again. Before this, a
// resumed step read the clock, the company's instructions, the skills shortlist and the tool
// reference afresh, so it was not the step it replaced. The assembler's output is read as a value:
// the blocks are the messages it placed around the transcript, kept with their positions and a hash. A turn's
// transcript only grows at its end while it runs (steps, steered input), so the positions hold, and
// the resumed request is byte-identical to the one it replaces. Only the system blocks are kept; the
// transcript (thinking included) stays where it is and never enters this record.
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";

export const SCHEMA = `CREATE TABLE IF NOT EXISTS projections (turn_id TEXT PRIMARY KEY, blocks TEXT NOT NULL, hash TEXT NOT NULL, transcript_length INTEGER NOT NULL, at INTEGER NOT NULL);`;

/** One assembled block with its index in the assembled messages; tools are kept by name and bound again on replay. */
interface Block {
  at: number;
  message: Message;
  toolNames?: string[];
}

export type Replayed = { ok: true; messages: Message[] } | { ok: false; code: "PROJECTION_INVALID"; detail: string };

/**
 * FNV-1a over the record, to find a damaged row; not a secret's hash. Synchronous on purpose: a turn's
 * assembly waits on nothing but its own reads, so no clock-free test or step races it.
 */
function digest(text: string): string {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < text.length; i++) h = BigInt.asUintN(64, (h ^ BigInt(text.charCodeAt(i))) * 0x100000001b3n);
  return h.toString(16).padStart(16, "0");
}

export class Projections {
  private readonly sql: SqlStorage;

  constructor(sql: SqlStorage) {
    this.sql = sql;
  }

  has(turnId: string): boolean {
    return this.sql.exec("SELECT turn_id FROM projections WHERE turn_id = ?", turnId).toArray().length > 0;
  }

  /** Records the blocks of `assembled` (every message that is not one of `transcript`'s) the first time a turn assembles. */
  record(turnId: string, assembled: Message[], transcript: Message[], at: number): void {
    const own = new Set(transcript);
    const blocks: Block[] = [];
    assembled.forEach((m, i) => {
      if (own.has(m)) return;
      const tools = (m as { toolsAdded?: Array<{ name: string }> }).toolsAdded;
      const { toolsAdded: _t, ...rest } = m as Message & { toolsAdded?: unknown };
      blocks.push({ at: i, message: rest as Message, ...(tools ? { toolNames: tools.map((t) => t.name) } : {}) });
    });
    const body = JSON.stringify(blocks);
    this.sql.exec("INSERT INTO projections (turn_id, blocks, hash, transcript_length, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(turn_id) DO NOTHING", turnId, body, digest(body), transcript.length, at);
  }

  /** The turn's request rebuilt from its record and the transcript as it stands; the tools bound by name. */
  replay(turnId: string, transcript: Message[], tools: AgentTool<never>[]): Replayed {
    const r = this.sql.exec<{ blocks: string; hash: string; transcript_length: number }>("SELECT blocks, hash, transcript_length FROM projections WHERE turn_id = ?", turnId).toArray()[0];
    if (!r) return { ok: false, code: "PROJECTION_INVALID", detail: "no projection is recorded for this turn" };
    if (digest(r.blocks) !== r.hash) return { ok: false, code: "PROJECTION_INVALID", detail: "the recorded blocks do not match their hash" };
    if (transcript.length < r.transcript_length) return { ok: false, code: "PROJECTION_INVALID", detail: "the transcript is shorter than when the turn assembled" };
    const byName = new Map(tools.map((t) => [t.name, t]));
    const messages: Message[] = [...transcript];
    for (const b of JSON.parse(r.blocks) as Block[]) {
      const bound = b.toolNames ? { ...b.message, toolsAdded: b.toolNames.flatMap((n) => byName.get(n) ?? []) } : b.message;
      messages.splice(b.at, 0, bound as Message);
    }
    return { ok: true, messages };
  }
}
