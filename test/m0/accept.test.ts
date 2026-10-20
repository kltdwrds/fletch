import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { comparePartIds, fileTags, hermeticEnv, ownTag, parsePartId, planHermetic, root, tagPattern } from "../../scripts/accept.ts";
import { hermeticNetwork } from "../support/hermetic-network.ts";

describe("[F0] accept: part ids and tags", () => {
  it("parses fletch's F ids numerically, so F1 sorts before F10 and F0.2 after F0.1; qyvr-co's M ids are not targets", () => {
    expect(parsePartId("F10")).toEqual([10, 0]);
    expect(parsePartId("F3.2")).toEqual([3, 2]);
    expect(parsePartId("F3.")).toBeNull();
    expect(parsePartId("M3.2")).toBeNull();
    const sorted = ["F10", "F1", "F0.2", "F3.2", "F0.1", "F3.1"].toSorted((a, b) => comparePartIds(parsePartId(a)!, parsePartId(b)!));
    expect(sorted).toEqual(["F0.1", "F0.2", "F1", "F3.1", "F3.2", "F10"]);
  });

  it("builds a name pattern where [F1] never matches [F10] or [F1.1]", () => {
    const re = new RegExp(tagPattern(["F1", "F0.1", "M3"]));
    expect(re.test("[F1] host seam > x")).toBe(true);
    expect(re.test("[F0.1] spine > x")).toBe(true);
    expect(re.test("[M3] tools > x")).toBe(true);
    expect(re.test("[F10] browser > x")).toBe(false);
    expect(re.test("[F1.1] x")).toBe(false);
    expect(re.test("[F0x1] x")).toBe(false);
  });

  it("reads tags from titles and counts untagged top-level tests", () => {
    const tagged = 'describe("[M0.1] a", () => {\n  it("nested needs no tag", () => {});\n});\n';
    expect(fileTags(tagged)).toEqual({ tags: ["M0.1"], untagged: 0 });
    expect(fileTags(`${tagged}it("loose", () => {});\n`).untagged).toBe(1);
  });

  it("names a part's own tags: F1 owns [F1] and [F1.x], F1.2 owns [F1.2], an [M..] tag is never a part's own", () => {
    expect(["F1", "F1.2", "F1.3", "F0", "F10", "M1"].filter((t) => ownTag(t, parsePartId("F1")!))).toEqual(["F1", "F1.2", "F1.3"]);
    expect(["F1", "F1.2", "F1.3"].filter((t) => ownTag(t, parsePartId("F1.2")!))).toEqual(["F1.2"]);
  });

  it("reads F tags and the inherited M tags alike", () => {
    expect(fileTags('describe("[F1] host", () => {});\ndescribe("[M3.1] tools", () => {});\n')).toEqual({ tags: ["F1", "M3.1"], untagged: 0 });
  });

  it("plans F tags up to the target and every inherited M tag, and names an untagged file", () => {
    const dir = mkdtempSync(join(tmpdir(), "accept-plan-"));
    try {
      const write = (f: string, text: string) => {
        mkdirSync(join(dir, f, ".."), { recursive: true });
        writeFileSync(join(dir, f), text);
      };
      write("test/a.test.ts", 'describe("[F0] a", () => {});\n');
      write("test/b.test.ts", 'describe("[F1] b", () => {});\n');
      write("test/c.test.ts", 'describe("[M24.3] c", () => {});\n');
      write("test/d.test.ts", 'describe("no tag", () => {});\n');
      write("test/e.live.test.ts", 'describe("[F0] live", () => {});\n');
      const rel = (f: string) => relative(root, join(dir, f));
      const plan = planHermetic(parsePartId("F0")!, [join(dir, "test")]);
      expect(plan.files).toEqual([rel("test/a.test.ts"), rel("test/c.test.ts")]);
      expect(plan.tags).toEqual(["F0", "M24.3"]);
      expect(plan.untagged).toEqual([rel("test/d.test.ts")]);
      expect(plan.own).toEqual([rel("test/a.test.ts")]);
      const f1 = planHermetic(parsePartId("F1")!, [join(dir, "test")]);
      expect(f1.tags).toEqual(["F0", "F1", "M24.3"]);
      expect(f1.own).toEqual([rel("test/b.test.ts")]);
      // A part with no test of its own plans nothing of its own, however much of the inherited suite is in scope.
      const f2 = planHermetic(parsePartId("F2")!, [join(dir, "test")]);
      expect(f2.files).toEqual([rel("test/a.test.ts"), rel("test/b.test.ts"), rel("test/c.test.ts")]);
      expect(f2.own).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("gives the hermetic lane no credential", () => {
    const env = hermeticEnv();
    expect(Object.keys(env).filter((k) => /TOKEN|SECRET|KEY|PASSWORD|^CLOUDFLARE_|^CF_/.test(k))).toEqual([]);
    expect(env.QYVR_HERMETIC).toBe("1");
  });
});

describe("[M0.1] hermetic lane setup", () => {
  it("denies network access", async () => {
    await expect(fetch("https://example.com/")).rejects.toThrow(/^Unmocked outbound request: GET https:\/\/example\.com\//);
    expect(hermeticNetwork.takeUnmockedCalls("example.com")).toEqual(["GET https://example.com/"]);
  });
});
