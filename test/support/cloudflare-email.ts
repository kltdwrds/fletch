// Node stand-in for `cloudflare:email`, which the Agents SDK imports at load; mail arrives at M6.
export class EmailMessage {
  readonly from: string;
  readonly to: string;
  readonly raw: unknown;
  constructor(from: string, to: string, raw: unknown) {
    this.from = from;
    this.to = to;
    this.raw = raw;
  }
}
