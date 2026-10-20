// How the engine builds the `browse` namespace for one chat (M9), kept out of the engine file: the
// url table and the live session id live in the chat's meta, the rest comes from the hook.
import type { EngineMemoryApi } from "./memory.ts";
import type { BrowserPort } from "./port.ts";
import { browseNamespace, type FillApi, type LoginsApi } from "./tools.ts";
import { UrlTable } from "./urls.ts";
import type { Namespace } from "../tools/registry.ts";

export interface BrowseHook {
  port: BrowserPort;
  memory: (person: string) => EngineMemoryApi;
  fill?: (person: string) => FillApi;
  /** Saved logins in the Vault (M24.3), for this person alone. */
  logins?: (person: string) => LoginsApi;
}

/** A chat-meta cell: `get` is null when unset. */
export interface MetaCell {
  get(): string | null;
  set(value: string | null): void;
}

export function chatBrowse(hook: BrowseHook, person: string, cells: { urls: MetaCell; session: MetaCell }, now: () => number): Namespace {
  return browseNamespace({
    port: hook.port,
    memory: hook.memory(person),
    urls: new UrlTable({ get: () => cells.urls.get(), set: (v) => cells.urls.set(v) }),
    session: cells.session,
    ...(hook.fill ? { fill: hook.fill(person) } : {}),
    ...(hook.logins ? { logins: hook.logins(person) } : {}),
    now,
  });
}
