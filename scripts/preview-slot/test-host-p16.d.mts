// Types for ./test-host-p16.mjs (F81), for the hermetic test that runs it.
type PersonStub = {
  browseRecord(r: { domain: string; engine: null; state: string; code: null }): Promise<unknown>;
  chatsCall(owner: string, call: { op: string; id?: string }): Promise<unknown>;
  testHostP6(call: { do: string }): Promise<unknown>;
  jobIds(owner: string): Promise<string[] | null>;
};
export declare const P16_DOMAINS: string[];
export declare function p16Page(url: unknown): { status: number; markdown: string } | undefined;
export declare function p16Reset(person: PersonStub, owner: string, keep: string, job: (id: string) => { remove(by: string): Promise<unknown> }): Promise<{ reopened: string[]; deleted: string[]; jobs: string[] }>;
