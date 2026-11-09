// F61: T-P8-13, the P8 contract's one tier-2 task, has its `version_hash` filled with its file's hash as the tier-2 runner
// computes it (Q14), so the declared run's results file (`docs/plan-v2/evidence/results/<hash>.json`) is the task the
// contract names. F60's check (`test/m0/f60-contract.test.ts`) holds the other fourteen.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { staleHashes } from "../support/task-hashes.ts";
import { repoRoot } from "../support/temp-repo.ts";

const CONTRACT = "docs/plan-v2/contracts/P8-group-chats.md";
const mine = (contract: string) => staleHashes(contract).filter((l) => l.startsWith("T-P8-13 "));

describe("[F61] T-P8-13's hash in the P8 contract", () => {
  it("is filled and is its file's hash under Node's loader; a stale or unfilled one is named", () => {
    const contract = readFileSync(join(repoRoot, CONTRACT), "utf8");
    expect(mine(contract)).toEqual([]);
    const hash = /^T-P8-13 [\s\S]*?version_hash: (\S+)/m.exec(contract)?.[1] as string;
    expect(hash).toMatch(/^[0-9a-f]{12}$/);
    // Planted: the line put back to F60's placeholder is caught by id.
    expect(mine(contract.replace(`version_hash: ${hash}`, "version_hash: filled-by-F61"))).toEqual([`T-P8-13 filled-by-F61 ${hash}`]);
  });
});
