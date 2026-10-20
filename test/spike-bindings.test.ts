// [F1] The spike script's pure parts. Nothing here touches the network or wrangler.
import { describe, expect, it } from "vitest";
import { deployedUrl, isSpikeWorkerName, deployOutcome, parseProbe, renderTable, spikeConfig, spikeWorkerSource } from "../scripts/spike-bindings.ts";

describe("[F1] scripts/spike-bindings pure parts", () => {
  it("spikeConfig declares worker_loaders and images as asked, with no account id or secret", () => {
    const both = spikeConfig("fletch-spike-ab12", ["LOADER", "IMAGES"]);
    expect(both).toMatchObject({ name: "fletch-spike-ab12", worker_loaders: [{ binding: "LOADER" }], images: { binding: "IMAGES" } });
    expect(spikeConfig("n", ["LOADER"])).not.toHaveProperty("images");
    expect(spikeConfig("n", ["IMAGES"])).not.toHaveProperty("worker_loaders");
    expect(JSON.stringify(both)).not.toMatch(/account_id|token/i);
    expect(spikeWorkerSource()).toContain("env.LOADER.get");
    expect(spikeWorkerSource()).toContain("env.IMAGES.input");
  });

  it("parseProbe reads the Worker's answer and turns anything else into a failed probe with the reason", () => {
    const ok = JSON.stringify({ loader: { ok: true, detail: "loaded-ok" }, images: { ok: false, detail: "IMAGES binding absent" } });
    expect(parseProbe(200, ok)).toEqual({ loader: { ok: true, detail: "loaded-ok" }, images: { ok: false, detail: "IMAGES binding absent" } });
    expect(parseProbe(500, "boom").loader).toEqual({ ok: false, detail: "GET answered 500: boom" });
    expect(parseProbe(200, "<html>").images.detail).toContain("non-JSON");
    expect(parseProbe(200, "{}").loader).toEqual({ ok: false, detail: "no answer for this probe" });
  });

  it("deployOutcome accepts exit 0 and otherwise keeps the ERROR lines; deployedUrl finds the workers.dev URL", () => {
    expect(deployOutcome(0, "Deployed")).toEqual({ accepted: true, error: "" });
    const refused = deployOutcome(1, "Uploading\n✘ [ERROR] A request to the Cloudflare API failed. Worker Loaders are not available on this plan [code: 10000]\nlogs");
    expect(refused.accepted).toBe(false);
    expect(refused.error).toContain("Worker Loaders are not available on this plan");
    expect(deployOutcome(1, "").error).toBe("wrangler exited 1");
    expect(deployedUrl("Deployed fletch-spike-ab12 https://fletch-spike-ab12.sam.workers.dev\nVersion")).toBe("https://fletch-spike-ab12.sam.workers.dev");
    expect(deployedUrl("nothing")).toBeNull();
  });

  it("renderTable prints y/n per binding, the deploy error when refused, and - when a call never happened", () => {
    const t = renderTable([
      { binding: "LOADER", deployed: true, deployError: "", called: true, callDetail: "loaded-ok" },
      { binding: "IMAGES", deployed: false, deployError: "not on this plan", called: null, callDetail: "" },
    ]);
    const lines = t.split("\n");
    expect(lines[0]).toMatch(/^binding\s+deploy accepted\s+call ok\s+detail$/);
    expect(lines[2]).toMatch(/^LOADER\s+y\s+y\s+loaded-ok$/);
    expect(lines[3]).toMatch(/^IMAGES\s+n\s+-\s+not on this plan$/);
  });

  it("isSpikeWorkerName accepts only the generated names, so a delete can never reach another Worker", () => {
    expect(isSpikeWorkerName("fletch-spike-0a1b2c3d")).toBe(true);
    for (const bad of ["fletch-spike-", "fletch-spike-0a1b2c3", "fletch-spike-0a1b2c3d4", "fletch-spike-0A1B2C3D", "agent", "xfletch-spike-0a1b2c3d", "fletch-spike-0a1b2c3d\n--x", "fletch-spike-0a1b2c3d-prod"]) expect(isSpikeWorkerName(bad)).toBe(false);
  });
});
