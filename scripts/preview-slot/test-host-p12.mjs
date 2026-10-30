// The P12 tier-2 tasks' world on a preview slot (F39): what ./test-host.mjs's `Chat`, `Person` and `Ledger` add so a
// payments grader reads a real slot with the real model. Deployed only to a slot, through ./app.mjs, and served only to
// the lease's holder (./ops.mjs, `/__preview/test-host`). Pure, so a hermetic test runs it.
//
// - The dead shop. `shop.example.invalid` is no site the test host's browser serves (./test-host-sites.mjs), so a read
//   of it is a 404 and `BROWSE_UNREACHABLE`, as in the tier-1 world; the `reset` op reopens it in the person's browse
//   memory before a trial, so no earlier trial's failed read is remembered as a block.
// - The rows. A chat's cards with the words `renderCard` gives them, a person's authority grants, their journal rows
//   and their jobs' titles, as the tier-1 world reads them; and a reset that deletes the person's grant rows before a
//   trial (the `p9` op deletes their credential and typed rows, ./test-host-p9.mjs; a trial's chat is new, so it holds
//   no card).
import { CardStore, renderCard } from '../../packages/agent/src/chat/cards.ts';
import { DEAD_SHOP } from '../../test/evals/p12-wallet/world.ts';

/** The shop whose address does not resolve (T-P12-10): no site of the test host's browser. */
export const P12_DEAD = DEAD_SHOP;

/** A person's grant tables (`packages/agent/src/grants/store.ts`), in the person's own object. */
export const P12_TABLES = ['grants', 'grant_uses', 'committed_effects'];

const has = (sql, t) => sql.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", t).toArray().length > 0;

/** Deletes every grant row in a person's object before a trial, so each starts with none (T-P12-12's "no grants"). */
export function p12Reset(sql) {
  for (const t of P12_TABLES) if (has(sql, t)) sql.exec(`DELETE FROM "${t}"`);
}

/** A chat's cards with their words, oldest first, as the tier-1 world's `cardWords` reads them. */
export function p12Cards(storage, nameOf) {
  if (!has(storage.sql, 'cards')) return [];
  return new CardStore(storage).list().map((c) => {
    const v = renderCard(c, nameOf, c.tool.replaceAll('_', ' '));
    return { id: c.id, tool: c.tool, kind: c.descriptor.actionKind, state: c.state, outcome: c.outcome, grantId: c.grantId, lines: v.lines, choices: v.choices.map((x) => x.label), proposed: v.proposed, decidedAt: c.decidedAt };
  });
}

/** A person's authority grants as the tier-1 world's `grantRows` reads them. */
export const p12Grants = (grants) =>
  (grants ?? []).map((g) => ({ id: g.id, subject: `${g.subject.kind}:${g.subject.ref}`, mode: g.mode, oneShot: g.one_shot === true, usedAt: g.used_at ?? null, createdFrom: g.created_from, maxAmount: g.constraints?.max_amount ?? null }));

/** A person's journal rows as the tier-1 world's `ledgerJournal` reads them. */
export const p12Journal = (rows) => rows.map((r) => ({ id: r.id, actionKind: r.actionKind, decision: r.decision, outcome: r.outcome, grantId: r.grantId, fields: Object.keys(r), raw: JSON.stringify(r) }));
