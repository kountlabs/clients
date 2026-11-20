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

## browser-v2026.11.0+kount.1 — release

The rebase on upstream `browser-v2026.11.0` = `28b247ac34877882aaef4faea082a9f3bb201114` (published 2026-11-19; README
§ The rebase, Flow 4; the upstream watch's issue #1984); manifest version `2026.11.0.1`.
The queue is the same eleven patches; nothing the Kount build does changed:
- re-cut, upstream moved lines only: 0001 (the two manifests' `version` line beside `short_name`), 0004 (a new upstream
  import beside the Kount one in `runtime.background.ts`), 0009 (upstream re-ordered the `<svg>` attributes of the
  importer's logo; the plain document keeps upstream's new attribute order).
- re-cut by the brand tool: 0002 (`build/tools/brand-messages.mjs`, then the two hand-set messages `extName` and
  `extDesc` as before) — upstream added two translator notes naming "Bitwarden Send" and merged the two "lock and unlock
  together" messages into one; each takes the product name by the tool's rule.
- unchanged, applying as they were: 0003, 0005–0008, 0010, 0011 (upstream changed `cipher.service.ts` and
  `tw-theme.css` outside the patched hunks).
- the name scan: upstream's "Save login" bar script (`notification/bar.js`, unminified) now carries eleven comments from
  the SDK's generated bindings that name Bitwarden; they are sorted into a new allowed class scoped to that file
  (`build/check-artefacts.mjs` `ALLOWED`, 14 classes) — comments nobody is shown.
- the licence texts at the new tag are byte-equal to the old tag's (`build/notice/licence-pins.tsv`, two rows added).

Turned from `candidate` into `release` on 2026-11-20, in the rebase's own pull request, after the checks ran green on
the candidate tree (README § The release recipe, step 1): the spec 158 / 158, the store and proofs builds' artefact
checks 0 problems, the browser proofs Chromium 25 / 25, Edge 25 / 25, Firefox 23 / 23 on the local Kount vault image.
Built for the stores and not yet published: the manual checklist's items 1–3, the build lane's `publish=true` run, the
source on the public fork and the submissions are still owed.

## browser-v2026.10.2+kount.2 — release

The second Kount build of upstream `browser-v2026.10.2` (`.cursor/plans/plan-platform-kount-protect-sign-in-lock-and-look.md`
Phase 1, release group PR-A); manifest version `2026.10.2.2`. The lock does not move (T1.0: no stable tag above it).
- the page marker (Decisions 5, 6): `content/kount-protect-marker.js`, registered by the background for Protect's
  host and run in Protect tabs already open — `data-kp-ext` on Protect's exact origin only (`v1`, then `signed-out`, `locked`
  or `unlocked`, and `quick-unlock`); 0003 (the bundle entry, its `tsconfig.build.json` line) and 0007 (the
  registration beside the pick hook) re-cut; the overlay's `kount-environment.ts` and `protect-marker*`. No manifest
  change, no new permission.
- the Kount look, B · Navy header (Decision 9): the new 0011.
- the sign-in (Decision 1; T1.2 chose (a) after the rehearsal `docs/sso-rehearsal-2026-11-18.md`): in a Kount
  environment "Sign in with Kount ID" with no e-mail box (the fixed identifier `kount`) and the link "Use e-mail and
  master password"; the hand-off and the return re-checked against the environment in force; any other server keeps
  upstream's screen. 0005 re-cut (four upstream files), 0002 re-cut (three added messages), the overlay's
  `kount-sign-in.ts`.

Turned from `candidate` into `release` on 2026-11-19, in release group PR-A's pull request (PR #1952), with T1.3–T1.7
green on the final tree (README § The release recipe, step 1). Its accepted residuals are in README § Accepted residuals.
Built for the stores and not yet published: T1.8 (the submissions) and T1.R (the release record) are the operator's.

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

Release record (T4.1, 2026-11-14, the composer on the operator's word): build lane run
[43509758714](https://github.com/kountlabs/kount-platform/actions/runs/43509758714) (`publish=true`, from `main`
`4b12cadb1b0c317b8bc2b63d4b980abc6edcd467`); the packages' sha256 — `kount-protect-chrome.zip`
`78d90a91505e5a1ea189dfda5dedb7a647af1bd142e0c972a538cd02117553ec`, `kount-protect-edge.zip`
`2811582066ee1de0c40099c5d39fc798032e9bfb5ea6d22f82311ea114b09b4f`, `kount-protect-firefox.zip`
`042fce4f763124f8dbe4565827215a68b6eda619ba7470eb70597ef4bd7e9f46` (the source archive
`323bcc822501f38b563a8acd806366d6eac90102517ee9083a865fc2b731fc52`); the source at
`https://github.com/kountlabs/clients/tree/browser-v2026.10.2+kount.1`, branch `kount/browser-v2026.10.2`, commit
`cea92fa4803b14c3deb4dfa3aa27010e6c946690` (one root commit equal to the source archive).
