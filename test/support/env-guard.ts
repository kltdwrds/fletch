// The hermetic lane's credential guard (testing-and-evals.md section 3): the environment a hermetic
// test runs in carries no credential and no account. hermetic.setup.ts refuses to start a test file
// when one is present, naming the variable and never its value.
import { CREDENTIAL_NAME } from "../../scripts/lib/secret-patterns.ts";

/** Credential-named variables, plus the Cloudflare account variables the hermetic lane never has. */
export const CREDENTIAL_VARIABLE = new RegExp(`${CREDENTIAL_NAME.source}|^CLOUDFLARE_|^CF_`);

/** The names of credential variables present in `env`, sorted. */
export function credentialVariables(env: NodeJS.ProcessEnv): string[] {
  return Object.keys(env)
    .filter((name) => CREDENTIAL_VARIABLE.test(name) && env[name] !== undefined)
    .toSorted();
}

/** Throws `HERMETIC_CREDENTIAL_PRESENT` naming every credential variable in `env`. */
export function assertHermeticEnv(env: NodeJS.ProcessEnv): void {
  const names = credentialVariables(env);
  if (names.length) {
    throw new Error(`HERMETIC_CREDENTIAL_PRESENT: ${names.join(", ")}. The hermetic lane sees no credential; run it through \`pnpm accept\` or unset these.`);
  }
}
