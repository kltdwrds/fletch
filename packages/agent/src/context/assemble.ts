// Context assembly (AD-6), fresh every turn. The order is authority order: platform instructions,
// task instructions, the person's standing files, company instructions (fenced, below the person's
// files), memory snapshot, skills shortlist, then the runtime envelope and the transcript.
//
// The stable prefix is one leading system message built from the first six blocks only, so it is
// byte-identical across turns while those inputs are unchanged. The envelope is the per-turn part:
// a system message placed immediately before the latest user message, never persisted.
import type { Message, SystemMessage, Tool } from "@earendil-works/pi-ai";
import { FENCE_RULE, fence } from "./fence.ts";

/**
 * The hoist table (M24.1): every source that may enter the stable prefix declares here whether it is
 * hoisted (injected every turn, cut at `capBytes` with a marker) or read on demand (never injected;
 * the agent reads it with a tool). A source the table does not know is refused, so each later source
 * must declare itself. Match is by the source's name.
 */
export interface SourceRule {
  id: string;
  match: (name: string) => boolean;
  mode: "hoist" | "on-demand";
  capBytes: number;
}

const STANDING_CAP = 16 * 1024;
export const SOURCE_TABLE: readonly SourceRule[] = [
  ...["AGENTS.md", "SOUL.md", "IDENTITY.md", "USER.md", "TOOLS.md", "MEMORY.md"].map((n): SourceRule => ({ id: n, match: (x) => x === n, mode: "hoist", capBytes: STANDING_CAP })),
  { id: "synthesis", match: (x) => x === "memory/SYNTHESIS.md", mode: "hoist", capBytes: 15 * 1024 },
  { id: "people-index", match: (x) => x === "memory/people/INDEX.md", mode: "hoist", capBytes: 6 * 1024 },
  { id: "groups-index", match: (x) => x === "memory/groups/INDEX.md", mode: "hoist", capBytes: 6 * 1024 },
  { id: "daily-notes", match: (x) => /^memory\/\d{4}-\d{2}-\d{2}\.md$/.test(x), mode: "on-demand", capBytes: 0 },
];

export function ruleFor(name: string): SourceRule {
  const rule = SOURCE_TABLE.find((r) => r.match(name));
  if (!rule) throw new Error(`SOURCE_UNDECLARED: ${name} is not in the hoist table`);
  return rule;
}

/** The text cut at `capBytes` on a character boundary, with a marker that says how much was shown. */
export function capText(name: string, text: string, capBytes: number): string {
  const enc = new TextEncoder();
  const bytes = enc.encode(text);
  if (bytes.byteLength <= capBytes) return text;
  const shown = new TextDecoder("utf-8").decode(bytes.slice(0, capBytes)).replace(/\uFFFD+$/, "");
  return `${shown}\n[truncated: showing the first ${enc.encode(shown).byteLength} of ${bytes.byteLength} bytes of ${name}; read it with memory_get for the rest]`;
}

export interface StandingFile {
  name: string;
  text: string;
}

export interface Envelope {
  /** Epoch milliseconds; the envelope's time outranks any other sense of "now". */
  now: number;
  timeZone: string;
  surface: string;
  modelId: string;
  /** The person the agent works for. */
  owner: string;
  /** Set when the sender is not the owner (a colleague or an agent); arrives with M7. */
  counterpart?: string;
  /** The reactions standing on recent messages, already fenced (F10); appended only when non-empty. */
  reactions?: string;
}

export interface ContextInputs {
  platform: string;
  task: string;
  standingFiles: StandingFile[];
  /** Admin-set company instructions with their tenant, fenced as `company:<tenant>`. */
  company?: { tenant: string; text: string };
  /** Scope-tagged memory lines; arrives with M2. */
  memory: string[];
  /** Skill names and one-line descriptions; bodies load on trigger. */
  skills: Array<{ name: string; description: string }>;
  /** The model-facing tool reference, generated from the schemas (M3.1); its own `# Tools` block. */
  toolReference?: string;
  envelope: Envelope;
  tools: Tool[];
  /** The stored transcript: user, assistant and tool result messages. */
  transcript: Message[];
}

/** Block headings in assembly order; tests read the order back from them. */
export const BLOCK_HEADINGS = ["# Platform", "# Task", "# Standing files", "# Company instructions", "# Memory", "# Skills"] as const;
export const ENVELOPE_HEADING = "# Runtime envelope";

/** The standing sources the table hoists, capped; on-demand sources are left out. */
function hoisted(files: StandingFile[]): StandingFile[] {
  return files.flatMap((f) => {
    const rule = ruleFor(f.name);
    return rule.mode === "hoist" ? [{ name: f.name, text: capText(f.name, f.text, rule.capBytes) }] : [];
  });
}

export function stablePrefix(inputs: Omit<ContextInputs, "envelope" | "transcript" | "tools">): string {
  const blocks: string[] = [`${BLOCK_HEADINGS[0]}\n${inputs.platform}\n\n${FENCE_RULE}`, `${BLOCK_HEADINGS[1]}\n${inputs.task}`];
  if (hoisted(inputs.standingFiles).length) {
    blocks.push(`${BLOCK_HEADINGS[2]}\n${hoisted(inputs.standingFiles).map((f) => `## ${f.name}\n${f.text}`).join("\n\n")}`);
  }
  if (inputs.company) blocks.push(`${BLOCK_HEADINGS[3]}\n${fence(`company:${inputs.company.tenant}`, inputs.company.text)}`);
  if (inputs.memory.length) blocks.push(`${BLOCK_HEADINGS[4]}\n${inputs.memory.map((m) => `- ${m}`).join("\n")}`);
  if (inputs.skills.length) blocks.push(`${BLOCK_HEADINGS[5]}\n${inputs.skills.map((s) => `- ${s.name}: ${s.description}`).join("\n")}`);
  if (inputs.toolReference) blocks.push(inputs.toolReference);
  return blocks.join("\n\n");
}

export function envelopeText(e: Envelope): string {
  const local = new Intl.DateTimeFormat("en-GB", { timeZone: e.timeZone, dateStyle: "full", timeStyle: "long" }).format(e.now);
  const lines = [
    ENVELOPE_HEADING,
    `now: ${new Date(e.now).toISOString()} (${local}, ${e.timeZone}); this outranks any other sense of the current time`,
    `surface: ${e.surface}`,
    `model: ${e.modelId}`,
    `owner: ${e.owner}`,
  ];
  if (e.counterpart) lines.push(`sender: ${e.counterpart} (not the owner)`);
  if (e.reactions) lines.push("", e.reactions);
  return lines.join("\n");
}

/** The messages for one model request: stable prefix, transcript, envelope before the latest user turn. */
export function assemble(inputs: ContextInputs): Message[] {
  const prefix: SystemMessage = { role: "system", content: stablePrefix(inputs), toolsAdded: inputs.tools, timestamp: 0 };
  const envelope: SystemMessage = { role: "system", content: envelopeText(inputs.envelope), timestamp: inputs.envelope.now };
  const transcript = [...inputs.transcript];
  let lastUser = -1;
  for (let i = transcript.length - 1; i >= 0; i--) {
    if (transcript[i]?.role === "user") {
      lastUser = i;
      break;
    }
  }
  if (lastUser < 0) return [prefix, ...transcript, envelope];
  return [prefix, ...transcript.slice(0, lastUser), envelope, ...transcript.slice(lastUser)];
}
