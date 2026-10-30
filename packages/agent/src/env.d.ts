// What a deploy's Env holds beyond `wrangler.jsonc` (worker-configuration.d.ts is generated from it):
// the master key, a Worker secret `pnpm self-host` sets and config never holds, and the two paid-plan
// bindings a deploy may add. Each is optional so a config without it still types; the agent refuses
// the feature it backs with a code (`code/egress.ts`, `attachments/wiring.ts`, `@qyvr/host-cloudflare`'s keys).
interface Env {
  /** 32 random bytes, base64url: wraps the tenant's data key (`hostOf(env).keys`). */
  MASTER_KEY?: string;
  /** The token in the `/login?setup=` link that creates the first passkey: a Worker secret, never config. */
  SETUP_TOKEN?: string;
  /** Code Mode's Worker Loader (M25.5). */
  LOADER?: WorkerLoader;
  /** Cloudflare Images (M24.4): HEIC to JPEG. */
  IMAGES?: ImagesBinding;
  /** An AI Gateway id: every model call goes through it. Unset on a self-host deploy, so no gateway option is sent (`model/routes.ts`). */
  AI_GATEWAY_ID?: string;
  /** `workers-ai` (the default) or `meta`, which puts the chat route on Muse Spark through `AI_GATEWAY_ID`'s stored BYOK key; any other value, or `meta` without a gateway, fails every model call with `MODEL_CONFIG_INVALID` (`model/routes.ts`). */
  CHAT_PROVIDER?: string;
}
