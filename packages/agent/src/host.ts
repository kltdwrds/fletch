// The host seam (F1): every service the agent takes from where it is deployed (keys, identity, mail,
// workspace, provisioning, members, render, budget, reporter, the member seed) comes from one `Host`,
// asked for with `hostOf(env)`. The entry module installs the factory once (`setHost`); each env object
// gets one host, built on first ask. A feature the host does not offer is a `HostFailure`, which the
// caller returns as it is: the code and reason reach the UI, never an empty success.
import type { Host, HostFailure } from "@qyvr/host";

export type HostFactory = (env: Env) => Host;

export class HostError extends Error {
  readonly code: "HOST_NOT_SET" | "HOST_ALREADY_SET";
  constructor(code: HostError["code"], message: string) {
    super(`${code}: ${message}`);
    this.code = code;
  }
}

let factory: HostFactory | null = null;
let hosts = new WeakMap<object, Host>();

/** Called once, by the entry module; a second call throws, so a deploy never runs with two hosts. */
export function setHost(f: HostFactory): void {
  if (factory) throw new HostError("HOST_ALREADY_SET", "the host factory is installed once, by the entry module");
  factory = f;
}

/** The host for this env object, built once; throws HOST_NOT_SET before the entry module installed a factory. */
export function hostOf(env: Env): Host {
  if (!factory) throw new HostError("HOST_NOT_SET", "no host factory is installed; the entry module calls setHost");
  let host = hosts.get(env);
  if (!host) {
    host = factory(env);
    hosts.set(env, host);
  }
  return host;
}

/** Whether a host feature is offered: anything but a `{ ok: false }` refusal. */
export function available<T>(x: T | HostFailure): x is T {
  return !(typeof x === "object" && x !== null && "ok" in x && (x as { ok: unknown }).ok === false);
}

/** Tests only: forgets the installed factory and every host, so the test lane installs its own. */
export function __resetHostForTests(): void {
  factory = null;
  hosts = new WeakMap();
}
