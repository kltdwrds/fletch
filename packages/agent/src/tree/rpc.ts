// The working tree on the person's `Person` object (M24.3): one tree per object storage, built on the
// Agents SDK `Workspace` over that storage, and one RPC entry (`treeCall`) the chat reaches it through.
// The store decides the owner on every call (`PersonTree`).
import { Workspace } from "@cloudflare/computer";
import type { TreeApi } from "../files/tools.ts";
import { PersonTree } from "./tree.ts";

const trees = new WeakMap<object, PersonTree>();

/** The owner's tree over this object's storage, built once per instance. */
export function treeOf(storage: DurableObjectStorage, owner: string): PersonTree {
  let tree = trees.get(storage);
  if (!tree) {
    tree = new PersonTree(new Workspace({ storage }).fs, owner);
    trees.set(storage, tree);
  }
  return tree;
}

type Input<K extends keyof TreeApi> = Parameters<TreeApi[K]>[0];
export type TreeCall =
  | { op: "read"; input: Input<"treeRead"> }
  | { op: "write"; input: Input<"treeWrite"> }
  | { op: "edit"; input: Input<"treeEdit"> }
  | { op: "list"; input: Input<"treeList"> }
  | { op: "grep"; input: Input<"treeGrep"> }
  | { op: "find"; input: Input<"treeFind"> }
  | { op: "delete"; input: Input<"treeDelete"> };

export function runTreeCall(tree: PersonTree, call: TreeCall, requester: string) {
  switch (call.op) {
    case "read":
      return tree.read(call.input, requester);
    case "write":
      return tree.write(call.input, requester);
    case "edit":
      return tree.edit(call.input, requester);
    case "list":
      return tree.list(call.input, requester);
    case "grep":
      return tree.grep(call.input, requester);
    case "find":
      return tree.find(call.input, requester);
    case "delete":
      return tree.remove(call.input, requester);
  }
}

/** A `TreeApi` over one entry point, as the chat reaches the owner's object over RPC. */
export function treeApi(call: (c: TreeCall, requester: string) => Promise<unknown>): TreeApi {
  const via = <R>(c: TreeCall, requester: string) => call(c, requester) as Promise<R>;
  return {
    treeRead: (input, r) => via({ op: "read", input }, r),
    treeWrite: (input, r) => via({ op: "write", input }, r),
    treeEdit: (input, r) => via({ op: "edit", input }, r),
    treeList: (input, r) => via({ op: "list", input }, r),
    treeGrep: (input, r) => via({ op: "grep", input }, r),
    treeFind: (input, r) => via({ op: "find", input }, r),
    treeDelete: (input, r) => via({ op: "delete", input }, r),
  };
}

/** The same API straight on a tree, for a caller in the owner's own object. */
export const directTreeApi = (tree: PersonTree): TreeApi => treeApi(async (c, r) => runTreeCall(tree, c, r));
