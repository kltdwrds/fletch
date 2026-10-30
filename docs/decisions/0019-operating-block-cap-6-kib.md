---
id: D-0019
title: The operating block's cap is 6 KiB, held by a test, so P14's identity section fits
status: accepted
door: two-way
decided: 2026-10-30
decider: agent
confirmation: test/m0/f40-contract.test.ts
revisit-when: the block passes 6 KiB again, or the prefix's cache cost makes a smaller block worth cutting other sections for
---
Ruling: `OPERATING_BLOCK_MAX_BYTES` is `6 * 1024` and `test/m0/f40-contract.test.ts` fails when the rendered block
passes it — because F40's scope (P14 delta 1) puts an `identity` section in `chat/operating-block.ts`, the block was
5076 bytes under a 5 KiB cap before it and is 5682 with it, and the alternatives cut other parts' sections or drop
the section the contract asks for — if wrong, the identity section moves to `WORK_WORDS` alone and the cap returns.

## Context

The cap was set at 5 KiB in M24.1 and nothing read it: no test or check held the block to it. F40's delta 1 adds
about 600 bytes of identity and sign-in lines, and only 44 bytes were left. The decision log is at its cap (Q30), so
this is a record rather than a line there.

## Options

- **Chosen:** raise the cap to 6 KiB and hold the block to it with a test, for the first time.
- Rejected: trim the other ten sections to make room, which rewrites lines other parts' tasks grade.
- Rejected: keep the identity lines in `WORK_WORDS` only, which drops the section F40's scope names.
