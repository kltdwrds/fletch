// The chat's view of its owner's memory: each call goes to the owner's `Person` object over RPC,
// where the store decides it.
import { getAgentByName } from "agents";
import type { FilesApi, TreeApi } from "../files/tools.ts";
import { treeApi } from "../tree/rpc.ts";
import type { MemoryApi } from "./tools.ts";

export function personMemory(env: Env, person: string): MemoryApi {
  const stub = () => getAgentByName(env.PERSON, person);
  return {
    memorySearch: async (input, requester, also) => (await stub()).memorySearch(input, requester, also),
    memoryGet: async (input, requester, also) => (await stub()).memoryGet(input, requester, also),
    memoryExplain: async (input, requester, also) => (await stub()).memoryExplain(input, requester, also),
    memoryWrite: async (input, ctx) => (await stub()).memoryWrite(input, ctx),
    standingFiles: async () => (await stub()).standingFiles(),
  } as MemoryApi;
}

/** The chat's view of its owner's files, likewise on the owner's `Person` object. */
export function personFiles(env: Env, person: string): FilesApi {
  const stub = () => getAgentByName(env.PERSON, person);
  return {
    fileList: async (input, requester) => (await stub()).fileList(input, requester),
    fileRead: async (input, requester) => (await stub()).fileRead(input, requester),
    fileWrite: async (input, ctx) => (await stub()).fileWrite(input, ctx),
    fileDelete: async (input, requester) => (await stub()).fileDelete(input, requester),
  } as FilesApi;
}

/** The chat's view of its owner's working tree (M24.3), likewise on the owner's `Person` object. */
export function personTree(env: Env, person: string): TreeApi {
  return treeApi(async (call, requester) => (await getAgentByName(env.PERSON, person)).treeCall(call, requester));
}
