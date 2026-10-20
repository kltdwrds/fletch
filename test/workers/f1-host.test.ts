// F1: the host seam. Every platform service the agent reaches goes through `hostOf(env)`, one Host per env
// object, built by the one factory the entry module installed. Before any factory there is no host, and a
// second factory is refused: a deploy never runs with two hosts.
import { afterAll, describe, expect, it } from "vitest";
import type { Host } from "@qyvr/host";
import { __resetHostForTests, hostOf, setHost } from "../../packages/agent/src/host.ts";
import { installTestHost, testHost } from "../support/host.ts";

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return undefined;
};

describe("[F1] hostOf", () => {
  afterAll(() => installTestHost());

  it("before setHost there is no host: hostOf throws HOST_NOT_SET", () => {
    __resetHostForTests();
    expect(codeOf(() => hostOf({ TENANT_ID: "solo-sam" } as unknown as Env))).toBe("HOST_NOT_SET");
  });

  it("after setHost, one host per env object, built once; a second setHost throws", () => {
    __resetHostForTests();
    const built: unknown[] = [];
    setHost((env) => {
      built.push(env);
      return testHost(env as unknown as Record<string, unknown>);
    });
    const env = { TENANT_ID: "solo-sam" } as unknown as Env;
    const first: Host = hostOf(env);
    expect(hostOf(env)).toBe(first);
    expect(built).toEqual([env]);
    // Another env object is another host, from the same factory.
    expect(hostOf({ TENANT_ID: "solo-sam" } as unknown as Env)).not.toBe(first);
    expect(built).toHaveLength(2);
    expect(codeOf(() => setHost(() => first))).toBe("HOST_ALREADY_SET");
  });
});
