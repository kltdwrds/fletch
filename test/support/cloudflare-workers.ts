// Node stand-in for the `cloudflare:workers` base classes, for hermetic tests of Worker modules.
// It carries no behaviour of its own: the class under test supplies all of it.
export class DurableObject<E = unknown> {
  protected ctx: unknown;
  protected env: E;
  constructor(ctx: unknown, env: E) {
    this.ctx = ctx;
    this.env = env;
  }
}

export class WorkerEntrypoint<E = unknown, P = unknown> {
  protected ctx: { props: P };
  protected env: E;
  constructor(ctx: { props: P }, env: E) {
    this.ctx = ctx;
    this.env = env;
  }
}

// The rest of the module's surface that the Agents SDK imports at load; inert under Node.
export class RpcTarget {}
export class WorkflowEntrypoint<E = unknown> {
  protected env: E;
  constructor(_ctx: unknown, env: E) {
    this.env = env;
  }
}
export const env: Record<string, unknown> = {};
export const exports: Record<string, unknown> = {};

/**
 * The runtime's `tracing` (Workers traces), recording instead of exporting: tests read the spans a
 * module opened from `recordedSpans` and clear them with `resetSpans`. An `enterSpan` span ends when
 * its callback settles; a `startActiveSpan` span ends when its owner calls `end()`, as in workerd.
 */
export interface RecordedSpan {
  name: string;
  attributes: Record<string, string | number | boolean>;
  ended: boolean;
}
export const recordedSpans: RecordedSpan[] = [];
export function resetSpans(): void {
  recordedSpans.length = 0;
}
class ShimSpan {
  readonly record: RecordedSpan;
  constructor(name: string) {
    this.record = { name, attributes: {}, ended: false };
    recordedSpans.push(this.record);
  }
  get isTraced() {
    return true;
  }
  setAttribute(key: string, value: string | number | boolean) {
    this.record.attributes[key] = value;
    return this;
  }
  setAttributes(attributes: Record<string, string | number | boolean | undefined>) {
    for (const [k, v] of Object.entries(attributes)) if (v !== undefined) this.record.attributes[k] = v;
    return this;
  }
  end() {
    this.record.ended = true;
  }
}
export const tracing = {
  enterSpan<T, A extends unknown[]>(name: string, callback: (span: ShimSpan, ...args: A) => T, ...args: A): T {
    const span = new ShimSpan(name);
    const out = callback(span, ...args);
    if (out instanceof Promise) out.then(() => span.end(), () => span.end());
    else span.end();
    return out;
  },
  startActiveSpan<T, A extends unknown[]>(name: string, callback: (span: ShimSpan, ...args: A) => T, ...args: A): T {
    return callback(new ShimSpan(name), ...args);
  },
};
