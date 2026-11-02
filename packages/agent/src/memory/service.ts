// The memory API the `Person` object serves (and the hermetic tests call directly): the tools'
// operations plus the owner-only forget flow and entity upkeep. Personal memory is decided by
// `PersonMemory`; company and team scope by the `Company` (M10.1), searched beside it with every
// hit tagged by scope, and both apply the disclosure gate to each reader of the turn.
import { credentialContent } from "../learning/referee.ts";
import { type CompanyMemoryApi, isScopePath } from "./company.ts";
import { readersOf } from "./disclosure.ts";
import { type EntityInput, notePerson, upsertEntity } from "./entities.ts";
import { confirmForget, executeForget, type ForgetProducers, planForget } from "./forget.ts";
import type { SemanticLeg } from "./semantic.ts";
import type { SearchResult } from "./store.ts";
import { MAX_LINE_CHARS, maxOf, type PersonMemory, refuse } from "./store.ts";
import type { ExplainResult, GetResult, MemoryApi, MemoryWriteInput, WriteContext, WriteResult } from "./tools.ts";

/** A personal file is shown to its owner alone, never while the turn answers anyone else. */
const notOwnerOnly = refuse("MEMORY_NOT_OWNER", "personal memory files are read by their owner only");

export class MemoryService implements MemoryApi {
  readonly mem: PersonMemory;
  private readonly company: CompanyMemoryApi | undefined;
  /** The semantic half of personal search (M12.2); absent, personal search is keyword only. */
  readonly semantic: SemanticLeg | undefined;

  constructor(mem: PersonMemory, company?: CompanyMemoryApi, semantic?: SemanticLeg) {
    this.mem = mem;
    this.company = company;
    this.semantic = semantic;
  }

  /**
   * Each store's ranked hits taken in turn, personal first, each store filtering for every reader and
   * fusing its own keyword and semantic halves. A semantic half that failed in either store is said.
   */
  async memorySearch(input: { queries: string[]; maxResults?: number }, requester: string, also: string[] = []): Promise<SearchResult> {
    const readers = readersOf(requester, also);
    const personal = this.semantic ? await this.mem.searchHybrid(input, readers, this.semantic) : this.mem.search(input, readers);
    if (!personal.ok || !this.company) return personal;
    const shared = await this.company.search(input, readers);
    if (!shared.ok) return shared;
    const max = maxOf(input);
    const semantic = personal.semantic ?? shared.semantic;
    // Scores from two indexes do not compare, so neither store's ranking crowds out the other's.
    const all = Array.from({ length: Math.max(personal.hits.length, shared.hits.length) }, (_, i) => [personal.hits[i], shared.hits[i]]).flat().filter((h) => h !== undefined);
    return { ok: true, hits: all.slice(0, max), more: personal.more + Math.max(all.length - max, 0), ...(semantic ? { semantic } : {}) };
  }

  async memoryGet(input: { path: string; from?: number; limit?: number }, requester: string, also: string[] = []): Promise<GetResult> {
    if (isScopePath(input.path)) return this.company ? this.company.get(input, readersOf(requester, also)) : refuse("MEMORY_PATH_INVALID", "this tenant has no company memory");
    const readers = readersOf(requester, also);
    if (readers.length > 1) return this.mem.sharedDaily(input, readers);
    return this.mem.get(input, requester);
  }

  async memoryExplain(input: { claimId?: string; citation?: string }, requester: string, also: string[] = []): Promise<ExplainResult> {
    if (readersOf(requester, also).length > 1) return notOwnerOnly;
    return this.mem.explain(input, requester);
  }

  /** Where one of the owner's daily lines was written, so Search can open its chat (M23.5). */
  async memoryLineSource(input: { citation: string }, requester: string) {
    return this.mem.lineSource(input, requester);
  }

  /**
   * The owner's agent writes; the setting it learned in rides with the line, and later with its claim. A credential,
   * a code, a card, an account or a government ID number is refused by code before any store sees it (B-P6-07, F27):
   * where the thing is kept may be saved, never its value.
   */
  async memoryWrite(input: MemoryWriteInput, ctx: WriteContext): Promise<WriteResult> {
    const writer = `agent:${this.mem.owner}`;
    const texts = input.target === "memory" ? (input.edits ?? []).map((e) => e.text ?? "") : input.target === "person" ? [`${input.name ?? ""}: ${input.relationship ?? ""}`] : [input.text ?? ""];
    // A daily or team line the store refuses for its shape (empty, too long) gets that code first; a MEMORY.md edit has
    // no length cap, so every edit is read for a value.
    for (const t of texts.filter((x) => x.trim() && (input.target === "memory" || x.length <= MAX_LINE_CHARS))) {
      const what = credentialContent(t);
      if (what) return refuse("MEMORY_VALUE_REFUSED", `the line holds ${what}, which memory never keeps; save where it is kept, not the value`);
    }
    if (input.target === "team") {
      if (ctx.requester !== this.mem.owner) return refuse("MEMORY_NOT_OWNER", "only the person's own agent writes for them");
      if (!this.company) return refuse("MEMORY_WRITE_TARGET", "this tenant has no teams");
      return this.company.append(this.mem.owner, { scope: `team:${input.team}`, text: input.text, writer, source: ctx.source, ...(ctx.timeZone ? { timeZone: ctx.timeZone } : {}) });
    }
    if (input.target === "memory") return this.mem.editMemory(input, writer, ctx.requester);
    // A stated relationship: its line and the person's page, refused for a non-person or a name they did not write (F44).
    if (input.target === "person") return notePerson(this.mem, input, { requester: ctx.requester, setting: ctx.setting, writer, source: ctx.source, dedupe: ctx.dedupe, ...(ctx.timeZone ? { timeZone: ctx.timeZone } : {}), ...(ctx.said === undefined ? {} : { said: ctx.said }) });
    if (input.target !== "daily") return refuse("MEMORY_WRITE_TARGET", "target is daily, team, memory or person");
    // The hourly upkeep is the only minter (Muse spec §17.3): a claim asked for in the turn writes nothing.
    if ("claim" in input) return refuse("MEMORY_CLAIM_BY_UPKEEP", "write the line alone; the hourly upkeep turns daily lines into claims");
    return this.mem.appendDaily({ text: input.text, setting: ctx.setting, writer, source: ctx.source, dedupe: ctx.dedupe, timeZone: ctx.timeZone });
  }

  async standingFiles() {
    return this.mem.standingFiles();
  }

  async renderPending(): Promise<string[]> {
    return this.mem.renderPending();
  }

  /** Sends queued chunks to the index; a failure leaves them queued for the next sync. */
  async syncVectors() {
    return this.semantic ? this.semantic.sync((ids) => this.mem.chunkTexts(ids)) : { ok: true as const, upserted: 0, deleted: 0 };
  }

  async upsertEntity(input: EntityInput, writer: string) {
    return upsertEntity(this.mem, input, writer);
  }

  async forgetPlan(input: { claimIds?: string[]; query?: string; sites?: string[] }, requester: string, producers?: ForgetProducers) {
    return planForget(this.mem, input, requester, producers);
  }

  /** Confirmation and execution are one step for the owner: execution never runs unconfirmed. */
  async forgetConfirm(planId: string, requester: string) {
    const confirmed = confirmForget(this.mem, planId, requester);
    if (!confirmed.ok) return confirmed;
    return executeForget(this.mem, planId);
  }
}
