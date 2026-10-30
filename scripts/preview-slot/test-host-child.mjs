// A sub-agent's reads on a preview slot (F32, ./test-host-p5.mjs): the probe page's `browse_open` over the test host's
// browser, offered eager (a child has no `tool_search`), with the addresses its brief carries in its url table, as the
// tier-1 world's child reads (`test/evals/p5-activity/harness.ts`). Apart from ./test-host.mjs so a hermetic test runs
// it without the Worker's objects.
import { bindingPort } from '../../packages/agent/src/browse/binding.ts';
import { chatBrowse } from '../../packages/agent/src/browse/hook.ts';
import { UrlTable } from '../../packages/agent/src/browse/urls.ts';
import { addressesIn, runMemory } from './test-host-p5.mjs';

/** The `browse` namespace a child of `person` reads with on a slot, over `binding`, holding the addresses in `brief`. */
export function childBrowse(person, brief, binding, now = () => Date.now()) {
  const cell = (v = null) => ({
    get: () => v,
    set: (x) => {
      v = x;
    },
  });
  const urls = cell();
  new UrlTable(urls).add(addressesIn(brief));
  const memory = runMemory();
  const browse = chatBrowse({ port: bindingPort(binding), memory: () => memory }, person, { urls, session: cell() }, now);
  return { ...browse, deferral: 'eager', tools: browse.tools.filter((t) => t.name === 'browse_open') };
}
