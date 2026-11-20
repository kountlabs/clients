// The ONE reader of CHANGELOG.md's top entry (plan Decision 4) — build.sh and check-artefacts.mjs both use it.
//
//   node apps/kount-extension/build/changelog.mjs [<CHANGELOG.md> [<upstream.lock>]]
//     prints `CHANGELOG_TOP label=<tag>+kount.<n> version=<four-part> status=<candidate|release>
//             source=<the lock's tag> source_version=<its three numbers>` or `CHANGELOG_FAIL reason=<why>` (exit 1)
//
// The top entry is the first line that starts with `## `. It reads exactly one of:
//
//   ## <the lock's UPSTREAM_TAG>+kount.<n> — candidate                     (or `— release`) — an ordinary build
//   ## <a newer tag>+kount.<n> — release, rollback to <the lock's UPSTREAM_TAG>   (or `— candidate, rollback to …`)
//
// with n a whole number from 1. The store version is the HEADING's tag's three numbers and n (`browser-v2026.10.2` and
// n 1 → `2026.10.2.1`; the stores take one to four dot-separated integers of 0–65535 and refuse a lower one). The SOURCE
// is always the lock: an ordinary entry names the lock's tag; a rollback build (Decision 4: an older lock rebuilt under the
// next number of the release it replaces) names the release it replaces and, after `rollback to`, the lock's own older
// tag — which must be strictly older than the heading's, else it is no rollback. `source_version` is what upstream's
// manifests carry before build.sh stamps the store version (review round 13 PR-MED-010). A missing, malformed or
// other-tag entry is refused: a build never guesses its version or its source.
//
// The history (review round 14 PR-MED-012): every EARLIER `## ` heading must also be an entry, and the top entry's store
// version must be strictly above every earlier `release` entry's, compared as four numbers — every store refuses an equal
// or lower version, so a reused or mistyped number is refused here, offline, not at the store. Earlier `candidate` entries
// were never released and do not count; earlier entries' sources are history and are not compared with today's lock;
// the top entry is never compared with itself, so rebuilding it is unaffected.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TAG = "browser-v(\\d+)\\.(\\d+)\\.(\\d+)";
const HEADING = new RegExp(`^## (${TAG})\\+kount\\.([1-9]\\d*) — (candidate|release)(?:, rollback to (${TAG}))?$`);

/** The lock's UPSTREAM_TAG (one line, read as text — the lock is never sourced). */
export function lockTag(lockText) {
  const tags = lockText.split("\n").filter((l) => l.startsWith("UPSTREAM_TAG="));
  if (tags.length !== 1) throw new Error("lock-tag (exactly one UPSTREAM_TAG line)");
  return tags[0].slice("UPSTREAM_TAG=".length);
}

/** < 0 when the version x is below y, part by part (three-part tags or four-part store versions alike). */
const older = (x, y) => {
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
};

/**
 * { label, version, status, tag, n, source, sourceVersion, rollback } of the top entry, or throws Error(reason). `tag`
 * and `version` are the store's; `source` (always the lock's tag) and `sourceVersion` are what is built.
 */
export function topEntry(changelogText, tag) {
  const headings = changelogText.split("\n").filter((l) => l.startsWith("## ")).map((l) => l.replace(/\r$/, ""));
  const top = headings[0];
  if (top === undefined) throw new Error("no-entry (no `## ` heading: a build needs its version entry)");
  const m = HEADING.exec(top.replace(/\r$/, ""));
  if (!m) {
    throw new Error(`malformed-entry (${JSON.stringify(top.slice(0, 80))}: want "## <tag>+kount.<n> — candidate|release[, rollback to <lock tag>]")`);
  }
  const [, entryTag, a, b, c, n, status, rollbackTag, ra, rb, rc] = m;
  const store = [a, b, c].map(Number);
  if (rollbackTag === undefined) {
    if (entryTag !== tag) throw new Error(`entry-tag (the top entry is for ${entryTag}, the lock says ${tag})`);
  } else {
    if (rollbackTag !== tag) throw new Error(`rollback-source (the entry rolls back to ${rollbackTag}, the lock says ${tag})`);
    if (older([ra, rb, rc].map(Number), store) >= 0) {
      throw new Error(`rollback-not-older (${rollbackTag} is not older than ${entryTag}: an ordinary entry names the lock's tag)`);
    }
  }
  const parts = [...store, Number(n)];
  if (parts.some((p) => !Number.isSafeInteger(p) || p > 65535)) throw new Error("entry-version (each part 0–65535)");
  // The history: the top entry's store version above every earlier released one.
  for (const earlier of headings.slice(1)) {
    const h = HEADING.exec(earlier);
    if (!h) throw new Error(`history-malformed (${JSON.stringify(earlier.slice(0, 80))} is not an entry heading)`);
    if (h[6] !== "release") continue;
    const released = [h[2], h[3], h[4], h[5]].map(Number);
    if (older(parts, released) <= 0) {
      throw new Error(`entry-not-newer (${parts.join(".")} is not above the released ${released.join(".")}: every store refuses an equal or lower version)`);
    }
  }
  const source = rollbackTag ?? entryTag;
  return {
    label: `${entryTag}+kount.${n}`,
    version: parts.join("."),
    status,
    tag: entryTag,
    n: Number(n),
    source,
    sourceVersion: source.slice("browser-v".length),
    rollback: rollbackTag !== undefined,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = join(dirname(fileURLToPath(import.meta.url)), "..");
  const [changelog = join(app, "CHANGELOG.md"), lock = join(app, "upstream.lock")] = process.argv.slice(2);
  try {
    const e = topEntry(readFileSync(changelog, "utf8"), lockTag(readFileSync(lock, "utf8")));
    console.log(`CHANGELOG_TOP label=${e.label} version=${e.version} status=${e.status} source=${e.source} source_version=${e.sourceVersion}`);
  } catch (err) {
    console.log(`CHANGELOG_FAIL reason=${err.message}`);
    process.exit(1);
  }
}
