// Deletes every `fletch-ci-` Worker, `<name>-agent` bucket and `<name>-memory` index in the throwaway account. A cancelled,
// crashed or timed-out live run skips its own cleanup, so the live workflow runs this last, always.
//
//   CF_LIVE_ACCOUNT_ID=... CF_LIVE_TOKEN=... node scripts/live-sweep.ts
//
// It never touches a name outside `fletch-ci-` (test/live/lib.ts, checked again before each DELETE). A bucket that
// still holds objects cannot be deleted through the API and is reported by name; exit 1 then, so the run shows it.
import { CloudflareApi } from "@qyvr/host-cloudflare";
import { sweep } from "../test/live/sweep.ts";

const accountId = process.env.CF_LIVE_ACCOUNT_ID ?? "";
const token = process.env.CF_LIVE_TOKEN ?? "";
if (!/^[0-9a-f]{32}$/.test(accountId) || !token) {
  console.error("live-sweep: set CF_LIVE_ACCOUNT_ID (32 hexadecimal characters) and CF_LIVE_TOKEN");
  process.exit(2);
}
const out = await sweep(new CloudflareApi(token), accountId, console.log, (t) => t.replaceAll(token, "[token]"));
if (out.leaked.length) {
  console.error(`live-sweep: left behind, delete by hand:\n${out.leaked.join("\n")}`);
  process.exit(1);
}
