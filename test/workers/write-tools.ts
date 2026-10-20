// The declared lists M7.3's enumeration (`m7-request-writes.test.ts`, beside this file) holds every
// registered tool to. A new tool joins one of them: a write of the person's records joins
// `WRITE_TOOLS` and carries `mutates`; anything else joins `NOT_WRITES` with the reason it writes nothing.
import type { Namespace } from "../../packages/agent/src/tools/registry.ts";

/** Tools that change the person's records. A new write tool joins this list, and must carry `mutates`. */
export const WRITE_TOOLS = ["memory_write", "file_write", "file_edit", "file_delete", "browse_live", "browse_handoff", "jobs_create", "jobs_disable"] as const;

/**
 * Every other registered tool, with why it is not a write of the person's records. A new tool that
 * writes nothing joins this list; one that is in neither list fails the enumeration.
 */
export const NOT_WRITES: Record<string, string> = {
  send_to_user: "an action that queues its own delivery to the person",
  tool_search: "loads namespaces into this chat's session; the person's records are untouched",
  memory_search: "reads memory",
  memory_get: "reads memory",
  memory_explain: "reads memory",
  skill_search: "reads the skill catalog",
  skill_read: "reads the skill catalog",
  file_list: "reads files",
  file_read: "reads files",
  file_grep: "searches the working tree",
  file_find: "lists working-tree paths matching a glob",
  code_execute: "runs in an isolate whose only network is egress to the owner's listed hosts, on the owner's own turns (M25.5); it writes none of the person's records",
  github_repo: "reads GitHub through egress",
  github_issues: "reads GitHub through egress",
  hn_top: "reads Hacker News through egress",
  hn_item: "reads Hacker News through egress",
  browse_open: "reads a public page in a stateless Quick Action; no cookies, nothing of the person's is changed",
  browse_fill: "an action on the live page, decided by the grants engine; the value never leaves the Vault",
  colleagues_directory: "reads the company directory",
  colleagues_check_grant: "reads colleagues' grants naming the asker",
  colleagues_request: "an action, decided by the grants engine",
  subagents_delegate: "in a chat, an action that queues its own delegation (own task only); in a sub-agent, asks its parent",
  subagents_close: "an action that ends this chat's own sub-agents (own task only); it writes only their rows, nothing of the person's records",
  subagents_status: "reads this chat's sub-agent rows",
  probe_mark: "a staging action, decided by the grants engine",
  jobs_list: "reads the person's own jobs",
  jobs_enable: "an action, decided by the grants engine: the person's approval card turns a job on",
  jobs_remove: "an action, decided by the grants engine: the person's approval card removes a job",
  workspace_list: "reads the person's workspaces through the adapter",
  workspace_context: "reads the company's context library through the adapter",
  workspace_approvals: "reads pending approvals through the adapter; the agent cannot decide them",
  workspace_hooks: "reads a workspace's hooks through the adapter",
  workspace_create: "an action in the company workspace, decided by the grants engine; not the person's records",
  workspace_app: "an action in the company workspace, decided by the grants engine; not the person's records",
  workspace_build: "an action in the company workspace, decided by the grants engine; not the person's records",
  workspace_hook: "an action in the company workspace, decided by the grants engine; not the person's records",
  workspace_bind: "an action in the company workspace, decided by the grants engine; not the person's records",
  workspace_connect_link: "shows the person a link card to the connect page; writes nothing and calls no adapter",
  workspace_decision: "refuses a workshop decision with AGENT_SESSION_REFUSED and shows a link card; writes nothing and calls no adapter",
};

/** What the enumeration finds wrong in a set of namespaces against the declared lists. */
export function writeFlagFindings(namespaces: readonly Namespace[], writes: readonly string[] = WRITE_TOOLS, others: Record<string, string> = NOT_WRITES): string[] {
  const out: string[] = [];
  for (const ns of namespaces) {
    for (const t of ns.tools) {
      const isWrite = writes.includes(t.name);
      if (!isWrite && !(t.name in others)) out.push(`TOOL_UNCLASSIFIED: ${ns.name}.${t.name} is in neither the write list nor the others`);
      if (isWrite && !t.mutates) out.push(`WRITE_UNFLAGGED: ${ns.name}.${t.name} writes the person's records without mutates`);
      if (!isWrite && t.mutates) out.push(`MUTATES_UNDECLARED: ${ns.name}.${t.name} carries mutates but is not in the write list`);
    }
  }
  return out;
}
