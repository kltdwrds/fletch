// Credential shapes shared by the secret scan and the binding audit. Each has a stable name that
// findings report instead of the matched text: a scan never prints the secret it found.
export const SECRET_PATTERNS: readonly { name: string; re: RegExp }[] = [
  { name: "pem-private-key", re: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/ },
  { name: "anthropic-key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: "openai-style-key", re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/ },
  { name: "aws-access-key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: "github-token", re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/ },
  { name: "slack-token", re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/ },
  { name: "google-api-key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: "google-oauth-secret", re: /\bGOCSPX-[A-Za-z0-9_-]{20,}/ },
  { name: "stripe-key", re: /\b[rs]k_(?:live|test)_[A-Za-z0-9]{20,}/ },
  { name: "bearer-token", re: /\b[Bb]earer\s+[A-Za-z0-9._~+/-]{24,}=*/ },
];

/** Variable names whose values are credentials (acceptance-checks.md step 5). */
export const CREDENTIAL_NAME = /(?:TOKEN|SECRET|KEY|PASSWORD)$/;

export function matchSecret(text: string): string | null {
  for (const p of SECRET_PATTERNS) if (p.re.test(text)) return p.name;
  return null;
}
