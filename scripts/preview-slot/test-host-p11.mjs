// The P11 tier-2 tasks' world on a preview slot (F102): what ./test-host.mjs's `Chat` and `Person` add so a files grader
// reads a real slot with the real model. Deployed only to a slot, through ./app.mjs, and served only to the lease's
// holder (./ops.mjs, `/__preview/test-host`). Pure, so a hermetic test runs it.
//
// - The transcript. A chat's stored messages as the P11 world's entries (`test/evals/p11-files/world.ts`, `Entry`), in
//   order: Sam's message, a tool call with its arguments, a tool's result without the external-content fence, the
//   agent's words. A `send_to_user` call is the agent's words to the owner (the history draws it so, `chat/history.ts`),
//   never a send to anyone else, so it is an `agent` entry, and its own result is left out.
// - The seed. One `.docx` under `documents/p11-` written into the person's Library as the task's setup names it
//   (T-P11-17), since the slot has no Renderer (D-0030 proposed); nothing else can be written through the op.
// Everything else (the Library, the shares, the public path) the runner reads through the app's own routes.

/** The only paths the seed writes: a P11 probe document. */
export const P11_SEED_PATH = /^documents\/p11-[a-z0-9-]{1,40}\.docx$/;
/** The seed's byte cap. */
export const P11_SEED_MAX = 64 * 1024;
export const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const unfence = (t) => t.replace(/^\[BEGIN EXTERNAL CONTENT[^\]]*\]\n/, '').replace(/\n\[END EXTERNAL CONTENT[^\]]*\]$/, '');
const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.filter((x) => x?.type === 'text').map((x) => x.text ?? '').join('') : '');

/** A chat's stored messages as the P11 world's entries, oldest first. */
export function p11Entries(sql) {
  const out = [];
  const delivered = new Set();
  for (const r of sql.exec('SELECT body FROM messages ORDER BY seq').toArray()) {
    const m = JSON.parse(String(r.body));
    if (m.role === 'user') out.push({ role: 'user', text: textOf(m.content) });
    else if (m.role === 'toolResult') {
      if (m.toolName === 'send_to_user' && delivered.has(m.toolCallId)) continue;
      out.push({ role: 'tool', text: unfence(textOf(m.content)), tool: String(m.toolName ?? '') });
    } else if (m.role === 'assistant' && Array.isArray(m.content)) {
      for (const c of m.content) {
        if (c.type === 'text' && c.text) out.push({ role: 'agent', text: c.text });
        else if (c.type === 'toolCall' && c.name === 'send_to_user' && typeof c.arguments?.text === 'string') {
          delivered.add(c.id);
          out.push({ role: 'agent', text: c.arguments.text });
        } else if (c.type === 'toolCall') out.push({ role: 'call', text: JSON.stringify(c.arguments ?? {}), tool: String(c.name) });
      }
    }
  }
  return out;
}

/** The seed's input checked: a P11 probe path and base64 bytes under the cap, or the reason it is refused. */
export function p11Seed(input) {
  const path = String(input?.path ?? '');
  if (!P11_SEED_PATH.test(path)) return { ok: false, code: 'P11_SEED_PATH', reason: 'the seed writes documents/p11-*.docx only' };
  let bytes;
  try {
    bytes = Uint8Array.from(atob(String(input?.base64 ?? '')), (c) => c.charCodeAt(0));
  } catch {
    return { ok: false, code: 'P11_SEED_BYTES', reason: 'the bytes are not base64' };
  }
  if (!bytes.length || bytes.length > P11_SEED_MAX) return { ok: false, code: 'P11_SEED_BYTES', reason: `the bytes are 1 to ${P11_SEED_MAX}` };
  return { ok: true, path, bytes, mediaType: DOCX_TYPE };
}
