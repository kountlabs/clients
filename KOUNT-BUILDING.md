# Building Kount Protect from this source

This is the corresponding source of a Kount Protect browser extension build: Bitwarden, Inc.'s `bitwarden/clients`
repository at the release and commit named in `kount-build/upstream.lock`, with Kount's changes applied, the two
manifests' `version` set to the build's store version (the top entry of `kount-build/CHANGELOG.md`), and upstream's
`bitwarden_license/` directory removed (nothing in the open-source build reads it). `NOTICE.txt` in each package names
the build; this file says how to make the packages again.

`KOUNT-UPSTREAM-TREE.txt` is upstream's own commit object at that commit and the list of its files with their git ids
(`git ls-tree -r`). Kount's check holds this tree to it: no file of upstream's is missing and none is here that is
neither upstream's nor one Kount adds, and every file Kount's changes do not touch has upstream's id
(`git hash-object <file>` shows it). A file Kount's patches change is checked only to be here and not empty; its content
is upstream's file with the patch applied, which the steps below reproduce, but the check does not rebuild it.

`kount-build/` is the kit that made this tree and its packages:

| Path | What |
|---|---|
| `upstream.lock` | the upstream repository, release tag and commit |
| `patches/` | Kount's changes to upstream files, applied in order (`git apply`) |
| `overlay/` | the files Kount adds (the pick hook, its spec, the build constants) |
| `assets/` | the pictures Kount replaces, each named in `assets/MANIFEST` |
| `CHANGELOG.md` | the builds and their store versions |
| `build/apply.sh` | fetches upstream at the lock, proves the commit, applies the overlay, patches and pictures, removes `bitwarden_license/` |
| `build/build.sh` | stamps the version and builds in a digest-pinned Node container |
| `build/in-container.sh` | the steps inside the container: `npm ci`, upstream's `build:prod:<browser>`, the notices, the zip |
| `build/zip-tree.py` | writes each package reproducibly |
| `build/notice/` | the notice template, the notices generator, the three typefaces' licences and this file |
| `build/tools/` | the tools that cut the patches and draw the pictures |

Everything else in `build/` (the checks and their tests) is how Kount checks a build; it is not needed to make one.

## From this tree

You need Docker. From the directory this file is in:

```
mkdir -p out
docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp/home -e HUSKY=0 -e CI=true \
  -e ELECTRON_SKIP_BINARY_DOWNLOAD=1 -e PUPPETEER_SKIP_DOWNLOAD=1 -e PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 -e CYPRESS_INSTALL_BINARY=0 \
  -e KEXT_TARGETS="chrome edge firefox" -e KEXT_TEST=0 -e KEXT_MAPS=0 \
  -e KEXT_LABEL=<label> -e KEXT_VERSION=<version> -e KEXT_UPSTREAM_TAG=<tag> -e KEXT_UPSTREAM_COMMIT=<commit> \
  -v "$PWD":/src -v "$PWD/out":/out -v "$PWD/kount-build/build":/kext:ro \
  node:24-bookworm@sha256:8fa96264f302f58bbb13aa7339c541547b56975766ce956c875da149452a3e40 \
  bash /kext/in-container.sh
```

`<label>` and `<version>` are the first line of `NOTICE.txt` in the package being rebuilt (`Kount Protect <version>
(<label>)`); `<tag>` and `<commit>` are `UPSTREAM_TAG` and `UPSTREAM_COMMIT` in `kount-build/upstream.lock`. The
packages are written to `out/kount-protect-<browser>.zip`. The Node image above is the one `build/build.sh` pins (its
`NODE_IMAGE` line). Upstream's dependencies are installed from its `package-lock.json`, which fixes every version.

## From upstream

You need Docker, git and Node. With `kount-build/` copied anywhere as its own directory:

```
bash kount-build/build/build.sh
```

`apply.sh` fetches upstream at the lock into `kount-build/.build/clients` and applies the queue; `build.sh` then builds
there and writes the packages, this source archive and their `SHA256SUMS` to `kount-build/.build/out/release/`.
