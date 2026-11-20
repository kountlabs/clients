// Kount build constants (plan Config / Environment / Deployment Impact). A release package carries exactly these
// production addresses; `build.sh --proofs` rewrites this one file in the applied tree to loopback addresses, and the
// artefact checker reads both values back out of every package. Nothing reads them from anywhere at run time.
export const KOUNT_VAULT_BASE = "https://vault.kount.com.au";
export const KOUNT_PROTECT_ORIGIN = "https://protect.kount.com.au";
// The SSO identifier the sign-in screen sends in a Kount environment instead of an e-mail (sign-in-lock-and-look
// Decision 1; T1.1 proved the Kount vault takes it). The same in a proofs build: `build.sh --proofs` leaves it as it is.
export const KOUNT_SSO_IDENTIFIER = "kount";
