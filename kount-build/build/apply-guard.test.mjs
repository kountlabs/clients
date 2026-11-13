// build/apply.sh's refusals (plan Decision 2, T0.1; T1.4 finishes this file), offline.
//
//   node --test apps/kount-extension/build/apply-guard.test.mjs
//
// Each case runs apply.sh --check in a temp copy of this directory whose upstream.lock points at a throwaway LOCAL
// repository tagged like the real lock, so the tag proof and the checkout need no network. Synthetic content only.
// Model: apps/vaultwarden-kount/build/apply-guard.test.mjs.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = mkdtempSync(join(tmpdir(), "kext-apply-guard-"));
after(() => rmSync(scratch, { recursive: true, force: true }));
const realLock = readFileSync(join(APP, "upstream.lock"), "utf8");
const TAG = /^UPSTREAM_TAG=(.*)$/m.exec(realLock)[1];

let upstream;
before(() => {
  const dir = join(scratch, "upstream");
  mkdirSync(dir, { recursive: true });
  const git = (...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();
  git("init", "-q");
  const files = {
    "apps/browser/src/a.ts": "export const a = 1;\n",
    "apps/browser/src/images/icon16.png": "not really a png\n",
    "bitwarden_license/bit-browser/x.ts": "export const x = 1;\n",
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  git("add", "-A");
  git("-c", "user.name=kext", "-c", "user.email=test+kext@kount.com.au", "commit", "-q", "-m", "synthetic upstream");
  git("tag", TAG);
  upstream = { dir, commit: git("rev-parse", "HEAD") };
});

const write = (dir, path, text) => {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), text);
};
const patch = (path, from, to) =>
  `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-${from}\n+${to}\n`;

let n = 0;
/** apply.sh --check in a temp copy of the app with `plant(dir)` applied. */
function runApply(plant = () => {}, { commit, repo, mode = "--check", dirOut, locale = "C", tag } = {}) {
  const dir = join(scratch, `app-${n++}`);
  cpSync(join(APP, "build"), join(dir, "build"), { recursive: true });
  mkdirSync(join(dir, "patches"), { recursive: true });
  writeFileSync(
    join(dir, "upstream.lock"),
    realLock
      .replace(/^UPSTREAM_REPO=.*$/m, `UPSTREAM_REPO=${repo ?? upstream.dir}`)
      .replace(/^UPSTREAM_COMMIT=.*$/m, `UPSTREAM_COMMIT=${commit ?? upstream.commit}`)
      .replace(/^UPSTREAM_TAG=.*$/m, `UPSTREAM_TAG=${tag ?? TAG}`),
  );
  plant(dir);
  if (dirOut) dirOut.dir = dir;
  const r = spawnSync("bash", [join(dir, "build", "apply.sh"), ...(mode ? [mode] : [])], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: scratch, GIT_CONFIG_NOSYSTEM: "1", LC_ALL: locale, LANG: locale },
    timeout: 120000,
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
function refused(result, reason) {
  assert.equal(result.code, 1, `${result.out}\n${result.err}`);
  assert.match(result.err, new RegExp(`APPLY_FAIL reason=${reason}\\b`));
}

describe("apply.sh --check", () => {
  test("a clean queue applies: an overlay file, a patch and a listed asset", () => {
    const r = runApply((dir) => {
      write(dir, "overlay/apps/browser/src/kount/new.ts", "export const k = 1;\n");
      write(dir, "patches/0001-a.patch", patch("apps/browser/src/a.ts", "export const a = 1;", "export const a = 2;"));
      write(dir, "assets/MANIFEST", "# icons\napps/browser/src/images/icon16.png\n");
      write(dir, "assets/apps/browser/src/images/icon16.png", "kount png\n");
    });
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /APPLY_CHECK_OK .* overlay_files=1 patches=1 assets=1/);
  });
  test("a lock commit off by one character is refused, naming the commit the tag names", () => {
    const wrong = `${upstream.commit.slice(0, -1)}${upstream.commit.endsWith("0") ? "1" : "0"}`;
    const r = runApply(() => {}, { commit: wrong });
    refused(r, "lock-mismatch");
    assert.match(r.err, new RegExp(`resolves to ${upstream.commit}, the lock says ${wrong}`));
  });
  test("--baseline prepares upstream with none of the queue (review round 6 PR-MED-001)", () => {
    const out = {};
    const r = runApply(
      (dir) => {
        write(dir, "overlay/apps/browser/src/kount/new.ts", "export const k = 1;\n");
        write(dir, "patches/0001-a.patch", patch("apps/browser/src/a.ts", "export const a = 1;", "export const a = 2;"));
        write(dir, "assets/MANIFEST", "apps/browser/src/images/icon16.png\n");
        write(dir, "assets/apps/browser/src/images/icon16.png", "kount png\n");
      },
      { mode: "--baseline", dirOut: out },
    );
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /APPLY_BASELINE_OK .* overlay_files=0 patches=0 assets=0/);
    const tree = join(out.dir, ".build", "baseline", "clients");
    assert.equal(readFileSync(join(tree, "apps/browser/src/a.ts"), "utf8"), "export const a = 1;\n");
    assert.equal(readFileSync(join(tree, "apps/browser/src/images/icon16.png"), "utf8"), "not really a png\n");
    assert.throws(() => readFileSync(join(tree, "apps/browser/src/kount/new.ts")));
    // The baseline is upstream exactly: bitwarden_license/ stays there.
    assert.equal(readFileSync(join(tree, "bitwarden_license/bit-browser/x.ts"), "utf8"), "export const x = 1;\n");
  });
  test("the queue's tree has no bitwarden_license/ (plan T3.9): the build, the archive and the fork never carry it", () => {
    const out = {};
    const r = runApply(
      (dir) => write(dir, "patches/0001-a.patch", patch("apps/browser/src/a.ts", "export const a = 1;", "export const a = 2;")),
      { mode: null, dirOut: out },
    );
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /APPLY_OK .* patches=1 assets=0 removed=bitwarden_license$/m);
    const tree = join(out.dir, ".build", "clients");
    assert.equal(readFileSync(join(tree, "apps/browser/src/a.ts"), "utf8"), "export const a = 2;\n");
    assert.equal(existsSync(join(tree, "bitwarden_license")), false);
    // A second run over the kept tree (its reset restores tracked files) removes it again.
    const again = spawnSync("bash", [join(out.dir, "build", "apply.sh")], {
      encoding: "utf8",
      env: { PATH: process.env.PATH, HOME: scratch, GIT_CONFIG_NOSYSTEM: "1", LC_ALL: "C", LANG: "C" },
      timeout: 120000,
    });
    assert.equal(again.status, 0, again.stderr);
    assert.equal(existsSync(join(tree, "bitwarden_license")), false);
  });
  test("build.sh refuses --baseline with --no-apply before anything runs (review round 7 PR-MED-009)", () => {
    // A temp copy with no upstream.lock and no tree: reaching apply.sh would fail on the lock, reaching docker on the
    // missing tree — the usage refusal must come first, and nothing else may print.
    const dir = join(scratch, `build-${n++}`);
    cpSync(join(APP, "build"), join(dir, "build"), { recursive: true });
    const r = spawnSync("bash", [join(dir, "build", "build.sh"), "--baseline", "--no-apply"], {
      encoding: "utf8",
      env: { PATH: process.env.PATH, HOME: scratch, LC_ALL: "C" },
      timeout: 60000,
    });
    assert.equal(r.status, 2, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /BUILD_FAIL reason=usage \(--baseline always re-proves the lock: no --no-apply\)/);
    assert.equal(r.stdout, "");
    assert.doesNotMatch(r.stderr, /LOCK_OK|APPLY_|kext-build/);
  });
  test("build.sh refuses a store build with --no-apply before anything runs (review round 9)", () => {
    const dir = join(scratch, `build-${n++}`);
    cpSync(join(APP, "build"), join(dir, "build"), { recursive: true });
    const r = spawnSync("bash", [join(dir, "build", "build.sh"), "--no-apply"], {
      encoding: "utf8",
      env: { PATH: process.env.PATH, HOME: scratch, LC_ALL: "C" },
      timeout: 60000,
    });
    assert.equal(r.status, 2, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /BUILD_FAIL reason=usage \(a store build always re-applies: --no-apply needs --proofs\)/);
    assert.equal(r.stdout, "");
  });
  test("a lock repository that is not https:// or an absolute path is refused", () => {
    refused(runApply(() => {}, { repo: "-uploadpack=x" }), "lock-value");
    refused(runApply(() => {}, { repo: "file://localhost/x" }), "lock-value");
  });
  const cases = [
    ["a patch that adds a symlink", "mode-hunk", (d) => write(d, "patches/0001-s.patch", "diff --git a/apps/browser/src/lic.ts b/apps/browser/src/lic.ts\nnew file mode 120000\nindex 0000000..1111111\n--- /dev/null\n+++ b/apps/browser/src/lic.ts\n@@ -0,0 +1 @@\n+../../../bitwarden_license/bit-browser/x.ts\n\\ No newline at end of file\n")],
    ["a patch that sets an executable bit", "mode-hunk", (d) => write(d, "patches/0001-m.patch", "diff --git a/apps/browser/src/a.ts b/apps/browser/src/a.ts\nold mode 100644\nnew mode 100755\n")],
    ["an overlay symlink", "overlay-symlink", (d) => {
      mkdirSync(join(d, "overlay/apps/browser/src"), { recursive: true });
      symlinkSync("../../../bitwarden_license/bit-browser/x.ts", join(d, "overlay/apps/browser/src/lic.ts"));
    }],
    ["an overlay file under bitwarden_license/", "commercial-path", (d) => write(d, "overlay/bitwarden_license/bit-browser/y.ts", "x\n")],
    ["a patch to a bitwarden_license/ file", "commercial-path", (d) => write(d, "patches/0001-c.patch", patch("bitwarden_license/bit-browser/x.ts", "export const x = 1;", "export const x = 2;"))],
    ["a rename patch", "rename-hunk", (d) => write(d, "patches/0001-r.patch", "diff --git a/apps/browser/src/a.ts b/apps/browser/src/b.ts\nsimilarity index 100%\nrename from apps/browser/src/a.ts\nrename to apps/browser/src/b.ts\n")],
    ["a copy patch", "rename-hunk", (d) => write(d, "patches/0001-k.patch", "diff --git a/apps/browser/src/a.ts b/apps/browser/src/b.ts\nsimilarity index 100%\ncopy from apps/browser/src/a.ts\ncopy to apps/browser/src/b.ts\n")],
    ["a binary patch", "binary-hunk", (d) => write(d, "patches/0001-b.patch", "diff --git a/apps/browser/src/images/icon16.png b/apps/browser/src/images/icon16.png\nindex 1..2 100644\nGIT binary patch\nliteral 1\nIcmZ?l000001\n\n")],
    ["an overlay file that shadows upstream", "overlay-shadows-upstream", (d) => write(d, "overlay/apps/browser/src/a.ts", "x\n")],
    ["an overlay path that is not plain", "unsupported-path", (d) => write(d, "overlay/apps/browser/src/a b.ts", "x\n")],
    ["a patch that does not apply", "patch-does-not-apply", (d) => write(d, "patches/0001-n.patch", patch("apps/browser/src/a.ts", "something else", "x"))],
    ["assets/ without a MANIFEST", "asset-manifest-missing", (d) => write(d, "assets/apps/browser/src/images/icon16.png", "p\n")],
    ["an asset not named in MANIFEST", "asset-unlisted", (d) => {
      write(d, "assets/MANIFEST", "\n");
      write(d, "assets/apps/browser/src/images/icon16.png", "p\n");
    }],
    ["a MANIFEST line naming a missing file", "asset-listed-missing", (d) => write(d, "assets/MANIFEST", "apps/browser/src/images/icon16.png\n")],
    ["an asset outside apps/browser/src/images/", "asset-outside-images", (d) => {
      write(d, "assets/MANIFEST", "apps/browser/src/a.ts\n");
      write(d, "assets/apps/browser/src/a.ts", "x\n");
    }],
    ["an asset that replaces nothing upstream", "asset-replaces-nothing", (d) => {
      write(d, "assets/MANIFEST", "apps/browser/src/images/new.png\n");
      write(d, "assets/apps/browser/src/images/new.png", "p\n");
    }],
    ["a MANIFEST path with a .. segment", "unsupported-path", (d) => {
      write(d, "assets/MANIFEST", "apps/browser/src/images/../a.ts\n");
      write(d, "assets/apps/browser/src/a.ts", "x\n");
    }],
  ];
  for (const [name, reason, plant] of cases) {
    test(`refuses ${name} (${reason})`, () => refused(runApply(plant), reason));
  }

  // T1.4: the same refusals hold whatever the caller's locale (apply.sh pins LC_ALL=C; a range or class under a UTF-8
  // locale could otherwise pass an accented letter).
  const more = [
    ["a legacy `rename old` patch", "rename-hunk", (d) => write(d, "patches/0001-o.patch", "diff --git a/apps/browser/src/a.ts b/apps/browser/src/b.ts\nrename old apps/browser/src/a.ts\nrename new apps/browser/src/b.ts\n")],
    ["a patch path with a .. segment", "unsupported-path", (d) => write(d, "patches/0001-d.patch", patch("apps/browser/../browser/src/a.ts", "export const a = 1;", "x"))],
    ["a patch that adds a file under bitwarden_license/", "commercial-path", (d) => write(d, "patches/0001-n.patch", "diff --git a/bitwarden_license/bit-browser/new.ts b/bitwarden_license/bit-browser/new.ts\nnew file mode 100644\nindex 0000000..1111111\n--- /dev/null\n+++ b/bitwarden_license/bit-browser/new.ts\n@@ -0,0 +1 @@\n+export const n = 1;\n")],
    ["an asset under bitwarden_license/", "commercial-path", (d) => {
      write(d, "assets/MANIFEST", "bitwarden_license/bit-browser/x.ts\n");
      write(d, "assets/bitwarden_license/bit-browser/x.ts", "x\n");
    }],
  ];
  for (const [name, reason, plant] of more) {
    test(`refuses ${name} (${reason})`, () => refused(runApply(plant), reason));
  }
  test("a patch whose two names differ, without a rename header, is refused", () => {
    const r = runApply((d) =>
      write(d, "patches/0001-x.patch", "diff --git a/apps/browser/src/a.ts b/bitwarden_license/bit-browser/a.ts\n--- a/apps/browser/src/a.ts\n+++ b/bitwarden_license/bit-browser/a.ts\n@@ -1 +1 @@\n-export const a = 1;\n+export const a = 2;\n"),
    );
    assert.equal(r.code, 1, `${r.out}\n${r.err}`);
    assert.match(r.err, /APPLY_FAIL reason=(commercial-path|rename-hunk|unsupported-path|patch-unreadable)\b/);
    assert.doesNotMatch(r.out, /PATCH_OK|APPLY_CHECK_OK/);
  });
  for (const locale of ["C.UTF-8", "en_US.UTF-8", "en_AU.UTF-8"]) {
    test(`under ${locale}: an accented overlay path and an accented lock tag are refused`, () => {
      refused(runApply((d) => write(d, "overlay/apps/browser/src/café.ts", "x\n"), { locale }), "unsupported-path");
      refused(runApply(() => {}, { locale, tag: `${TAG}é` }), "lock-value");
    });
    test(`under ${locale}: a clean queue still applies`, () => {
      const r = runApply((d) => write(d, "overlay/apps/browser/src/kount/new.ts", "export const k = 1;\n"), { locale });
      assert.equal(r.code, 0, r.err);
      assert.match(r.out, /APPLY_CHECK_OK .* overlay_files=1 patches=0 assets=0/);
    });
  }
});

// Each refusal removed from a copy of apply.sh: its case must then pass the planted copy (a guard nobody has watched fail
// is not a guard). Model: apps/vaultwarden-kount/conformance/browser/check-proofs.test.mjs's planted checkers.
describe("planted apply.sh — each refusal seen failing", () => {
  const SOURCE = readFileSync(join(APP, "build", "apply.sh"), "utf8");
  /** runApply with the build/ copy's apply.sh edited: `from` (which must occur once) replaced by `to`. */
  const plantedRun = (from, to, plant, opts) => {
    assert.equal(SOURCE.split(from).length - 1, 1, `the plant's anchor must occur once: ${from}`);
    return runApply((d) => {
      writeFileSync(join(d, "build", "apply.sh"), SOURCE.replace(from, to));
      plant(d);
    }, opts);
  };
  const PLANTS = [
    ["commercial-path", 'fail "commercial-path path=$path $where"', ":", (d) => write(d, "overlay/bitwarden_license/bit-browser/y.ts", "x\n")],
    ["overlay-shadows-upstream", 'fail "overlay-shadows-upstream file=$rel"', ":", (d) => write(d, "overlay/apps/browser/src/a.ts", "x\n")],
    ["rename-hunk", 'fail "rename-hunk patch=$name"', ":", (d) => write(d, "patches/0001-k.patch", "diff --git a/apps/browser/src/a.ts b/apps/browser/src/b.ts\nsimilarity index 100%\ncopy from apps/browser/src/a.ts\ncopy to apps/browser/src/b.ts\n")],
    ["asset-unlisted", 'fail "asset-unlisted path=$rel"', ":", (d) => {
      write(d, "assets/MANIFEST", "\n");
      write(d, "assets/apps/browser/src/images/icon16.png", "p\n");
    }],
    ["asset-replaces-nothing", 'fail "asset-replaces-nothing path=$rel"', ":", (d) => {
      write(d, "assets/MANIFEST", "apps/browser/src/images/new.png\n");
      write(d, "assets/apps/browser/src/images/new.png", "p\n");
    }],
  ];
  for (const [title, from, to, plant] of PLANTS) {
    test(title, () => {
      const real = runApply(plant);
      refused(real, title);
      // The planted copy may fail later for another reason, but never by this refusal: the case pins this rule.
      const planted = plantedRun(from, to, plant);
      assert.doesNotMatch(planted.err, new RegExp(`APPLY_FAIL reason=${title}\\b`), `${title}: the planted copy still refuses`);
    });
  }
});
