/** AD-1's object classes in order; the /health route, the wrangler bindings and the tests use this list. */
export const OBJECT_CLASSES = ["Person", "Company", "Chat", "Job", "Ingress", "Ledger", "Vault"] as const;
export type ObjectClass = (typeof OBJECT_CLASSES)[number];
