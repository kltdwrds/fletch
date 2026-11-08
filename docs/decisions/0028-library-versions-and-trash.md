---
id: D-0028
title: A Library file keeps its earlier versions and a deleted file sits in a trash, in the owner's Person object and R2, until the owner empties it or a cap ends it
status: proposed
door: one-way
decided: 2026-11-08
decider: agent
confirmation: review
review-by: 2026-12-31
revisit-when: Kyle accepts or rejects it, or the version and trash caps prove wrong in use (a Library over its R2 budget, or an owner who lost a version to the cap)
---
Ruling: every write over an existing file in the owner's home tree (`PersonFiles.write`, `writeBytes`, `rename` onto it
being refused as today) first keeps the replaced bytes as version n of that path, in a `file_versions` table in the
Person object (path, n, size, sha256, writer, at) with the bytes in R2 under the person's home key and a `versions/`
prefix; a delete moves the row and its versions to a `file_trash` table instead of removing them; the owner lists,
opens and restores a version, and lists, restores or empties the trash, from the Library and through the agent's
`files` tools; a version or a trashed file is the owner's alone, never served by a share, and ends with offboarding's
purge; caps: 20 versions per path and 30 days in the trash, the oldest dropped first, each drop a content-free Ledger
`journal` row — because P11's interrogation found Muse overwriting the memo and the budget in place with no version
and deleting the deck with no trash (`docs/plan-v2/contracts/P11-files-documents.md`, B-P11-05 and B-P11-14), and a new
table and R2 prefix are a storage schema, a door only Kyle opens — if wrong, the two tables, the prefix, the routes
and the tool parameters F103 adds are deleted (it builds them as one deletable unit, listed in its PR under "To revert
D-0028"), and an edit keeps saying that the earlier content was not kept (F100's words).

## Context

The P11 contract (17 clauses, 18 tasks) holds the honest fallback without this record: an edit says it replaced a file
and did not keep it (B-P11-04, must-have), and a delete is journaled and ends its shares (B-P11-14, must-have). Only
the versions and the trash need storage; their task, T-P11-05, is nice-to-have so P11's level never rests on this door.
Written under Kyle's ruling of 2026-11-08 ("answer all of these with defaults and best effort to unblock"): the
default taken is that F103 builds it on the default as F55 built on D-0016, deletable and flagged for Reconcile.

## Options

- **Chosen:** versions and a trash in the Person object and R2, capped.
- Rejected: R2 object versioning on the bucket (not per person, not listable by the owner from the DO, and no trash).
- Rejected: no versions, only the said fallback (loses what a person expects of a document store, and what Muse also
  lacks; the deck had to be built from the edited memo because the original was gone).
- Rejected: versions as sibling files (`memo-v2.md`): two documents that drift, the defect B-P11-04 names.
