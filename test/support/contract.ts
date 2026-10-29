// A cluster contract (`docs/plan-v2/contracts/P<n>-<cluster>.md`) as F20's check reads it: its clause blocks, task
// blocks and scorecard, and the findings that make the file lie. Pure text over the contract kit's shape (F18): a
// clause block opens `B-P<n>-NN:` in `## Clauses`, a task block `T-P<n>-NN  <priority>  tier <t>` in `## Tasks`,
// each running to the next blank line, its fields inline (`evidence:`, `tags:`, `tasks:`, `file:`).
export interface ClauseBlock {
  id: string;
  line: number;
  evidence: string;
  tags: string;
  /** The task ids the block's `tasks:` field names. */
  tasks: string[];
}

export interface TaskBlock {
  id: string;
  line: number;
  priority: string;
  tier: number;
  file: string | null;
}

export interface ParsedContract {
  clauses: ClauseBlock[];
  tasks: TaskBlock[];
  scorecardRows: string[];
}

export const CLAUSE_HEAD = /^(B-P\d+-\d{2,}):/;
export const TASK_HEAD = /^(T-P\d+-\d{2,})\s+(must-have|nice-to-have)\s+tier\s+(\d)/;
const TASK_ID = /\bT-P\d+-\d{2,}\b/g;
const FIELD = /(?:^|\s)(evidence|tags|tasks|over-cautious|over-bold):/g;

/** An evidence id: a file under the cluster's evidence folder, as the contract cites them. */
export const EVIDENCE_ID = /\banswers\/step-\d+\.md\b|\bstep-\d+-[a-z0-9-]+\.(?:jpg|png|md|json)\b|\btrace\.json\b/;
/** An evidence row, `<table>:<id>`. */
export const EVIDENCE_ROW = /\b[a-z][a-z_]*\.[a-z][a-z_]*:[A-Za-z0-9][A-Za-z0-9-]*/;

/** The named fields of a block: each runs from its marker to the next marker or the block's end. */
function fields(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  const marks = [...block.matchAll(FIELD)];
  marks.forEach((m, i) => {
    const start = (m.index ?? 0) + m[0].length;
    const end = marks[i + 1]?.index ?? block.length;
    out[m[1] as string] = block.slice(start, end).trim();
  });
  return out;
}

/** The sections by `## ` heading: the heading's text to its lines, with the file's line numbers (1-based). */
function sections(text: string): Map<string, Array<{ n: number; text: string }>> {
  const out = new Map<string, Array<{ n: number; text: string }>>();
  let current = "";
  text.split("\n").forEach((line, i) => {
    const h = /^## (.+?)\s*$/.exec(line);
    if (h) {
      current = h[1] as string;
      out.set(current, []);
      return;
    }
    out.get(current)?.push({ n: i + 1, text: line });
  });
  return out;
}

/** The blocks of a section: each opens on a line matching `head` and runs to the next blank line. */
function blocks(lines: Array<{ n: number; text: string }>, head: RegExp): Array<{ n: number; head: RegExpExecArray; body: string }> {
  const out: Array<{ n: number; head: RegExpExecArray; body: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const m = head.exec(lines[i]?.text ?? "");
    if (!m) continue;
    const start = i;
    while (i + 1 < lines.length && (lines[i + 1]?.text ?? "").trim() !== "") i++;
    out.push({ n: lines[start]?.n ?? 0, head: m, body: lines.slice(start, i + 1).map((l) => l.text).join("\n") });
  }
  return out;
}

export function parseContract(text: string): ParsedContract {
  const s = sections(text);
  const clauses = blocks(s.get("Clauses") ?? [], CLAUSE_HEAD).map((b) => {
    const f = fields(b.body);
    return { id: b.head[1] as string, line: b.n, evidence: f.evidence ?? "", tags: f.tags ?? "", tasks: [...(f.tasks ?? "").matchAll(TASK_ID)].map((m) => m[0]) };
  });
  const tasks = blocks(s.get("Tasks") ?? [], TASK_HEAD).map((b) => ({
    id: b.head[1] as string,
    line: b.n,
    priority: b.head[2] as string,
    tier: Number(b.head[3]),
    file: /^\s*file:\s*(\S+)\s*$/m.exec(b.body)?.[1] ?? null,
  }));
  const scorecardRows = (s.get("Scorecard") ?? []).map((l) => l.text).filter((l) => l.includes("|") && !/^level\s*\|/.test(l.trim()));
  return { clauses, tasks, scorecardRows };
}

export interface Finding {
  code: string;
  id: string;
  detail: string;
}

export interface TaskLoader {
  exists(file: string): boolean;
  /** The task module's definition, or null when it cannot be loaded. */
  load(file: string): Promise<{ id: string; clauses: string[] } | null>;
}

const sorted = (xs: string[]) => [...new Set(xs)].sort();

/**
 * What makes the contract lie: a clause with no evidence that is not attested; a task block with no file, a missing
 * or unloadable file, or one whose id or clauses are not the block's; a clause naming a task that is not there; a
 * task naming a clause that is not there; an empty scorecard.
 */
export async function checkContract(c: ParsedContract, loader: TaskLoader): Promise<Finding[]> {
  const out: Finding[] = [];
  const clauseIds = new Set(c.clauses.map((x) => x.id));
  const taskIds = new Set(c.tasks.map((x) => x.id));
  for (const cl of c.clauses) {
    if (!EVIDENCE_ID.test(cl.evidence) && !EVIDENCE_ROW.test(cl.evidence) && !cl.tags.includes("[attested]")) out.push({ code: "CONTRACT_CLAUSE_NO_EVIDENCE", id: cl.id, detail: `line ${cl.line}: no evidence id or row, and not [attested]` });
    for (const t of cl.tasks) if (!taskIds.has(t)) out.push({ code: "CONTRACT_TASK_UNKNOWN", id: cl.id, detail: `line ${cl.line}: tasks names ${t}, which has no block` });
  }
  for (const t of c.tasks) {
    if (!t.file) {
      out.push({ code: "CONTRACT_TASK_NO_FILE", id: t.id, detail: `line ${t.line}: no file: line` });
      continue;
    }
    if (!loader.exists(t.file)) {
      out.push({ code: "CONTRACT_TASK_FILE_MISSING", id: t.id, detail: `${t.file} does not exist` });
      continue;
    }
    const def = await loader.load(t.file);
    if (!def) {
      out.push({ code: "CONTRACT_TASK_UNLOADABLE", id: t.id, detail: `${t.file} exports no defineTask default` });
      continue;
    }
    if (def.id !== t.id) out.push({ code: "CONTRACT_TASK_ID_MISMATCH", id: t.id, detail: `${t.file} defines ${def.id}` });
    const expected = sorted(c.clauses.filter((cl) => cl.tasks.includes(t.id)).map((cl) => cl.id));
    const actual = sorted(def.clauses);
    if (JSON.stringify(expected) !== JSON.stringify(actual)) out.push({ code: "CONTRACT_TASK_CLAUSES_MISMATCH", id: t.id, detail: `the clauses naming it are [${expected.join(", ")}], the file says [${actual.join(", ")}]` });
    for (const cl of def.clauses) if (!clauseIds.has(cl)) out.push({ code: "CONTRACT_CLAUSE_UNKNOWN", id: t.id, detail: `${t.file} names ${cl}, which has no block` });
  }
  if (c.scorecardRows.length === 0) out.push({ code: "CONTRACT_SCORECARD_EMPTY", id: "Scorecard", detail: "no row under the header" });
  return out;
}
