---
id: D-0005
title: create-fletch deploys the agent from a fletch checkout, not from a published package
status: superseded
superseded-by: D-0022
door: two-way
decided: 2026-10-20
decider: inherited
confirmation: review
review-by: 2027-01-20
revisit-when: someone wants `npm create fletch` without cloning, or the first owner other than Kyle sets one up
---
Ruling: the `wrangler.jsonc` that `create-fletch` writes points `main` at the checkout's agent source and runs the
`wrangler` that `create-fletch` depends on — because publishing the agent as a package is work the first deploys do
not need — if wrong, every owner must clone the repository and keep it to update, which is friction for anyone
but a developer.
