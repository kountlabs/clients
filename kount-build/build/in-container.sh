#!/usr/bin/env bash
# build/in-container.sh — the steps build.sh runs INSIDE the digest-pinned Node container. Never run on the host:
# it runs upstream's npm install and webpack, which are fetched code (plan Critical Constraint 2).
#
#   /src     the applied tree (.build/clients), read-write: npm ci writes node_modules, webpack writes build/ and dist/
#   /out     .build/out/<label>/, the packages and the measurements
#   KEXT_TARGETS   space-separated subset of: chrome edge firefox
#   KEXT_TEST      1 = run the Kount spec files with upstream's jest before building
#   KEXT_MAPS      1 = keep upstream's source maps in the packages (a proofs build); 0 = drop them (a store package:
#                  plan T1.5 — the stores' reviewers read the source archive and the public fork instead)
#   KEXT_NOTICES   1 = write the GPL-3.0 files into each package (plan T3.9; notice/notices.mjs) from KEXT_LABEL,
#                  KEXT_VERSION, KEXT_UPSTREAM_TAG and KEXT_UPSTREAM_COMMIT; 0 = none (the baseline: upstream as it is)
#   /kext          build/ itself, read-only (this script, zip-tree.py, notice/)
set -euo pipefail

[ -f /.dockerenv ] || { echo "IN_CONTAINER_FAIL reason=host (this script runs only inside build.sh's container)" >&2; exit 2; }
cd /src

now() { date +%s; }
peak() { cat /sys/fs/cgroup/memory.peak 2>/dev/null || echo unknown; }
summary=/out/BUILD_SUMMARY
: > "$summary"
log() { echo "$*"; echo "$*" >> "$summary"; }

log "NODE $(node --version) NPM $(npm --version) CPUS $(nproc)"

# npm ci only when the lockfile changed since the last install in this tree (patches never touch package-lock.json).
lock_sum="$(sha256sum package-lock.json | cut -d' ' -f1)"
stamp=node_modules/.kext-ci-stamp
if [ "$(cat "$stamp" 2>/dev/null || true)" != "$lock_sum" ]; then
  t0=$(now)
  npm ci --no-audit --no-fund --loglevel=error
  echo "$lock_sum" > "$stamp"
  log "STEP npm-ci seconds=$(( $(now) - t0 )) memory_peak_bytes=$(peak)"
else
  log "STEP npm-ci skipped (stamp matches package-lock.json)"
fi

if [ "${KEXT_TEST:-0}" = 1 ]; then
  t0=$(now)
  ( cd apps/browser && npx jest --ci --json --outputFile=/out/jest.json src/kount ) || true
  counts="$(node -e 'const r=require("/out/jest.json");console.log(`suites=${r.numTotalTestSuites} tests=${r.numTotalTests} passed=${r.numPassedTests} failed=${r.numFailedTests}`);if(!r.success||r.numTotalTests===0||r.numFailedTests>0)process.exit(1)')" ||
    { log "STEP test FAIL $counts"; echo "IN_CONTAINER_FAIL reason=test $counts" >&2; exit 1; }
  log "STEP test seconds=$(( $(now) - t0 )) $counts"
fi

cd apps/browser
for target in $KEXT_TARGETS; do
  case "$target" in chrome|edge|firefox) ;; *) echo "IN_CONTAINER_FAIL reason=target $target" >&2; exit 2 ;; esac
  rm -rf build dist
  t0=$(now)
  # dist:<target> is build:prod:<target> then scripts/compress.sh (`zip -r` of build/); the image has no zip, so the
  # package is written by zip-tree.py — the same files, reproducibly. The two `--` carry webpack's own --json through
  # build:prod:<target>'s inner `npm run build:<target>`: webpack's stats, the record of every module it bundled, which
  # the notices are written from (it changes nothing in the output). Without the chunk list and the reasons — the bulk of
  # a stats file, which notices.mjs never reads (each module's own chunk ids stay) — so the hosted runner's 7 GB holds it.
  stats="/tmp/kext-stats-$target.json"
  rm -f "$stats"
  if ! npm run "build:prod:$target" -- -- --json="$stats" --no-stats-chunks --no-stats-reasons; then
    # --json sends webpack's errors to the stats file alone, which goes with the container: print them first.
    node -e '
      const s = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
      for (const e of (s.errors ?? []).slice(0, 20)) console.error(`WEBPACK_ERROR ${e.moduleName ?? ""}: ${String(e.message ?? e).slice(0, 2000)}`);
    ' "$stats" || true
    echo "IN_CONTAINER_FAIL reason=webpack target=$target" >&2
    exit 1
  fi
  secs=$(( $(now) - t0 ))
  # Every source the maps name: nothing from bitwarden_license/ or the commercial SDK was bundled (plan Decision 2).
  # Checked before the maps are dropped, so a store package is held to it too.
  node -e '
    const fs = require("fs"), path = require("path");
    let maps = 0, sources = 0;
    (function walk(d) {
      for (const n of fs.readdirSync(d)) {
        const f = path.join(d, n), s = fs.lstatSync(f);
        if (s.isDirectory()) walk(f);
        else if (n.endsWith(".map")) {
          maps++;
          for (const src of JSON.parse(fs.readFileSync(f, "utf8")).sources ?? []) {
            sources++;
            if (/bitwarden_license|commercial-sdk-internal/.test(src)) { console.error(`IN_CONTAINER_FAIL reason=commercial-source ${n}: ${src}`); process.exit(1); }
          }
        }
      }
    })("build");
    if (maps === 0) { console.error("IN_CONTAINER_FAIL reason=no-source-maps (nothing to check the sources against)"); process.exit(1); }
    console.log(`MAP_SOURCES_OK maps=${maps} sources=${sources}`);
  '
  if [ "${KEXT_MAPS:-0}" != 1 ]; then find build -name '*.map' -type f -delete; fi
  if [ "${KEXT_NOTICES:-1}" = 1 ]; then
    node /kext/notice/notices.mjs "$stats" build /src "/tmp/kext-notices-$target.txt" "$target" | tee -a "$summary"
  fi
  rm -f "$stats"
  zip="/out/kount-protect-$target.zip"
  python3 -I /kext/zip-tree.py build "$zip"
  rm -rf "/out/$target-unpacked"
  cp -a build "/out/$target-unpacked"
  log "STEP dist:$target seconds=$secs bytes=$(stat -c %s "$zip") memory_peak_bytes=$(peak)"
done

# Which SDK the build carries: the WebAssembly modules in the packages, by hash, against each installed SDK's. The same
# hashes go to /out/sdk-hashes.txt (`gpl <sha256> <path>` / `commercial <sha256> <path>` / `commercial not-installed`,
# and `gpl-source <version> <commit>`), which check-artefacts.sh holds every packaged .wasm and NOTICE.txt to — and which
# SHA256SUMS covers. The notices record follows them (`notice …` lines, below).
cd /src
sdk=/out/sdk-hashes.txt
: > "$sdk"
for kind in gpl commercial; do
  case "$kind" in gpl) pkg=node_modules/@bitwarden/sdk-internal ;; *) pkg=node_modules/@bitwarden/commercial-sdk-internal ;; esac
  if [ ! -d "$pkg" ]; then
    log "SDK $pkg not-installed"
    echo "$kind not-installed" >> "$sdk"
    continue
  fi
  while IFS= read -r -d '' w; do
    h="$(sha256sum "$w" | cut -d' ' -f1)"
    log "SDK_WASM $h $w"
    echo "$kind $h $w" >> "$sdk"
  done < <(find "$pkg" -name '*.wasm' -print0 | LC_ALL=C sort -z)
  # The GPL SDK's version and the sdk-internal commit it was compiled from (its VERSION file) — what NOTICE.txt names
  # as the module's source; check-artefacts.sh holds NOTICE.txt to this line (plan T3.9).
  if [ "$kind" = gpl ]; then
    echo "gpl-source $(node -p 'require("/src/node_modules/@bitwarden/sdk-internal/package.json").version') $(tr -d '[:space:]' < "$pkg/VERSION")" >> "$sdk"
  fi
done
for target in $KEXT_TARGETS; do
  find "/out/$target-unpacked" -name '*.wasm' -print0 | while IFS= read -r -d '' w; do log "BUILT_WASM $target $(sha256sum "$w" | cut -d' ' -f1) ${w#/out/}"; done
  # The notices each package carries, as the build derived them (`notice <target> <sha256> <section key>`; plan T3.9,
  # review round 46): the checker holds each package's THIRD-PARTY-NOTICES.txt to these lines.
  if [ "${KEXT_NOTICES:-1}" = 1 ]; then cat "/tmp/kext-notices-$target.txt" >> "$sdk"; fi
done
log "MEMORY_PEAK_BYTES $(peak)"
log "IN_CONTAINER_OK targets=$KEXT_TARGETS"
