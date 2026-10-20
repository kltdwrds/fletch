// A hermetic two-member world for M24.3's attachments: each member's real `PersonAttachments` over the
// object harness (as `objects/person.ts` builds it), one in-memory R2 shared by both (as the tenant bucket
// is), and the agent script's real `route` for the app's requests, the person coming from the session's
// props alone. The reader (workstream A's ingest) and the image converter are injected stand-ins that
// record what they were given, so a test shows what reached them.
import type { Caps, ImageConverter } from "../../../packages/agent/src/attachments/caps.ts";
import { type DescribeFn, type IngestFn, PersonAttachments } from "../../../packages/agent/src/attachments/store.ts";
import { runAttachmentCall } from "../../../packages/agent/src/attachments/links.ts";
import { PersonFiles } from "../../../packages/agent/src/files/store.ts";
import { PersonLinks } from "../../../packages/agent/src/files/links.ts";
import { type Directory, route } from "../../../packages/agent/src/http/routes.ts";
import people from "../../fixtures/people.json" with { type: "json" };
import { ObjectHarness } from "../../support/object-harness.ts";
import { asBucket, FakeR2 } from "./fake-r2.ts";

const person = (id: string) => people.people.find((p) => p.id === id) as (typeof people.people)[number];
export const ada = person("sam-solo");
export const TENANT = "solo-sam";
export const ORIGIN = `https://${TENANT}.example`;
export const T0 = Date.UTC(2026, 9, 16, 9, 0);

/** A JPEG's first bytes, as a converter's answer starts. */
export const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0]);
/** A HEIC's box header (fictional content after it). */
export const HEIC = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 104, 101, 105, 99, 1, 2, 3]);

export type Ingested = { owner: string; attachmentId: string; name: string; mime: string; size: number };

/** The model's line for a file as the stand-in reader describes it. */
export const describe: DescribeFn = (name, r) => (r.ok ? `${name} (${r.kind}, ${r.pages} page${r.pages === 1 ? "" : "s"}) is at ${r.treePath}` : `${name} could not be read (${r.code})`);

export function attachmentWorld(o: { convert?: ImageConverter | null; caps?: Caps; ingest?: IngestFn; r2?: FakeR2 } = {}) {
  const r2 = o.r2 ?? new FakeR2();
  const clock = { now: T0 };
  const ingested: Ingested[] = [];
  const converted: Array<{ mime: string; size: number }> = [];
  const ingest: IngestFn =
    o.ingest ??
    (async (i) => {
      ingested.push({ owner: i.owner, attachmentId: i.attachmentId, name: i.name, mime: i.mime, size: i.bytes.byteLength });
      return { ok: true, kind: i.mime.startsWith("image/") ? "image" : "document", treePath: `work/uploads/${i.name}`, pages: 1 };
    });
  const convert: ImageConverter | null =
    o.convert === undefined
      ? null
      : o.convert && (async (i) => {
          converted.push({ mime: i.mime, size: i.bytes.byteLength });
          return (o.convert as ImageConverter)(i);
        });
  // Each member's store and signing key over one object's storage, as `objects/person.ts` builds them.
  const harnesses = new Map<string, ObjectHarness<{ store: PersonAttachments; links: PersonLinks }>>();
  const harness = (p: string) => {
    let h = harnesses.get(p);
    if (!h) {
      h = new ObjectHarness(p, (ctx) => {
        const storage = (ctx as DurableObjectState).storage;
        const store = new PersonAttachments(storage, { person: p, bucket: asBucket(r2) as never, ingest, describe, convert, now: () => clock.now, ...(o.caps ? { caps: o.caps } : {}) });
        return { store, links: new PersonLinks(storage, new PersonFiles(storage, asBucket(r2), p, () => clock.now), asBucket(r2), () => clock.now) };
      }, {});
      harnesses.set(p, h);
    }
    return h;
  };
  const store = (p: string) => harness(p).instance.store;
  const attachments = { call: async (p: string, c: never) => runAttachmentCall(store(p), harness(p).instance.links, p, c), bucket: asBucket(r2) as never, convert, ...(o.caps ? { caps: o.caps } : {}) };
  const dir = { app: { attachments } } as unknown as Directory;
  const env = { TENANT_ID: TENANT, QYVR_ENV: "test", TENANT_SHAPE: "company" };

  /** One request to the agent script as `as` (the session's person); a form goes as multipart. */
  const http = async (as: string, method: string, path: string, body?: FormData, headers: Record<string, string> = {}) => {
    const res = await route(new Request(`${ORIGIN}${path}`, { method, headers: { origin: ORIGIN, ...headers }, ...(body ? { body } : {}) }), env as never, { tenant: TENANT, person: as }, dir);
    const type = res.headers.get("content-type") ?? "";
    const raw = new Uint8Array(await res.arrayBuffer());
    const json = type.includes("json") ? (JSON.parse(new TextDecoder().decode(raw)) as Record<string, unknown>) : null;
    return { status: res.status, body: json ?? {}, bytes: raw, headers: res.headers };
  };

  /** The composer's upload: one file in field `file`, `pasted=1` for a pasted image, and any other fields a page might add. */
  const upload = (as: string, name: string, bytes: Uint8Array, opts: { type?: string; pasted?: boolean; fields?: Record<string, string>; headers?: Record<string, string> } = {}) => {
    const form = new FormData();
    form.append("file", new File([bytes.slice()], name, { type: opts.type ?? "" }));
    if (opts.pasted) form.append("pasted", "1");
    for (const [k, v] of Object.entries(opts.fields ?? {})) form.append(k, v);
    return http(as, "POST", "/app/attachments", form, opts.headers);
  };

  /** Every row of a person's attachments table, as stored. */
  const rows = (p: string) => (harness(p).rows("SELECT name FROM sqlite_master WHERE name = 'attachments'").length ? harness(p).rows("SELECT * FROM attachments ORDER BY created_at, id") : []);
  /** A signed download link from the person's own object, as the page asks before every download (M24.3). */
  const link = async (as: string, id: string, download = false) => {
    const r = await http(as, "GET", `/app/attachments/${id}/link${download ? "?download=1" : ""}`);
    return r.status === 200 ? String(r.body.url) : r;
  };
  /** A download as the page makes it: a link from the session's own object, then the bytes with it. */
  const download = async (as: string, id: string) => {
    const url = await link(as, id);
    return typeof url === "string" ? http(as, "GET", url) : url;
  };
  return { r2, clock, ingested, converted, store, harness, rows, http, upload, dir, link, download };
}
