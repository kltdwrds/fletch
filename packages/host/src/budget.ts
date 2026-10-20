export interface BudgetService {
  report(day: string, total: number): Promise<{ ok: boolean }>;
  check(day: string): Promise<{ ok: true } | { ok: false; code: string; reason: string }>;
}
