// The model-facing tool reference, generated from the schemas themselves (muse-reference section
// 3's hygiene lesson: the prompt and the schemas had drifted, so the reference is never written by
// hand). Loaded tools show their kind, description and parameters; a "names" namespace shows its
// tool names and one line each; a "hidden" namespace shows only that `tool_search` can find more.
import type { TSchema } from "@earendil-works/pi-ai";
import type { Namespace, ToolKind, ToolSpec } from "./registry.ts";

export const TOOLS_HEADING = "# Tools";

const KIND_TEXT: Record<ToolKind, string> = {
  observation: "observation: runs now and returns its result",
  action: "action: queued, performed after this step is committed",
};

type Schema = { type?: string; description?: string; properties?: Record<string, Schema>; required?: string[]; enum?: unknown[]; const?: unknown; anyOf?: Schema[]; items?: Schema; minimum?: number; maximum?: number; minItems?: number; maxItems?: number; minLength?: number };

function typeOf(s: Schema): string {
  if (s.const !== undefined) return JSON.stringify(s.const);
  if (s.enum) return s.enum.map((v) => JSON.stringify(v)).join(" | ");
  if (s.anyOf) return s.anyOf.map(typeOf).join(" | ");
  if (s.type === "array") return `${s.items ? typeOf(s.items) : "unknown"}[]`;
  if (s.type === "object") return s.properties ? `{ ${Object.keys(s.properties).join(", ")} }` : "object";
  return s.type ?? "unknown";
}

function bounds(s: Schema): string {
  const parts: string[] = [];
  if (s.minimum !== undefined || s.maximum !== undefined) parts.push(`${s.minimum ?? ""}..${s.maximum ?? ""}`);
  if (s.minItems !== undefined || s.maxItems !== undefined) parts.push(`${s.minItems ?? ""}..${s.maxItems ?? ""} items`);
  if (s.minLength !== undefined) parts.push(`min length ${s.minLength}`);
  return parts.length ? ` (${parts.join(", ")})` : "";
}

/** One line per parameter, read from the JSON schema the model also receives. */
export function parameterLines(schema: TSchema, indent = "  "): string[] {
  const s = schema as unknown as Schema;
  const variants = s.anyOf ?? [s];
  const lines: string[] = [];
  variants.forEach((v, i) => {
    if (variants.length > 1) lines.push(`${indent}variant ${i + 1}:`);
    const pad = variants.length > 1 ? `${indent}  ` : indent;
    const required = new Set(v.required ?? []);
    for (const [name, p] of Object.entries(v.properties ?? {})) {
      const desc = p.description ? `: ${p.description}` : "";
      lines.push(`${pad}${name}${required.has(name) ? "" : "?"}: ${typeOf(p)}${bounds(p)}${desc}`);
    }
  });
  return lines;
}

export function toolLines(spec: ToolSpec): string[] {
  return [`- ${spec.name} (${KIND_TEXT[spec.kind]}): ${spec.description}`, ...parameterLines(spec.parameters)];
}

/** The `# Tools` block: a rendering of what the model can call and how to reach the rest. */
export function toolReference(namespaces: readonly Namespace[], loaded: ReadonlySet<string>): string {
  const blocks: string[] = [TOOLS_HEADING, "Each tool is an observation or an action; an action takes effect only after the step it was called in is committed."];
  const hidden: Namespace[] = [];
  for (const ns of namespaces) {
    const active = ns.deferral === "eager" || loaded.has(ns.name);
    if (active) {
      blocks.push(`## ${ns.name}: ${ns.description}`, ...ns.tools.flatMap(toolLines));
    } else if (ns.deferral === "names") {
      blocks.push(`## ${ns.name}: ${ns.description} (not loaded; tool_search with load: ["${ns.name}"] loads its schemas)`, ...ns.tools.map((t) => `- ${t.name} (${t.kind}): ${t.description}`));
    } else {
      hidden.push(ns);
    }
  }
  if (hidden.length) blocks.push(`## more: ${hidden.length} further namespace${hidden.length === 1 ? "" : "s"} with ${hidden.reduce((n, ns) => n + ns.tools.length, 0)} tools; tool_search finds and loads them`);
  return blocks.join("\n");
}
