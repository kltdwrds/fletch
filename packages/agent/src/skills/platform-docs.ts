// The platform docs (M24.1): short manuals in `packages/agent/docs/platform/`, written by rollout to every
// tenant's R2 under `docs/platform/` and read through `skill_read` as the `docs` scope, names `docs/<slug>`.
// The agent never writes there: any path that reaches the prefix is refused `DOCS_READ_ONLY`.

export const DOCS_PREFIX = "docs/platform/";
export const DOCS_READ_ONLY = "DOCS_READ_ONLY";
/** The platform skills are release-owned the same way (M25.3): rollout rewrites them with the release tag. */
export const SKILLS_PLATFORM_PREFIX = "skills/platform/";
export const SKILLS_READ_ONLY = "PLATFORM_SKILLS_READ_ONLY";

/** The index the operating block shows, one line per manual; a test holds it equal to the folder's frontmatter. */
export const PLATFORM_DOCS: ReadonlyArray<{ slug: string; summary: string }> = [
  { slug: "capabilities", summary: "What your agent can and cannot do on this platform, by tool family." },
  { slug: "approvals", summary: "How approvals work: what runs unasked, what asks once, what needs a standing grant, and what never runs automatically." },
  { slug: "memory", summary: "How memory works: standing files, daily notes, people and groups pages, the synthesis, and what is injected every turn." },
  { slug: "scheduling", summary: "How to schedule work: one-shot, recurring with a gate, or nothing." },
  { slug: "files", summary: "The person's files: list, read, write and delete, and what a path may be." },
  { slug: "mail", summary: "Mail: what arrives, what you can do with it, and why you cannot send." },
  { slug: "workspace", summary: "The shared company workspace: what you may create there and what stays with people." },
];

/** Whether a path or key, however spelled, lands in the docs prefix (case, `./`, `..` and a leading slash do not hide it). */
export const reachesDocs = (path: string): boolean => reaches(DOCS_PREFIX, path);
export const reachesPlatformSkills = (path: string): boolean => reaches(SKILLS_PLATFORM_PREFIX, path);

function reaches(prefix: string, path: string): boolean {
  const parts: string[] = [];
  for (const seg of path.replace(/\\/g, "/").split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg.toLowerCase());
  }
  const norm = parts.join("/");
  return `${norm}/`.startsWith(prefix) || norm === prefix.slice(0, -1);
}

/** `summary` and `read_when` from a manual's frontmatter, and its body. */
export function parseDoc(text: string): { summary: string; readWhen: string; body: string } | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return null;
  const field = (key: string) => new RegExp(`^${key}:[ \\t]*(.*)$`, "m").exec(m[1] ?? "")?.[1]?.trim() ?? "";
  const summary = field("summary");
  const readWhen = field("read_when");
  return summary && readWhen ? { summary, readWhen, body: m[2] ?? "" } : null;
}

/** The index line of the operating block. */
export const docsIndex = (): string =>
  `Platform docs (${PLATFORM_DOCS.map((d) => `docs/${d.slug}`).join(", ")}). When asked what you can do, or whether you can do something, always call skill_read with name docs/capabilities first, even if a tool in the reference seems to answer it. Then answer from it: say what runs freely, what needs the person's approval or a connector, and write "(docs/capabilities)" in the answer.`;
