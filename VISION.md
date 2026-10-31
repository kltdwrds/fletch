# fletch — vision

fletch is a personal agent you own outright: open source, running on your own Cloudflare account, working for
you and nobody else. It is the reference agent on the qyvr spine: the kernel every delegated agent needs (who it
acts for, what it may touch, what it remembers, what it ran, what it refused), published on its own.

> You run one command from a copy of fletch. Ten minutes later an agent answers at your own address and signs you
> in with your face or fingerprint. You tell it about the trip you are planning; next week it still knows. You hand
> it a folder, a routine to run every morning, a repository to keep an eye on, and it gets on with them, asking
> before it does anything you have not allowed. Everything it knows lives in your account. If you stop, it stops,
> and what it knew is yours to keep or delete.

## Promises

- **Yours to run, not ours to host.** fletch is free software you deploy to your own account. There is no fletch
  service in the middle: your conversations, memory, files and keys never pass through anyone else but the model
  provider your config names, which sees each chat.
- **Set up in minutes, on the free plan.** One command, run from a checkout of this repository, takes you from an
  account to a working agent, with no domain and no paid plan; anything that needs more is a visible second step,
  never a surprise. A packaged setup that needs no checkout is the platform's later work.
- **It remembers, and you can see what.** What it learns about you is written down where you can read, correct and
  forget it.
- **It asks before it acts.** It works only with what you gave it; anything new waits for your yes, and a yes can
  be taken back.
- **It tells you what it cannot do.** When something is not available on your setup, it says so by name; it never
  pretends a failure was a success.
- **Only you get in.** A passkey signs you in, a recovery code you keep gets you back, and nobody who finds the
  address can take it over.
- **Built on a spine anyone can build on.** The kernel fletch stands on is published on its own and proven in
  fletch first, so a different agent, including one someone hosts for other people, can be built on it without
  taking fletch along.

## What it is not

fletch itself is one agent for one person, on that person's account: not a hosted service and not a tool for teams.
The spine beneath it makes no such promise; it is built so that a hosted or many-person agent can stand on it later
without fletch changing shape. Not a model: it thinks with the models on your own account, and you choose them. Not
a walled garden: leave whenever you like, and take everything with you.

## How it grows

First the spine, proven in fletch against the most complete personal agent we can measure: each kernel capability
arrives when one person can run it on their own account and the tests say it holds, and is plainly refused until
then. Then each thing a personal agent should do (mail, browsing, documents, working beside other people's agents),
picked one at a time and held to the same bar.
