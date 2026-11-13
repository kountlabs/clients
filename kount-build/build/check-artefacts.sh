#!/usr/bin/env bash
# build/check-artefacts.sh — hold a build's output to the release rules (plan T1.5, E21).
#
#   bash apps/kount-extension/build/check-artefacts.sh <dir>             a store build
#   bash apps/kount-extension/build/check-artefacts.sh --release <dir>   a release: no candidate, no placeholder
#   bash apps/kount-extension/build/check-artefacts.sh --proofs <dir>    a proofs build (loopback constants)
#
# The rules and their reasons are in check-artefacts.mjs's header; this wrapper only pins the locale and runs it with the
# host's Node (repository code: it reads the packages as data and runs nothing from them). Its test:
# node --test apps/kount-extension/build/check-artefacts.test.mjs.
set -euo pipefail
export LC_ALL=C
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$here/check-artefacts.mjs" "$@"
