import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { devConfig, devVars } from "../../scripts/dev.ts";

const base = readFileSync(new URL("../../packages/agent/wrangler.jsonc", import.meta.url), "utf8");
const mint = { master: () => "minted-master", setup: () => "minted-setup" };

describe("[F1] pnpm dev", () => {
  it("drops the AI binding unless --remote-ai, and names its own Worker and owner", () => {
    const local = devConfig(base, { ownerEmail: "sam@solo-sam.example", remoteAi: false });
    expect(local.ai).toBeUndefined();
    expect(local.name).toBe("fletch-dev");
    expect((local.vars as Record<string, string>).OWNER_EMAIL).toBe("sam@solo-sam.example");
    expect((local.vars as Record<string, string>).TENANT_ID).toBe("base");
    expect(devConfig(base, { ownerEmail: "sam@solo-sam.example", remoteAi: true }).ai).toEqual({ binding: "AI" });
  });

  it("mints a missing MASTER_KEY and SETUP_TOKEN and keeps ones already there", () => {
    expect(devVars("", mint)).toEqual({ text: "MASTER_KEY=minted-master\nSETUP_TOKEN=minted-setup\n", setupToken: "minted-setup" });
    const kept = devVars("SETUP_TOKEN=abc=\nMASTER_KEY=key\nOTHER=1\n", mint);
    expect(kept.setupToken).toBe("abc=");
    expect(kept.text).toBe("SETUP_TOKEN=abc=\nMASTER_KEY=key\nOTHER=1\n");
  });
});
