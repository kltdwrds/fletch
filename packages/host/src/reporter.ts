export interface Reporter {
  report(event: string, fields: Record<string, unknown>, level?: "info" | "warn" | "error"): void;
}
