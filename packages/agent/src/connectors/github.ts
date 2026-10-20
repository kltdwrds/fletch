// GitHub, read-only (D8): the first connector with a credential. Every request carries the reference
// `cred://github`; the Vault's egress module swaps in the token for api.github.com alone.
import { Type } from "@earendil-works/pi-ai";
import type { Namespace, ToolSpec } from "../tools/registry.ts";
import { type Egress, getJson } from "./egress.ts";

export const GITHUB_API = "https://api.github.com";
export const GITHUB_CRED = "cred://github";
const REPO = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;

const Repo = Type.String({ pattern: REPO.source, description: "owner/name, e.g. octo-org/octo-repo" });
const RepoParams = Type.Object({ repo: Repo });
const IssuesParams = Type.Object({ repo: Repo, limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 30, description: "How many open issues, newest first (default 10)." })) });

const auth: Array<[string, string]> = [
  ["authorization", `Bearer ${GITHUB_CRED}`],
  ["x-github-api-version", "2022-11-28"],
  ["user-agent", "qyvr-agent"],
];

function repoPath(repo: string): string {
  if (!REPO.test(repo) || repo.includes("..")) throw new Error("GITHUB_REPO_INVALID: a repository is owner/name");
  return repo;
}

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }], details: {} });

export function githubNamespace(egress: Egress): Namespace {
  const repo: ToolSpec<typeof RepoParams> = {
    name: "github_repo",
    kind: "observation",
    label: "GitHub repository",
    description: "Read a GitHub repository's summary: description, stars, open issues, default branch, last push.",
    parameters: RepoParams,
    execute: async (_id, p) => {
      const r = (await getJson(egress, "github_repo", `${GITHUB_API}/repos/${repoPath(p.repo)}`, auth)) as Record<string, unknown>;
      return text(
        [
          `${r.full_name}: ${r.description ?? "(no description)"}`,
          `stars ${r.stargazers_count}, open issues ${r.open_issues_count}, default branch ${r.default_branch}, last push ${r.pushed_at}`,
          String(r.html_url ?? ""),
        ].join("\n"),
      );
    },
  };
  const issues: ToolSpec<typeof IssuesParams> = {
    name: "github_issues",
    kind: "observation",
    label: "GitHub open issues",
    description: "List a GitHub repository's open issues and pull requests, newest first.",
    parameters: IssuesParams,
    execute: async (_id, p) => {
      const n = p.limit ?? 10;
      const list = (await getJson(egress, "github_issues", `${GITHUB_API}/repos/${repoPath(p.repo)}/issues?state=open&per_page=${n}`, auth)) as Array<Record<string, unknown>>;
      if (!Array.isArray(list)) throw new Error("CONNECTOR_BAD_JSON: expected a list of issues");
      if (!list.length) return text(`${p.repo} has no open issues.`);
      return text(list.map((i) => `#${i.number} ${i.title} (by ${(i.user as { login?: string } | null)?.login ?? "?"}, ${i.comments} comments)`).join("\n"));
    },
  };
  return { name: "github", description: "read GitHub repositories and their open issues", deferral: "names", tools: [repo, issues] as ToolSpec[] };
}
