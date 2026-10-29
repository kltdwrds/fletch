# The delegation kernel — what transfers across delegated agents

Written 2026-10-28 from a read of three repos: `fletch` (`packages/agent/src/{grants,tools,skills,learning,subagents,context,vault,egress,code}`, `packages/host`), `muse` (harness spec 2026-10-11, plan AD-1…15, capability checklist, cf-os assessment), `qyvr` (`VISION.md`, `docs/v1/PRIMITIVES.md`, `docs/v1/DECISIONS.md`, harness comparison). This copy, in fletch, is canonical; the parity framework (`2026-10-29-parity-framework-design.md`) builds to it.

## Claim

The transferable part of a delegated agent is not the loop. It is everything that answers *on whose behalf, under what authority, over what scope, leaving what record*. All three repos converged on the same twelve pieces independently. Both target cases (a per-user workspace inside a product; a client-services liaison such as wealth management) are the kernel plus configuration; the difference is one grantor.

The most complete implementation of the kernel is `fletch/packages/agent/src/grants/` + `@qyvr/host`. qyvr v1 (B10, B17, PRIMITIVES "Not one of the six") parked it. Case 2 is the parked part.

## The twelve pieces

| # | Piece | Exists in | Shrinks with better models? |
|---|---|---|---|
| 1 | Principal / delegate / sponsor identity | crest (NIP-OA attestation); fletch `Party`; qyvr VISION | No |
| 2 | Scope (tenant / workspace) | fletch `Host.tenant {id, shape: standalone\|company, env}`; cf-os Overseer per workspace; B9 one DO per account | No |
| 3 | Grants + authority matrix (grantor `person\|company\|platform`; grantee `own-agent\|person\|agent-of-person\|team\|company\|any-member`; subject `action-kind\|connector\|resource\|skill\|memory-scope`; mode `auto\|ask\|deny`; windows, rates, one-shot vs lasting; `allowed\|asks-once\|standing-grant\|never`) | fletch `grants/types.ts`, `matrix.ts`, `engine.ts` | No — grows |
| 4 | Observation/action classification by the connector; approvals rendered by the harness; pending actions simulated; approval cards unforgeable, denial final | cf-os gatekeepers (A1); Muse AD-7; fletch `tools/registry.ts` `ToolKind`, `Gate` | No |
| 5 | Credentials as `cred://` references, values injected only at egress | Muse Secure Vault; AD-12; fletch `vault/`, `egress/outbound.ts` | No |
| 6 | Context assembly with authority order and data fencing | Muse §3 (7 inputs), AD-6; fletch `context/assemble.ts`, `fence.ts` | Partly (caps expire; authority order does not) |
| 7 | Memory with provenance, supersession, scope, forget-with-retraction | Muse three stores; fletch `memory-scope` grant subject | No |
| 8 | Skills catalog with scope (`personal\|team\|company\|platform\|docs`) + consent-gated promotion ladder; promotion refuses host/capability widening | fletch `skills/catalog.ts`, `learning/ladder.ts`; cf-os Context Library; Skill Misevolution (arXiv 2608.12851) | No |
| 9 | Delegation: subagents with depth cap, budgets, stall detection, separate resolve/verify step | Muse Shape B, "run then resolve"; fletch `subagents/` | Yes, fastest |
| 10 | Jobs: deterministic gates before any model call, run ledger, closed terminal signals, delivery outbox, auto-disable | Muse 348M-token lesson → AD-3/AD-4; fletch `JOB/INGRESS/LEDGER`; cf-os scheduler | Partly |
| 11 | Audit: content-free journal + signed facts; refused-by-name codes | fletch `grants/journal.ts`, `verify.ts`; qyvr feed; D-0001 | No |
| 12 | Execution sandbox with capability stubs (fresh isolate, outbound only via gateway) | fletch `code/run.ts`; AD-8; cf-os `executeCode` | No |

**Not kernel (configuration):** surface, connector set, skill contents, standing-file contents, model routing, proactive loops (feed/ideas/briefings), product UI, and the agent loop itself.

## The two cases

**Case 1 — per-user workspace inside a product.** Principal = user; sponsor = product (`grantor: platform`); scope = user's workspace, one DO per account. Product sets the matrix, ships `platform`-scope skills, exposes its API as a gatekeeper, supplies standing-file template and surface. User grants their own accounts (`grantor: person`). = fletch `tenant.shape: standalone`, hosted multi-tenant.

**Case 2 — client-services liaison.** Agent is the client's delegate (`grantee: agent-of-person`); the firm is a second grantor (`grantor: company`) under an admin-set matrix (`created_from: admin-ui`). Deltas over case 1:
1. `company` grantor + admin surface for the matrix (fletch's parked company layer: `COMPANY` DO, `loops/company.ts`, members sync, `PersonAuthority`/`CompanyPort`).
2. Restricted-data latch (cf-os): regulated data suspends auto-approval and web fetches for the run.
3. Observer verification (cf-os): an advisor sees only what they independently hold access to.
4. Memory-scope grants: client personal memory vs engagement memory; forget retracts derived facts.
5. Sponsorship via crest: the firm is sponsor of record in signed events.

Later: the two-agent form (client's agent ↔ advisor's agent) is the same kernel with feed/relay signed events as the channel.

## Against current plans

- qyvr "not an agent framework" is right about loop and model; the kernel is the runtime enforcement of qyvr.ai's promises (answers to a person; acts only with what it was given; code can't reach what it wasn't given; say what really happened). Grants/authority/journal belong to qyvr.ai conceptually; fletch is the reference client (B10). What to publish after M3 is the authority layer with `host` as its platform seam, not `host` alone.
- Muse AD-1 topology (`Owner/Chat/Job/Ingress/Ledger/Vault`) is fletch's `PERSON/CHAT/JOB/INGRESS/LEDGER/VAULT` + `COMPANY`. Muse = rationale and evidence; fletch = implementation; qyvr = identity and network above. No fourth architecture.
- Missing universal: the conformance/eval suite (`muse/research/outer-harness.md` §11; B23 pattern). Injection, grant-matrix, refused-by-name, journal-completeness evals. A kernel is real when any agent built on it must pass that suite.

## Proposed next step

A one-page kernel contract in the qyvr repo naming the twelve interfaces by their existing TypeScript types, marking published vs private, and listing the case-2 deltas as an M4 part scoped "unpark, don't redesign."
