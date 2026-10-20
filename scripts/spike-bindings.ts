// The Task 10 spike, run by hand on a throwaway free-plan account (never in CI, never by an agent):
//
//   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... node scripts/spike-bindings.ts
//
// It deploys a minimal Worker named `fletch-spike-<random>` that declares `worker_loaders` (LOADER) and
// `images` (IMAGES), GETs it, prints a table (deploy accepted y/n with the error text; call ok y/n), and
// deletes every Worker it created in a `finally`. If the combined deploy is refused, each binding is
// deployed alone so the table says which one the plan refuses. Credentials are read from the environment
// only and are never printed or written to the generated files. Record the table in docs/DECISIONS.md.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type Binding = "LOADER" | "IMAGES";

/** A 1x1 PNG, the input the Images binding is asked to transform. */
export const TINY_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** The wrangler config for a spike Worker declaring the given bindings; no secret and no account id in it. */
export function spikeConfig(name: string, bindings: readonly Binding[]): Record<string, unknown> {
  return {
    name,
    main: "worker.js",
    compatibility_date: "2026-10-01",
    workers_dev: true,
    ...(bindings.includes("LOADER") ? { worker_loaders: [{ binding: "LOADER" }] } : {}),
    ...(bindings.includes("IMAGES") ? { images: { binding: "IMAGES" } } : {}),
  };
}

/** The Worker's source: each probe answers `{ ok, detail }`, so a refused call is data, not a crash. */
export function spikeWorkerSource(): string {
  return `const PNG = "${TINY_PNG}";
const probe = async (run) => { try { return { ok: true, detail: String(await run()) }; } catch (e) { return { ok: false, detail: String((e && e.message) || e) }; } };
export default {
  async fetch(_request, env) {
    const loader = await probe(async () => {
      if (!env.LOADER) throw new Error("LOADER binding absent");
      const stub = env.LOADER.get("spike", async () => ({ compatibilityDate: "2026-10-01", mainModule: "m.js", modules: { "m.js": "export default { fetch() { return new Response('loaded-ok'); } };" } }));
      return await (await stub.getEntrypoint().fetch(new Request("http://spike.invalid/"))).text();
    });
    const images = await probe(async () => {
      if (!env.IMAGES) throw new Error("IMAGES binding absent");
      const bytes = Uint8Array.from(atob(PNG), (c) => c.charCodeAt(0));
      const out = await env.IMAGES.input(new Blob([bytes]).stream()).transform({ width: 1 }).output({ format: "image/png" });
      return "bytes=" + (await new Response(out.image()).arrayBuffer()).byteLength;
    });
    return Response.json({ loader, images });
  },
};
`;
}

export interface Probe {
  ok: boolean;
  detail: string;
}

/** The Worker's answer, or both probes failed with the reason the answer was not one. */
export function parseProbe(status: number, body: string): { loader: Probe; images: Probe } {
  const failed = (detail: string) => ({ loader: { ok: false, detail }, images: { ok: false, detail } });
  if (status !== 200) return failed(`GET answered ${status}: ${body.slice(0, 200)}`);
  try {
    const j = JSON.parse(body) as { loader?: Probe; images?: Probe };
    const one = (p: Probe | undefined): Probe => (p && typeof p.ok === "boolean" ? { ok: p.ok, detail: String(p.detail ?? "") } : { ok: false, detail: "no answer for this probe" });
    return { loader: one(j.loader), images: one(j.images) };
  } catch {
    return failed(`GET answered non-JSON: ${body.slice(0, 200)}`);
  }
}

/** The deployed URL wrangler prints, if it printed one. */
export function deployedUrl(output: string): string | null {
  return output.match(/https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.workers\.dev/i)?.[0] ?? null;
}

/** A deploy's verdict from wrangler's exit code and output; the error text is the ERROR lines, trimmed. */
export function deployOutcome(exitCode: number | null, output: string): { accepted: boolean; error: string } {
  if (exitCode === 0) return { accepted: true, error: "" };
  const errors = output.split("\n").filter((l) => /ERROR|error:/i.test(l)).map((l) => l.trim());
  return { accepted: false, error: (errors.length ? errors.join(" | ") : output.trim()).slice(0, 400) || `wrangler exited ${exitCode}` };
}

export interface Row {
  binding: Binding;
  deployed: boolean;
  deployError: string;
  called: boolean | null;
  callDetail: string;
}

/** The result table: one row per binding, deploy accepted and call ok as y/n. */
export function renderTable(rows: readonly Row[]): string {
  const yn = (b: boolean | null) => (b === null ? "-" : b ? "y" : "n");
  const head = ["binding", "deploy accepted", "call ok", "detail"];
  const body = rows.map((r) => [r.binding, yn(r.deployed), yn(r.called), (r.deployed ? r.callDetail : r.deployError).replace(/\s+/g, " ")]);
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((b) => (i < 3 ? (b[i] as string).length : 0))));
  const line = (cells: string[]) => cells.map((c, i) => (i < 3 ? c.padEnd(widths[i] as number) : c)).join("  ");
  return [line(head), line(widths.slice(0, 3).map((w) => "-".repeat(w)).concat("-".repeat(6))), ...body.map(line)].join("\n");
}

// --- the live part: only `main` runs it ---------------------------------------------------------------

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WRANGLER = join(ROOT, "node_modules", ".bin", "wrangler");

const wrangler = (args: string[], cwd: string) => {
  const r = spawnSync(WRANGLER, args, { cwd, env: process.env, encoding: "utf8", timeout: 180_000 });
  return { code: r.status, output: `${r.stdout ?? ""}\n${r.stderr ?? ""}` };
};

/** Deploys one spike Worker with the given bindings and probes it; the Worker's name is pushed to `created` first so the caller deletes it. */
async function trial(bindings: readonly Binding[], created: string[], dir: string): Promise<{ deploy: ReturnType<typeof deployOutcome>; probe: { loader: Probe; images: Probe } | null }> {
  const name = `fletch-spike-${randomBytes(4).toString("hex")}`;
  created.push(name);
  const work = mkdtempSync(join(dir, `${name}-`));
  mkdirSync(work, { recursive: true });
  writeFileSync(join(work, "worker.js"), spikeWorkerSource());
  writeFileSync(join(work, "wrangler.jsonc"), JSON.stringify(spikeConfig(name, bindings), null, 2));
  const deployed = wrangler(["deploy", "--config", "wrangler.jsonc"], work);
  const deploy = deployOutcome(deployed.code, deployed.output);
  if (!deploy.accepted) return { deploy, probe: null };
  const url = deployedUrl(deployed.output);
  if (!url) return { deploy, probe: parseProbe(0, "wrangler printed no workers.dev URL") };
  // A fresh workers.dev route can take a few seconds to answer.
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(url).catch((e: unknown) => new Response(String(e), { status: 0 }));
    const probe = parseProbe(res.status, await res.text());
    if (res.status === 200 || attempt === 5) return { deploy, probe };
    await new Promise((r) => setTimeout(r, 4000));
  }
  return { deploy, probe: null };
}

async function main(): Promise<number> {
  for (const v of ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]) {
    if (!process.env[v]) {
      console.error(`${v} is not set. Run: CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... node scripts/spike-bindings.ts`);
      return 2;
    }
  }
  const dir = mkdtempSync(join(tmpdir(), "fletch-spike-"));
  const created: string[] = [];
  const rows: Row[] = [];
  try {
    const both = await trial(["LOADER", "IMAGES"], created, dir);
    if (both.deploy.accepted && both.probe) {
      rows.push({ binding: "LOADER", deployed: true, deployError: "", called: both.probe.loader.ok, callDetail: both.probe.loader.detail });
      rows.push({ binding: "IMAGES", deployed: true, deployError: "", called: both.probe.images.ok, callDetail: both.probe.images.detail });
    } else {
      // Refused together: deploy each alone so the table says which binding the plan refuses.
      for (const binding of ["LOADER", "IMAGES"] as const) {
        const one = await trial([binding], created, dir);
        const p = one.probe?.[binding === "LOADER" ? "loader" : "images"];
        rows.push({ binding, deployed: one.deploy.accepted, deployError: one.deploy.error, called: p ? p.ok : null, callDetail: p?.detail ?? "" });
      }
    }
    console.log(renderTable(rows));
    return 0;
  } finally {
    for (const name of created) {
      const del = wrangler(["delete", "--name", name, "--force"], dir);
      console.error(del.code === 0 ? `deleted ${name}` : `DELETE FAILED for ${name}; remove it in the dashboard: ${del.output.trim().slice(0, 200)}`);
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.main) process.exitCode = await main();
