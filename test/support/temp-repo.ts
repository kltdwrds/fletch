// Throwaway git repositories for tests that plant a violation in a tracked file. Commits are made
// as a fixture identity, never the developer's.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// A path, not a URL: the Workers project type-checks this file too (M27.1's test imports it), and its URL is not Node's.
export const repoRoot = join(import.meta.dirname, "../..");

export const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "Sam Solo",
  GIT_AUTHOR_EMAIL: "sam@solo-sam.example",
  GIT_COMMITTER_NAME: "Sam Solo",
  GIT_COMMITTER_EMAIL: "sam@solo-sam.example",
  GIT_CONFIG_NOSYSTEM: "1",
};

export function git(cwd: string, args: string[]): string {
  const res = spawnSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV });
  if (res.status !== 0) throw new Error(`git ${args.join(" ")}: ${res.stderr}`);
  return res.stdout.trim();
}

export interface TempRepo {
  dir: string;
  /** Writes a file and stages it, so it counts as tracked. */
  track(path: string, content: string): void;
  /** Writes a file without staging it. */
  write(path: string, content: string): void;
  cleanup(): void;
}

/** A git repository with this repository's people.json, as the scans expect. */
export function tempRepo(): TempRepo {
  const dir = mkdtempSync(join(tmpdir(), "qyvr-test-repo-"));
  git(dir, ["init", "--quiet"]);
  const write = (path: string, content: string) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  };
  mkdirSync(join(dir, "test/fixtures"), { recursive: true });
  copyFileSync(join(repoRoot, "test/fixtures/people.json"), join(dir, "test/fixtures/people.json"));
  git(dir, ["add", "test/fixtures/people.json"]);
  return {
    dir,
    write,
    track(path, content) {
      write(path, content);
      git(dir, ["add", path]);
    },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
