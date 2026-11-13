#!/usr/bin/env bash
# build/apply.sh — lay the Kount patch queue on Bitwarden's browser extension at the locked commit.
#
#   bash apps/kount-extension/build/apply.sh           prepare .build/clients, the tree build.sh builds
#   bash apps/kount-extension/build/apply.sh --check   prove the queue applies, in a scratch tree only
#   bash apps/kount-extension/build/apply.sh --baseline   prepare .build/baseline/clients: upstream at the locked
#                                                         commit with NOTHING of the queue (the before of a spike)
#
# Every run first proves that the tag in upstream.lock still names the locked commit (a moved or mistyped tag, or a
# lock commit that differs by one character, fails and prints the commit the tag names), then refuses — before
# anything is copied or applied — what it cannot check: a path that is not plain, a path under bitwarden_license/
# (the open-source build only: plan Decision 2), a rename, copy or binary hunk, an overlay file that shadows an
# upstream file, and an asset that is not named in assets/MANIFEST, is not under apps/browser/src/images/, or
# replaces nothing upstream. Then it checks out upstream at that commit, removes bitwarden_license/ from the queue's
# tree (never from the baseline), copies overlay/ (NEW files only), applies
# patches/*.patch in name order with `git apply --check` before each apply, and copies assets/ (binary files that
# replace upstream's at the same path — icons only).
#
# The fetched tree is DATA: nothing in it is executed here. build.sh runs upstream's code only inside a container.
# Modelled on apps/vaultwarden-kount/build/apply.sh.
set -euo pipefail
# Every class, range and sort below reads bytes, whatever the caller's locale (plan T1.4).
export LC_ALL=C

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/.." && pwd)"
lock="$root/upstream.lock"
work="$root/.build"

mode=build
for arg in "$@"; do
  case "$arg" in
    --check) mode=check ;;
    --baseline) mode=baseline ;;
    *) echo "APPLY_FAIL reason=usage arg=$arg (only --check or --baseline is accepted)" >&2; exit 2 ;;
  esac
done

fail() { echo "APPLY_FAIL reason=$1" >&2; shift; for line in "$@"; do echo "  $line" >&2; done; exit 1; }

# lock_get KEY — the one value of KEY in upstream.lock; refuses a missing, repeated or odd value.
lock_get() {
  local key="$1" values
  values="$(sed -n "s/^${key}=//p" "$lock")"
  [ -n "$values" ] || fail "lock-missing key=$key"
  [ "$(printf '%s\n' "$values" | wc -l)" -eq 1 ] || fail "lock-repeated key=$key"
  case "$values" in
    *[!A-Za-z0-9._:/@+-]*) fail "lock-value key=$key (unexpected character)" ;;
  esac
  printf '%s' "$values"
}

UPSTREAM_REPO="$(lock_get UPSTREAM_REPO)"
UPSTREAM_TAG="$(lock_get UPSTREAM_TAG)"
UPSTREAM_COMMIT="$(lock_get UPSTREAM_COMMIT)"
case "$UPSTREAM_TAG" in browser-v*) ;; *) fail "lock-value key=UPSTREAM_TAG (a browser-v… release tag)" ;; esac
case "$UPSTREAM_COMMIT" in *[!0-9a-f]*|'') fail "lock-value key=UPSTREAM_COMMIT (40 hex characters)" ;; esac
[ "${#UPSTREAM_COMMIT}" -eq 40 ] || fail "lock-value key=UPSTREAM_COMMIT (40 hex characters)"
# An https URL or, for the guard test's local repositories, an absolute path — never something git could read as an
# option or another transport.
case "$UPSTREAM_REPO" in https://*|/*) ;; *) fail "lock-value key=UPSTREAM_REPO (https:// or an absolute path)" ;; esac

# Host git never runs a hook or a file-system monitor from a tree the build container has touched (build.sh mounts
# .git read-only; this is the second fence).
safegit() { git -c core.fsmonitor=false -c core.hooksPath=/dev/null "$@"; }

# The tag proof: the commit the tag names (the peeled ^{} line of an annotated tag, else the plain line).
out="$(git ls-remote -- "$UPSTREAM_REPO" "refs/tags/$UPSTREAM_TAG" "refs/tags/$UPSTREAM_TAG^{}")" || fail "ls-remote repo=$UPSTREAM_REPO"
peeled="$(printf '%s\n' "$out" | awk -v r="refs/tags/$UPSTREAM_TAG^{}" '$2 == r { print $1 }')"
plain="$(printf '%s\n' "$out" | awk -v r="refs/tags/$UPSTREAM_TAG" '$2 == r { print $1 }')"
actual="${peeled:-$plain}"
[ -n "$actual" ] || fail lock-mismatch "tag $UPSTREAM_TAG not found in $UPSTREAM_REPO"
[ "$actual" = "$UPSTREAM_COMMIT" ] || fail lock-mismatch "tag $UPSTREAM_TAG resolves to $actual, the lock says $UPSTREAM_COMMIT"
echo "LOCK_OK UPSTREAM tag=$UPSTREAM_TAG commit=$actual"

# ---- the refusals, before any checkout, copy or apply --------------------------------------------------------------
# Spelled out, never as ranges: `=~` compiles under the locale, where `[A-Za-z]` can match `é` under a UTF-8 locale.
PLAIN_PATH='^[ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._/-]+$'
guard_path() {
  local path="$1" where="$2"
  [[ "$path" =~ $PLAIN_PATH ]] ||
    fail "unsupported-path path=$(printf '%q' "$path") $where" "only plain paths ([A-Za-z0-9._/-]) are accepted"
  case "/$path/" in
    */../*|*/./*|*//*) fail "unsupported-path path=$path $where" "no . or .. segment, no empty segment" ;;
  esac
  case "$path" in
    bitwarden_license|bitwarden_license/*)
      fail "commercial-path path=$path $where" "nothing under bitwarden_license/ is ever built or copied (plan Decision 2)" ;;
  esac
}

shopt -s nullglob
patches=("$root"/patches/*.patch)
shopt -u nullglob

overlay_rel=()
if [ -d "$root/overlay" ]; then
  while IFS= read -r -d '' file; do
    rel="${file#"$root/overlay/"}"
    guard_path "$rel" "in=overlay"
    overlay_rel+=("$rel")
  done < <(find "$root/overlay" \( -type f -o -type l \) -print0 | LC_ALL=C sort -z)
  [ -z "$(find "$root/overlay" -type l -print -quit)" ] || fail "overlay-symlink" "the overlay holds plain files only"
fi

# assets/: binary replacements of upstream icons. Every file is named in assets/MANIFEST (one path per line, # comments)
# and every MANIFEST line names a file that is there; each path is under apps/browser/src/images/.
asset_rel=()
if [ -d "$root/assets" ]; then
  manifest="$root/assets/MANIFEST"
  [ -f "$manifest" ] || fail "asset-manifest-missing" "assets/ needs assets/MANIFEST naming every file"
  declare -A listed=()
  while IFS= read -r line; do
    case "$line" in ''|'#'*) continue ;; esac
    guard_path "$line" "in=assets/MANIFEST"
    case "$line" in apps/browser/src/images/*) ;; *) fail "asset-outside-images path=$line" "assets replace files under apps/browser/src/images/ only" ;; esac
    [ -f "$root/assets/$line" ] || fail "asset-listed-missing path=$line" "assets/MANIFEST names a file assets/ does not hold"
    listed["$line"]=1
  done < "$manifest"
  while IFS= read -r -d '' file; do
    rel="${file#"$root/assets/"}"
    [ "$rel" = MANIFEST ] && continue
    guard_path "$rel" "in=assets"
    [ -n "${listed[$rel]:-}" ] || fail "asset-unlisted path=$rel" "every file in assets/ is named in assets/MANIFEST"
    asset_rel+=("$rel")
  done < <(find "$root/assets" \( -type f -o -type l \) -print0 | LC_ALL=C sort -z)
  [ -z "$(find "$root/assets" -type l -print -quit)" ] || fail "asset-symlink" "assets/ holds plain files only"
fi

for patch in "${patches[@]}"; do
  name="$(basename "$patch")"
  # Every spelling Git reads as a rename or a copy: `rename from|to`, `copy from|to` and the legacy `rename old|new`.
  if grep -aEq '^(rename|copy) ' "$patch"; then
    fail "rename-hunk patch=$name" "a rename or copy hunk is refused: its source path cannot be checked"
  fi
  if grep -aEq '^GIT binary patch|^Binary files ' "$patch"; then
    fail "binary-hunk patch=$name" "a binary hunk is refused: binary replacements are assets/ files"
  fi
  # A mode change, or a new or deleted file of any mode but a plain 100644 file: a symlink (120000) could point a
  # plain path at bitwarden_license/ or outside the tree, and an executable bit is never needed.
  # (No `grep -q` at the end of a pipe: under pipefail its early exit makes a match read as a failure.)
  modes="$(grep -aE '^(new file mode|deleted file mode) ' "$patch" || true)"
  if grep -aEq '^(old mode|new mode) ' "$patch" || { [ -n "$modes" ] && grep -avq ' 100644$' <<< "$modes"; }; then
    fail "mode-hunk patch=$name" "only plain 100644 files: no symlink, no executable, no mode change"
  fi
done

# ---- the upstream tree -------------------------------------------------------------------------------------------
# One bare cache of the locked commit (bitwarden/clients is large); every tree is a shared clone of it.
cache="$work/upstream.git"
if ! git -C "$cache" cat-file -e "$UPSTREAM_COMMIT^{commit}" 2>/dev/null; then
  rm -rf "$cache"
  git init -q --bare "$cache"
  git -C "$cache" remote add origin "$UPSTREAM_REPO"
  git -C "$cache" fetch -q --depth 1 origin "$UPSTREAM_COMMIT"
  git -C "$cache" cat-file -e "$UPSTREAM_COMMIT^{commit}" || fail "fetch-commit commit=$UPSTREAM_COMMIT"
fi
# A ref, so a clone of the cache is not empty (one ref per locked commit; an older one does no harm).
git -C "$cache" update-ref "refs/heads/locked-$UPSTREAM_COMMIT" "$UPSTREAM_COMMIT"

# checkout DIR — DIR holds exactly the locked commit, clean. A build tree is reused (it keeps its node_modules; build.sh's
# npm ci is stamped by the lockfile's hash) only while its git metadata is exactly what this script made: the same
# .git/config as at the clone (its hash kept beside the tree), no info/attributes, no hook but git's samples. Anything
# else — a tree an older build mounted read-write — is removed and cloned again. Everything untracked is cleaned.
git_meta_ok() {
  local dir="$1" stamp="$2"
  [ -f "$stamp" ] && [ "$(sha256sum "$dir/.git/config" | cut -d' ' -f1)" = "$(cat "$stamp")" ] || return 1
  [ ! -e "$dir/.git/info/attributes" ] || return 1
  [ -z "$(find "$dir/.git/hooks" -type f ! -name '*.sample' -print -quit 2>/dev/null)" ] || return 1
}
checkout() {
  local dir="$1" stamp="$1.gitconfig.sha256"
  if [ -d "$dir/.git" ] && git_meta_ok "$dir" "$stamp" &&
    [ "$(safegit -C "$dir" rev-parse HEAD 2>/dev/null)" = "$UPSTREAM_COMMIT" ]; then
    safegit -C "$dir" reset -q --hard
    safegit -C "$dir" clean -qfdx -e node_modules
    return
  fi
  rm -rf "$dir" "$stamp"
  safegit clone -q --shared --no-checkout "$cache" "$dir"
  safegit -C "$dir" -c advice.detachedHead=false checkout -q --detach "$UPSTREAM_COMMIT"
  [ "$(safegit -C "$dir" rev-parse HEAD)" = "$UPSTREAM_COMMIT" ] || fail "checkout-commit dir=$dir"
  sha256sum "$dir/.git/config" | cut -d' ' -f1 > "$stamp"
}

case "$mode" in
  check) tree="$work/check/clients" ;;
  baseline) tree="$work/baseline/clients" ;;
  *) tree="$work/clients" ;;
esac
mkdir -p "$(dirname "$tree")"
checkout "$tree"

# The baseline: upstream exactly at the locked commit — no overlay file, no patch, no asset — in its own tree, so the
# queue's tree is never touched to make it (review round 6 PR-MED-001).
if [ "$mode" = baseline ]; then
  echo "APPLY_BASELINE_OK tree=$tree upstream=$UPSTREAM_TAG@${UPSTREAM_COMMIT:0:7} overlay_files=0 patches=0 assets=0"
  exit 0
fi

# The open-source build only (plan Decision 2, T3.9): upstream's bitwarden_license/ directory — the modules under the
# Bitwarden License, which never enter the build — is removed from the queue's tree, so the build itself proves it
# never needs them and neither the source archive nor the public fork made from this tree carries them. The baseline
# above stays upstream exactly. (A patch, overlay file or asset under it is refused before this, as ever.)
rm -rf "$tree/bitwarden_license"
[ ! -e "$tree/bitwarden_license" ] || fail "commercial-dir-left tree=$tree" "bitwarden_license/ could not be removed"

# Patch paths need the tree only to be read (`git apply --numstat`), never applied, before the overlay is copied.
for patch in "${patches[@]}"; do
  name="$(basename "$patch")"
  numstat="$work/numstat.z"
  safegit -C "$tree" apply --numstat -z "$patch" > "$numstat" || fail "patch-unreadable patch=$name"
  mapfile -d '' -t records < "$numstat"
  rm -f "$numstat"
  [ "${#records[@]}" -gt 0 ] || fail "patch-unreadable patch=$name" "it names no path"
  for record in "${records[@]}"; do
    [[ "$record" != -$'\t'-$'\t'* ]] || fail "binary-hunk patch=$name" "a binary hunk is refused: binary replacements are assets/ files"
    path="${record#*$'\t'}"
    path="${path#*$'\t'}"
    guard_path "$path" "patch=$name"
  done
done

for rel in "${overlay_rel[@]}"; do
  [ ! -e "$tree/$rel" ] || fail "overlay-shadows-upstream file=$rel" "the overlay holds new files only; an edit to an upstream file is a patch"
done
for rel in "${asset_rel[@]}"; do
  [ -f "$tree/$rel" ] || fail "asset-replaces-nothing path=$rel" "an asset replaces an upstream file at the same path"
done

# ---- copy and apply ----------------------------------------------------------------------------------------------
for rel in "${overlay_rel[@]}"; do
  mkdir -p "$(dirname "$tree/$rel")"
  cp "$root/overlay/$rel" "$tree/$rel"
done

applied=0
for patch in "${patches[@]}"; do
  name="$(basename "$patch")"
  if ! msg="$(safegit -C "$tree" apply --check "$patch" 2>&1)"; then
    fail "patch-does-not-apply patch=$name" "$msg"
  fi
  safegit -C "$tree" apply "$patch"
  echo "PATCH_OK $name"
  applied=$((applied + 1))
done

for rel in "${asset_rel[@]}"; do
  cp "$root/assets/$rel" "$tree/$rel"
done

summary="upstream=$UPSTREAM_TAG@${UPSTREAM_COMMIT:0:7} overlay_files=${#overlay_rel[@]} patches=$applied assets=${#asset_rel[@]} removed=bitwarden_license"
if [ "$mode" = check ]; then
  rm -rf "$work/check"
  echo "APPLY_CHECK_OK $summary"
else
  echo "APPLY_OK tree=$tree $summary"
fi
