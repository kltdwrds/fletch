import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { privacyScan, secretScan } from "../../scripts/scans.ts";
import { repoRoot, type TempRepo, tempRepo } from "../support/temp-repo.ts";

const planted = readFileSync(join(repoRoot, "test/fixtures/fake-secrets/planted.txt"), "utf8");
const fakeLine = (label: string) => planted.split("\n").find((l) => l.startsWith(`${label}: `))?.slice(label.length + 2) ?? "";

let repo: TempRepo;
afterEach(() => repo?.cleanup());

describe("[M0.1] secret scan", () => {
  it("fails on a planted fake key in a tracked file", () => {
    repo = tempRepo();
    repo.track("src/config.ts", `export const token = "${fakeLine("github")}";\n`);
    const result = secretScan(repo.dir);
    expect(result.findings).toEqual([{ file: "src/config.ts", line: 1, rule: "github-token" }]);
  });

  it("recognises each planted credential shape", () => {
    repo = tempRepo();
    repo.track("a.txt", ["github", "aws", "anthropic", "pem"].map(fakeLine).join("\n"));
    expect(secretScan(repo.dir).findings.map((f) => f.rule)).toEqual(["github-token", "aws-access-key", "anthropic-key", "pem-private-key"]);
  });

  it("allows fake secrets only under test/fixtures/fake-secrets/", () => {
    repo = tempRepo();
    repo.track("test/fixtures/fake-secrets/keys.txt", fakeLine("github"));
    expect(secretScan(repo.dir).findings).toEqual([]);
  });

  it("scans untracked files that are not ignored, and skips ignored ones", () => {
    repo = tempRepo();
    repo.track(".gitignore", "ignored/\n");
    repo.write("loose.ts", fakeLine("aws"));
    repo.write("ignored/local.ts", fakeLine("aws"));
    expect(secretScan(repo.dir).findings.map((f) => f.file)).toEqual(["loose.ts"]);
  });

  it("fails on the value of a credential-named .dev.vars entry, not on identifiers", () => {
    repo = tempRepo();
    const value = fakeLine("dev-vars-value");
    repo.track(".gitignore", ".dev.vars\n");
    repo.write(".dev.vars", `SERVICE_TOKEN="${value}"\nACCOUNT_ID=abcdef0123456789\n`);
    repo.track("notes.md", `token ${value}\naccount abcdef0123456789\n`);
    expect(secretScan(repo.dir).findings).toEqual([{ file: "notes.md", line: 1, rule: "dev-vars-value" }]);
  });
});

describe("[M0.1] privacy scan", () => {
  it("fails on a fictional name outside people.json", () => {
    repo = tempRepo();
    // Built at runtime so this test file does not itself carry an unknown identity.
    const stranger = ["Eve", "Marsh"].join(" ");
    repo.track("test/fixtures/extra.json", JSON.stringify({ name: stranger }, null, 2));
    expect(privacyScan(repo.dir).findings).toEqual([{ file: "test/fixtures/extra.json", line: 2, rule: "identity-not-in-people-json:name" }]);
  });

  it("passes the people and companies people.json lists", () => {
    repo = tempRepo();
    const people = JSON.parse(readFileSync(join(repoRoot, "test/fixtures/people.json"), "utf8")) as { people: { name: string; email: string }[] };
    repo.track("test/fixtures/members.json", JSON.stringify(people.people.map((p) => ({ name: p.name, email: p.email })), null, 2));
    repo.track("platform/tenants/solo-sam.jsonc", "{}\n");
    expect(privacyScan(repo.dir).findings).toEqual([]);
  });

  it("fails on an address or a tenant company outside people.json", () => {
    repo = tempRepo();
    repo.track("test/m9/mail.test.ts", `const to = "${["eve", "marsh.example"].join("@")}";\n`);
    repo.track(`platform/tenants/${["north", "wind"].join("")}.jsonc`, "{}\n");
    expect(privacyScan(repo.dir).findings.map((f) => f.rule).toSorted()).toEqual([
      "identity-not-in-people-json:company",
      "identity-not-in-people-json:email",
    ]);
  });

  it("fails on the dump marker outside docs/plan-v2 and allows it inside", () => {
    repo = tempRepo();
    const marker = ["harness", "dump"].join("-");
    repo.track("docs/plan-v2/KICKOFF.md", `never read ${marker}\n`);
    repo.track("scripts/x.ts", `// ${marker}\n`);
    expect(privacyScan(repo.dir).findings).toEqual([{ file: "scripts/x.ts", line: 1, rule: "dump-reference" }]);
  });

  it("fails on a denylisted line under docs/ or packages/", () => {
    repo = tempRepo();
    const secretLine = "a private sentence from a private directory";
    repo.track("scripts/privacy-denylist.txt", `# hashes\n${createHash("sha256").update(secretLine).digest("hex")}\n`);
    repo.track("packages/agent/src/x.ts", `  ${secretLine}  \n`);
    repo.track("test/elsewhere.txt", `${secretLine}\n`);
    expect(privacyScan(repo.dir).findings).toEqual([{ file: "packages/agent/src/x.ts", line: 1, rule: "denylisted-line" }]);
  });
});
