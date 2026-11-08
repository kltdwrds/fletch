---
"@qyvr/host-cloudflare": minor
---

`singleAccountHost` builds `render` from an optional `RENDERER` Durable Object namespace (the document renderer's container, which a `--paid` deploy binds) and refuses it with `HOST_RENDER_UNAVAILABLE` naming that binding where the deploy has none. What the object answers is checked first: a render that claims success without a document is `RENDER_OUTPUT_INVALID`. `containerRenderer`, `checkRender` and `checkMarkdown` are exported.
