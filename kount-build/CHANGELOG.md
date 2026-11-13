# Changelog — the Kount Protect browser extension

Each build takes the next `+kount.<n>` of its upstream tag (plan Decision 4): the label `<upstream tag>+kount.<n>`, the
manifest `version` `<upstream version>.<n>` (`browser-v2026.10.2+kount.1` → `2026.10.2.1`), the public fork's branch
`kount/<upstream tag>` and tag `<upstream tag>+kount.<n>`. A rebase on a new upstream tag starts again at `+kount.1`; a
rollback build (an older lock rebuilt) takes the next number of the release it replaces, because every store refuses a
lower version.

The TOP entry is what is built. Its heading reads exactly `## <upstream tag>+kount.<n> — candidate` or `— release`,
where `<upstream tag>` is `upstream.lock`'s (`build/changelog.mjs` is its one reader; `build/build.sh` stamps the version
into both manifests from it, and `build/check-artefacts.sh` holds every package to it). A **rollback build** names the
release it replaces and the older lock it rebuilds:
`## <the replaced release's tag>+kount.<next n> — release, rollback to <upstream.lock's older tag>` — for example, with
`browser-v2026.11.0+kount.1` withdrawn and the lock moved back to `browser-v2026.10.2`,
`## browser-v2026.11.0+kount.2 — release, rollback to browser-v2026.10.2` builds the 2026.10.2 source as version
`2026.11.0.2`. The tag after `rollback to` must be the lock's and older than the heading's; its fork branch is
`kount/<that older tag>`, tagged with the heading's label. A `candidate` entry is never kept as a release artefact or uploaded:
`check-artefacts.sh --release` refuses it, and so will the build lane's `publish=true` and the publish lane. Only the
legal check's recorded outcome (plan T3.1) lets T3.6 turn the first candidate into a release. A missing or malformed
entry is refused by every build, and so is a top entry whose store version is not strictly above every earlier `release`
entry's (every store refuses an equal or lower version); earlier `candidate` entries do not count, and every `## `
heading below the top must be an entry.

## browser-v2026.10.2+kount.1 — release

The first Kount release entry (plan T3.6), built for the stores and not yet published (T4.2). Turned from `candidate`
into `release` on 2026-11-12, after the legal check's
outcome was recorded (plan T3.1; `docs/licence-facts.md` § Outcome of the legal check). Upstream `bitwarden/clients`
`browser-v2026.10.2` = `a540dcdb74db44fd90d20d721ef91a7225d5a34f`, still the newest stable browser release when T3.6
re-read the tags on 2026-11-12, so the lock did not move; manifest version `2026.10.2.1`. The patch queue — the README's
patch table:
- the brand: 0001–0003, 0009, 0010 and the icons. The About line is the approved attribution wording; Firefox's lowest
  version is 140.0; Chrome and Edge no longer request the side panel.
- the presets: 0004–0006.
- the pick hook: 0007, with the overlay's `apps/browser/src/kount/`.
- the launch cache patch: 0008.

The GPL-3.0 notices and the source archive (plan T3.9) ship with the packages.

Release record (T4.1, the operator): the build lane run, the three packages' sha256, the fork's tag — _(not yet)_.
