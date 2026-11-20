#!/usr/bin/env bash
# build/build.sh — build the Kount extension from upstream at the locked commit plus the patch queue.
#
#   bash apps/kount-extension/build/build.sh                    apply.sh, then dist:chrome, dist:edge, dist:firefox —
#                                                                 the store build: production constants, no source maps,
#                                                                 the version of CHANGELOG.md's top entry, a source
#                                                                 archive of the applied tree and SHA256SUMS
#   bash apps/kount-extension/build/build.sh --proofs           the loopback build (the throwaway vault, the stand-in
#                                                                 for Protect's route), labelled …-proofs, maps kept
#   bash apps/kount-extension/build/build.sh --targets chrome   only the named targets (comma-separated)
#   bash apps/kount-extension/build/build.sh --test             also run the Kount spec files (upstream's jest)
#   bash apps/kount-extension/build/build.sh --no-apply         build the tree apply.sh left, without re-applying
#   bash apps/kount-extension/build/build.sh --label NAME       write to .build/out/NAME (default: release); names the
#                                                                 output only — it never selects what is built
#   bash apps/kount-extension/build/build.sh --baseline         upstream with NOTHING of the queue (apply.sh
#                                                                 --baseline's own tree, .build/baseline/clients),
#                                                                 written to .build/out/upstream — the spike's before;
#                                                                 always via apply.sh --baseline (never --no-apply)
#
# Everything upstream runs inside the digest-pinned Node 24 container (upstream's engines: node >=24.17.0, npm ~11);
# no Node toolchain from the host touches the fetched tree. The tree's .git is mounted READ-ONLY into the container:
# host git (apply.sh, tools/diff-patch.mjs) later reads that tree, and upstream's install scripts must not be able to
# plant a git setting (core.fsmonitor, a filter, a hook) that host git would then run. The open-source configuration only: the plain dist:*
# scripts, never a …:bit:… one (plan Decision 2). The container runs detached under the name kext-build and this
# script waits for it; if the caller's shell is cut short, re-attach with `docker wait kext-build` and read
# `docker logs kext-build` — the packages and BUILD_SUMMARY are already under .build/out/NAME/ when it exits.
# Host tools treat the fetched tree as data (git reads it, sed edits the build constants and the two manifests' version,
# tar archives it); the host's node runs repository code only (build/changelog.mjs). Then build/check-artefacts.sh holds
# the output to its rules.
set -euo pipefail
export LC_ALL=C

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/.." && pwd)"
work="$root/.build"
tree="$work/clients"

# node:24-bookworm, read 2026-11-11 (Node 24.22.2, npm 11.19.1). Bumped by hand at a rebase.
NODE_IMAGE=node:24-bookworm@sha256:8fa96264f302f58bbb13aa7339c541547b56975766ce956c875da149452a3e40
NAME=kext-build

targets="chrome edge firefox"
label=release
test=0
apply=1
proofs=0
baseline=0
limits=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --targets) shift; targets="$(printf '%s' "${1:?--targets needs a value}" | tr ',' ' ')" ;;
    --label) shift; label="${1:?--label needs a value}" ;;
    --test) test=1 ;;
    --no-apply) apply=0 ;;
    --proofs) proofs=1 ;;
    --baseline) baseline=1 ;;
    # A GitHub-hosted private-repository runner's size (2 CPUs, 7 GB), to measure whether the build fits one.
    --hosted-sim) limits=(--cpus 2 --memory 7g --memory-swap 7g) ;;
    *) echo "BUILD_FAIL reason=usage arg=$1" >&2; exit 2 ;;
  esac
  shift
done
case "$label" in *[!A-Za-z0-9._-]*|'') echo "BUILD_FAIL reason=label" >&2; exit 2 ;; esac
[ -n "${targets// /}" ] || { echo "BUILD_FAIL reason=no-targets" >&2; exit 2; }
for t in $targets; do case "$t" in chrome|edge|firefox) ;; *) echo "BUILD_FAIL reason=target $t" >&2; exit 2 ;; esac; done

if [ "$baseline" = 1 ]; then
  # The before: a tree of its own that holds none of the queue, and an output that says so. Never with the proofs
  # constants (the baseline has no Kount file to point at loopback) and never under another label.
  [ "$proofs" = 0 ] || { echo "BUILD_FAIL reason=usage (--baseline builds upstream as it is: no --proofs)" >&2; exit 2; }
  [ "$test" = 0 ] || { echo "BUILD_FAIL reason=usage (--baseline has no Kount spec to run: no --test)" >&2; exit 2; }
  [ "$label" = release ] || [ "$label" = upstream ] || { echo "BUILD_FAIL reason=usage (--baseline writes .build/out/upstream)" >&2; exit 2; }
  # Never a reused tree: only apply.sh --baseline proves the tag names the locked commit and checks the tree out at it;
  # a clean tree alone proves nothing about which commit it holds (review round 7 PR-MED-009).
  [ "$apply" = 1 ] || { echo "BUILD_FAIL reason=usage (--baseline always re-proves the lock: no --no-apply)" >&2; exit 2; }
  label=upstream
  tree="$work/baseline/clients"
  bash "$here/apply.sh" --baseline
  # Pristine: no tracked file changed and no untracked file outside upstream's own ignore rules (an overlay file, a
  # patch, an icon would each show here). Host git, with no hook or file-system monitor (see apply.sh's safegit).
  dirty="$(git -c core.fsmonitor=false -c core.hooksPath=/dev/null -C "$tree" status --porcelain)"
  [ -z "$dirty" ] || { echo "BUILD_FAIL reason=baseline-not-pristine" >&2; printf '  %s\n' "$dirty" | head -n 5 >&2; exit 1; }
else
  [ "$label" != upstream ] || { echo "BUILD_FAIL reason=usage (the label upstream belongs to --baseline)" >&2; exit 2; }
  # A store build always re-applies: its source archive and packages must be the tree apply.sh has just reset and cleaned,
  # never one an earlier run left behind (review round 9). --no-apply is for a quick proofs rebuild only.
  [ "$apply" = 1 ] || [ "$proofs" = 1 ] || { echo "BUILD_FAIL reason=usage (a store build always re-applies: --no-apply needs --proofs)" >&2; exit 2; }
  if [ "$apply" = 1 ]; then bash "$here/apply.sh"; fi
fi
[ -f "$tree/package.json" ] || { echo "BUILD_FAIL reason=no-tree (run apply.sh)" >&2; exit 1; }
# The lock's tag and commit, for NOTICE.txt (read as text, never sourced; apply.sh has just proved the tree is at them).
upstream_tag="$(sed -n 's/^UPSTREAM_TAG=\([A-Za-z0-9._-]*\)$/\1/p' "$root/upstream.lock")"
upstream_commit="$(sed -n 's/^UPSTREAM_COMMIT=\([0-9a-f]\{40\}\)$/\1/p' "$root/upstream.lock")"
[ -n "$upstream_tag" ] && [ -n "$upstream_commit" ] || { echo "BUILD_FAIL reason=lock (no UPSTREAM_TAG or UPSTREAM_COMMIT line)" >&2; exit 1; }

# The build constants (overlay/apps/browser/src/kount/build-constants.ts). A proofs build points them at loopback — the
# throwaway vault and the stand-in for Protect's launch route — and its output is labelled …-proofs (plan E21).
constants="$tree/apps/browser/src/kount/build-constants.ts"
if [ "$proofs" = 1 ]; then
  [ -f "$constants" ] || { echo "BUILD_FAIL reason=no-build-constants" >&2; exit 1; }
  case "$label" in *-proofs) ;; *) label="$label-proofs" ;; esac
  sed -i \
    -e 's#^export const KOUNT_VAULT_BASE = .*#export const KOUNT_VAULT_BASE = "https://127.0.0.1:8100";#' \
    -e 's#^export const KOUNT_PROTECT_ORIGIN = .*#export const KOUNT_PROTECT_ORIGIN = "http://127.0.0.1:8180";#' \
    "$constants"
  grep -q '"https://127.0.0.1:8100"' "$constants" && grep -q '"http://127.0.0.1:8180"' "$constants" ||
    { echo "BUILD_FAIL reason=proofs-constants" >&2; exit 1; }
elif [ -f "$constants" ] && ! grep -q '"https://vault.kount.com.au"' "$constants"; then
  echo "BUILD_FAIL reason=release-constants (the tree holds a proofs build's constants: run apply.sh)" >&2
  exit 1
fi

# The version (plan Decision 4): CHANGELOG.md's top entry, read by its one reader, stamped into both manifests in place of
# upstream's three-part version. The SOURCE's version (the lock's tag — older than the store version in a rollback build,
# review round 13 PR-MED-010) is what upstream's manifests carry; the reader returns both. The baseline keeps upstream's.
# A manifest whose version is neither (upstream changed the file's shape) is refused, never guessed at.
version=upstream
entry_label=upstream
notices=0
if [ "$baseline" = 0 ]; then
  top="$(node "$here/changelog.mjs" "$root/CHANGELOG.md" "$root/upstream.lock")" || { echo "BUILD_FAIL reason=changelog $top" >&2; exit 1; }
  notices=1
  entry_label="${top#* label=}"
  entry_label="${entry_label%% *}"
  version="${top#* version=}"
  version="${version%% *}"
  upstream_version="${top#* source_version=}"
  upstream_version="${upstream_version%% *}"
  case "$version$upstream_version" in *[!0123456789.]*|'') echo "BUILD_FAIL reason=changelog (unreadable: $top)" >&2; exit 1 ;; esac
  case "$entry_label" in *[!A-Za-z0-9.+_-]*|'') echo "BUILD_FAIL reason=changelog (unreadable label: $top)" >&2; exit 1 ;; esac
  for manifest in "$tree/apps/browser/src/manifest.json" "$tree/apps/browser/src/manifest.v3.json"; do
    have="$(grep -c '^  "version": "' "$manifest" || true)"
    [ "$have" = 1 ] || { echo "BUILD_FAIL reason=manifest-version ${manifest#"$tree/"} has $have version lines" >&2; exit 1; }
    if grep -q "^  \"version\": \"$upstream_version\",\$" "$manifest"; then
      sed -i "s/^  \"version\": \"$upstream_version\",\$/  \"version\": \"$version\",/" "$manifest"
    fi
    grep -q "^  \"version\": \"$version\",\$" "$manifest" ||
      { echo "BUILD_FAIL reason=manifest-version ${manifest#"$tree/"} is not upstream's $upstream_version nor $version" >&2; exit 1; }
  done
  echo "VERSION $top"
fi

if docker container inspect "$NAME" > /dev/null 2>&1; then
  echo "BUILD_FAIL reason=busy (a container named $NAME exists: docker wait / docker rm it first)" >&2
  exit 1
fi

out="$work/out/$label"
rm -rf "$out"
mkdir -p "$out" "$work/npm-cache"

start=$(date +%s)
# The source archive (plan T1.5; GPL's corresponding source, and what addons.mozilla.org's reviewers rebuild from): the
# applied tree exactly as built — upstream at the lock with the queue, the constants and the version — without .git and
# node_modules, written reproducibly BEFORE the container touches the tree — names sorted, one time, owner 0, and modes
# fixed (a checkout's umask differs between machines). A store build has just been reset and cleaned by apply.sh; a
# --no-apply proofs build archives what it builds (and the checker refuses any file in it that is neither upstream's nor
# the queue's). Beside the tree (plan T3.9; GPL-3.0 § 1's "scripts to control" the build): ./kount-build, the kit that
# made it — the lock, the changelog, the patches, the overlay, the pictures and build/ (the scripts, the notice
# template) — ./KOUNT-BUILDING.md, the steps, and ./KOUNT-UPSTREAM-TREE.txt, upstream's own tree at the lock (below).
# apply.sh has removed bitwarden_license/.
if [ "$baseline" = 0 ]; then
  [ ! -e "$tree/bitwarden_license" ] || { echo "BUILD_FAIL reason=commercial-dir (bitwarden_license/ is in the tree: run apply.sh)" >&2; exit 1; }
  kit="$work/kit"
  rm -rf "$kit"
  mkdir -p "$kit/kount-build"
  kit_paths=(upstream.lock CHANGELOG.md patches overlay assets build)
  if git -C "$root" rev-parse --is-inside-work-tree > /dev/null 2>&1; then
    # In a checkout: the files git tracks or would track — never one an ignore rule hides (a local cache, a scratch file).
    while IFS= read -r -d '' f; do
      [ -e "$root/$f" ] || continue
      mkdir -p "$kit/kount-build/$(dirname "$f")"
      cp -a "$root/$f" "$kit/kount-build/$f"
    done < <(git -c core.fsmonitor=false -C "$root" ls-files -z --cached --others --exclude-standard -- "${kit_paths[@]}")
  else
    # The kit on its own (KOUNT-BUILDING.md's "From upstream"): what is there.
    for p in "${kit_paths[@]}"; do cp -a "$root/$p" "$kit/kount-build/"; done
  fi
  cp -a "$here/notice/KOUNT-BUILDING.md" "$kit/KOUNT-BUILDING.md"
  # ./KOUNT-UPSTREAM-TREE.txt (review round 48 PR-MED-042): upstream's own commit object at the lock and its whole tree,
  # read by host git from the upstream cache (apply.sh's; never mounted into a container), so the checker can hold the
  # archive's upstream part to upstream's tree file by file. The checker proves the record itself: the commit object
  # must hash to the lock's commit and the listing must rebuild that commit's tree.
  cache="$work/upstream.git"
  commit_object="$(git -c core.fsmonitor=false -c core.hooksPath=/dev/null -C "$cache" cat-file commit "$upstream_commit" | base64 -w0)" ||
    { echo "BUILD_FAIL reason=upstream-record (no commit $upstream_commit in $cache: run apply.sh)" >&2; exit 1; }
  {
    echo "# KOUNT-UPSTREAM-TREE.txt — upstream's commit object at $upstream_tag ($upstream_commit), base64, and its tree"
    echo "# (git ls-tree -r --full-tree). build/check-artefacts.sh holds the archive's upstream files to it."
    printf 'commit %s\n' "$commit_object"
    git -c core.fsmonitor=false -c core.hooksPath=/dev/null -C "$cache" ls-tree -r --full-tree "$upstream_commit"
  } > "$kit/KOUNT-UPSTREAM-TREE.txt" || { echo "BUILD_FAIL reason=upstream-record (ls-tree)" >&2; exit 1; }
  tar --exclude=./.git --exclude=node_modules --exclude=./apps/browser/build --exclude=./apps/browser/dist \
    --sort=name --mtime='2026-01-01 00:00Z' --mode='u+rwX,go+rX,go-w' \
    --owner=0 --group=0 --numeric-owner --format=gnu -cf - -C "$tree" . -C "$kit" ./KOUNT-BUILDING.md ./KOUNT-UPSTREAM-TREE.txt ./kount-build |
    gzip -n > "$out/kount-protect-source.tar.gz"
  rm -rf "$kit"
fi
maps=0
[ "$proofs" = 0 ] || maps=1
docker run -d --name "$NAME" ${limits[@]+"${limits[@]}"} \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp/home -e npm_config_cache=/npm-cache \
  -e HUSKY=0 -e CI=true \
  -e ELECTRON_SKIP_BINARY_DOWNLOAD=1 -e PUPPETEER_SKIP_DOWNLOAD=1 -e PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 -e CYPRESS_INSTALL_BINARY=0 \
  -e KEXT_TARGETS="$targets" -e KEXT_TEST="$test" -e KEXT_MAPS="$maps" -e KEXT_NOTICES="$notices" \
  -e KEXT_LABEL="$entry_label" -e KEXT_VERSION="$version" -e KEXT_UPSTREAM_TAG="$upstream_tag" -e KEXT_UPSTREAM_COMMIT="$upstream_commit" \
  -v "$work/npm-cache":/npm-cache \
  -v "$tree":/src \
  -v "$tree/.git":/src/.git:ro \
  -v "$out":/out \
  -v "$here":/kext:ro \
  "$NODE_IMAGE" bash /kext/in-container.sh > /dev/null

code="$(docker wait "$NAME")"
docker logs --tail 40 "$NAME" 2>&1 || true
docker rm "$NAME" > /dev/null
[ "$code" = 0 ] || { echo "BUILD_FAIL reason=container exit=$code" >&2; exit 1; }
# SHA256SUMS: every package, the source archive and the SDK record — what the build lane keeps and the publish lane
# re-checks (check-artefacts.sh verifies it first).
if [ "$baseline" = 0 ]; then
  ( cd "$out" && sha256sum -- kount-protect-*.zip kount-protect-source.tar.gz sdk-hashes.txt > SHA256SUMS ) ||
    { echo "BUILD_FAIL reason=sha256sums" >&2; exit 1; }
fi
echo "BUILD_OK label=$label version=$version targets=\"$targets\" seconds=$(( $(date +%s) - start )) out=$out"
