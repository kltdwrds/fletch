// A Worker Loader for the hermetic lane, with the documented `get()` semantics Code Mode relies on
// (developers.cloudflare.com/dynamic-workers/api-reference, 2026-10-12): the callback runs the first
// time an id is seen and the isolate is reused for the same id afterwards. The module is evaluated
// under Node. `globalOutbound` is honoured as `dynamic-workers/usage/egress-control` documents it
// (read 2026-10-18): it intercepts every fetch() and connect() of the Dynamic Worker. The module's
// global `fetch` goes to the stub's `fetch` for the call, and `connect` from `cloudflare:sockets`
// hands the stub's `connect` the far end of a socket (`fakeSocket`, as measured on staging); with
// `null` both throw, as the platform does. When it is left out the module inherits the process's
// fetch, which in this lane is the interceptor's refusal.
import type { LoaderLike } from "../../../packages/agent/src/code/run.ts";

type Loaded = { code: WorkerLoaderWorkerCode; mod: { default: { fetch(request: Request, env: unknown): Promise<Response> } } };
type Outbound = { fetch(request: Request): Promise<Response>; connect?(socket: unknown): unknown };

const SOCKETS_SHIM = `export const connect = (address, options) => globalThis.__fakeLoaderConnect(address, options);`;
const SOCKETS_URL = `data:text/javascript;base64,${Buffer.from(SOCKETS_SHIM, "utf8").toString("base64")}`;

export class FakeLoader implements LoaderLike {
  /** Every id whose code callback ran, in order: one entry per compiled Dynamic Worker. */
  readonly loads: string[] = [];
  /** The code each id was loaded with, so a test can read the outbound it was given. */
  readonly codes = new Map<string, WorkerLoaderWorkerCode>();
  private readonly cache = new Map<string, Promise<Loaded>>();

  get(id: string, getCode: () => Promise<WorkerLoaderWorkerCode>) {
    let entry = this.cache.get(id);
    if (!entry) {
      entry = getCode().then(async (code) => {
        this.loads.push(id);
        this.codes.set(id, code);
        const text = code.modules[code.mainModule];
        if (typeof text !== "string") throw new Error("FAKE_LOADER: the main module must be a string");
        // The module's `cloudflare:sockets` resolves to the shim, which this loader routes per call.
        const routed = text.replaceAll('"cloudflare:sockets"', JSON.stringify(SOCKETS_URL)).replaceAll("'cloudflare:sockets'", JSON.stringify(SOCKETS_URL));
        const mod = (await import(`data:text/javascript;base64,${Buffer.from(routed, "utf8").toString("base64")}`)) as Loaded["mod"];
        return { code, mod };
      });
      this.cache.set(id, entry);
    }
    const loading = entry;
    return {
      getEntrypoint: () => ({
        fetch: async (request: Request) => {
          const { code, mod } = await loading;
          return withOutbound(code.globalOutbound as Outbound | null | undefined, () => mod.default.fetch(request, code.env ?? {}));
        },
      }),
    };
  }
}

/**
 * A socket the code opened, as measured on staging (DECISIONS-LOG M25.5): `opened` resolves with the
 * address asked for before the outbound's `connect` runs, and the outbound gets the far end. When the
 * outbound's `connect` throws, the code's first write or read rejects with "Network connection lost."
 * and nothing moves; when it takes the socket, what the code writes reaches the far end and what the
 * far end writes is what the code reads. With `null` there is no network and `opened` rejects.
 */
function fakeSocket(outbound: Outbound | null | undefined, address: unknown) {
  // Buffered both ways, as a socket's are: a write lands without the other end reading it.
  const buffered = () => new TransformStream<Uint8Array, Uint8Array>({}, { highWaterMark: 64 }, { highWaterMark: 64 });
  const toFar = buffered();
  const toCode = buffered();
  const far = { readable: toFar.readable, writable: toCode.writable, close: async () => { await toCode.writable.close().catch(() => {}); } };
  const remoteAddress = typeof address === "string" ? address : `${(address as { hostname?: string })?.hostname}:${(address as { port?: number })?.port}`;
  const opened = outbound === null ? Promise.reject(new Error("Network access is disabled for this Worker (globalOutbound: null)")) : Promise.resolve({ remoteAddress });
  opened.catch(() => {});
  // The outbound refuses by throwing, at once or later; from then on the code's I/O is lost.
  let refused = false;
  let onRefused = () => {};
  const refusal = new Promise<void>((resolve) => { onRefused = resolve; });
  const refuse = () => { refused = true; onRefused(); };
  if (outbound) {
    try {
      if (!outbound.connect) throw new Error("FAKE_LOADER: the outbound has no connect handler");
      Promise.resolve(outbound.connect(far)).catch(refuse);
    } catch {
      refuse();
    }
  } else refuse();
  const lost = () => new Error("Network connection lost.");
  const reader = toCode.readable.getReader();
  const writer = toFar.writable.getWriter();
  const readable = new ReadableStream<Uint8Array>({
    async pull(c) {
      if (refused) throw lost();
      const r = await Promise.race([reader.read(), refusal.then(() => null)]);
      if (r === null) throw lost();
      if (r.done) c.close();
      else c.enqueue(r.value);
    },
  });
  const writable = new WritableStream<Uint8Array>({
    async write(chunk) {
      if (refused) throw lost();
      await writer.write(chunk);
    },
    async close() {
      if (!refused) await writer.close();
    },
  });
  return { opened, readable, writable, close: async () => { await writer.close().catch(() => {}); } };
}

async function withOutbound<T>(outbound: Outbound | null | undefined, fn: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  const g = globalThis as unknown as { __fakeLoaderConnect?: (address: unknown) => unknown };
  if (outbound === null) {
    globalThis.fetch = async () => {
      throw new Error("Network access is disabled for this Worker (globalOutbound: null)");
    };
  } else if (outbound) {
    globalThis.fetch = async (input, init) => outbound.fetch(new Request(input, init));
  }
  g.__fakeLoaderConnect = (address) => fakeSocket(outbound, address);
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
    delete g.__fakeLoaderConnect;
  }
}
