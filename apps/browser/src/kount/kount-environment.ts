// A Kount environment (plan Decision 1, Critical Constraint 4): one whose EFFECTIVE web-vault, API and identity
// addresses are all the Kount vault's. Upstream lets a managed configuration set the three separately, and an explicit
// address wins over the base (default-environment.service.ts `getUrl`), so the base alone proves nothing: each of the
// three is read through the environment's own getters and compared whole. The ONE home of this test — the sign-in
// screen (patch 0005) and the page marker (protect-marker.background.ts) both call it, so neither restates the rule.
import { KOUNT_VAULT_BASE } from "./build-constants";

/** The three getters the test reads — upstream's `Environment` has them. */
export type EnvironmentAddresses = {
  getWebVaultUrl(): string;
  getApiUrl(): string;
  getIdentityUrl(): string;
};

/**
 * One address as an endpoint: its scheme, host, effective port and path (trailing slashes trimmed) — or null when it is
 * not a plain http(s) address. `URL` lowercases the host and drops a scheme's default port, so `https://VAULT…:443/api`
 * and `https://vault…/api` are the same endpoint (an explicit managed address is stored as written — upstream's
 * `formatUrl` only trims slashes; round 13 PR-MED-068). Credentials, a query or a fragment make it no endpoint at all.
 */
function endpoint(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return null;
  }
  if ((u.protocol !== "https:" && u.protocol !== "http:") || u.username !== "" || u.password !== "") {
    return null;
  }
  if (u.search !== "" || u.hash !== "" || /[?#]/.test(value)) {
    return null;
  }
  return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}`;
}

/** True only when all three effective addresses are the Kount vault's; anything unreadable is not Kount. */
export function isKountEnvironment(env: EnvironmentAddresses | null | undefined): boolean {
  if (env == null) {
    return false;
  }
  try {
    const base = endpoint(KOUNT_VAULT_BASE);
    return (
      base !== null &&
      endpoint(env.getWebVaultUrl()) === base &&
      endpoint(env.getApiUrl()) === `${base}/api` &&
      endpoint(env.getIdentityUrl()) === `${base}/identity`
    );
  } catch {
    return false;
  }
}
