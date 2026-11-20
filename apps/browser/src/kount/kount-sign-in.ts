// The Kount sign-in's two re-checks (sign-in-lock-and-look Decision 1, E47, E54), as pure rules the patched upstream
// code calls (patch 0005: the extension's hand-off in `extension-login-component.service.ts`, the return in
// `sso.component.ts`) and the spec holds. A Kount start is the one the Kount screen makes: the fixed identifier with no
// e-mail — upstream's own single sign-on always carries an e-mail, so it is never a Kount start and is never refused.
import { KOUNT_SSO_IDENTIFIER } from "./build-constants";
import { EnvironmentAddresses, isKountEnvironment } from "./kount-environment";

/** The sign-in was started by the Kount screen: the fixed identifier, no e-mail. */
export function isKountStart(orgSsoIdentifier: string | null | undefined, email: string | null | undefined): boolean {
  return orgSsoIdentifier === KOUNT_SSO_IDENTIFIER && (email == null || email === "");
}

/**
 * The hand-off (E47): upstream reads the environment again to build the address it opens — an active account's wins
 * over the selection the button saw. A Kount start opens nothing outside a Kount environment.
 */
export function kountHandOffRefused(
  orgSsoIdentifier: string | null | undefined,
  email: string | null | undefined,
  inForce: EnvironmentAddresses | null | undefined,
): boolean {
  return isKountStart(orgSsoIdentifier, email) && !isKountEnvironment(inForce);
}

/**
 * The return (E54): before the code is redeemed, the selected environment and the one in force (which the token request
 * reads afresh) must both still be Kount environments; otherwise neither the code nor the verifier is sent anywhere.
 * The return of a Kount start is recognised by what the extension itself saved at the start — an empty SSO e-mail
 * (upstream saves the e-mail on every start of its own) — never by the state the vault hands back, whose identifier
 * suffix the vault's round trip need not carry (review round 7 MED-001). An e-mail that cannot be read counts as empty,
 * so the doubt refuses rather than redeems.
 */
export function kountReturnRefused(
  savedEmail: string | null | undefined,
  selected: EnvironmentAddresses | null | undefined,
  inForce: EnvironmentAddresses | null | undefined,
): boolean {
  return isKountReturn(savedEmail) && !(isKountEnvironment(selected) && isKountEnvironment(inForce));
}

/**
 * The return is a Kount start's: the e-mail the extension saved at the start is empty (or cannot be read). Decided
 * before any environment is read, so an ordinary return waits on nothing of Kount's (round 14 PR-LOW-020).
 */
export function isKountReturn(savedEmail: string | null | undefined): boolean {
  return savedEmail == null || savedEmail === "";
}
