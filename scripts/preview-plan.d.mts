// Types for what the tier-2 runner (scripts/evals/slot.ts) reads from scripts/preview-plan.mjs; the code is the .mjs.
export const PREFIX: string;
export const SLOT_OWNER: string;
export function ownerTag(root: string): string;
export function slotPlan(n: number, subdomain?: string | null): { n: number; name: string; worker: string; host: string | null };
export function origin(plan: { host: string | null }): string;
