// Write patches/<name>.patch from edits made in the applied tree (.build/clients), for the named upstream paths only.
//
//   node apps/kount-extension/build/tools/diff-patch.mjs 0004-preset-vault apps/browser/src/background/runtime.background.ts
//
// The recipe: run apply.sh (the tree is upstream + the queue), edit the named files in .build/clients, then this.
// Each patch owns its paths: a path another patch already touches is refused, so every patch applies to upstream on
// its own and the queue's order never matters. Reads the tree with git; executes nothing from it.
import { execFileSync } from "node:child_process";
import { lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TREE = join(APP, ".build", "clients");
const [name, ...paths] = process.argv.slice(2);
if (!name || !/^\d{4}-[a-z0-9-]+$/.test(name) || paths.length === 0) {
  console.error("usage: diff-patch.mjs <NNNN-name> <upstream path>...");
  process.exit(2);
}
const out = join(APP, "patches", `${name}.patch`);
mkdirSync(join(APP, "patches"), { recursive: true });
// Each named path is one plain file of the tree (never a directory pathspec, never a link).
for (const p of paths) {
  if (!/^[A-Za-z0-9._/-]+$/.test(p) || p.split("/").some((s) => s === "" || s === "." || s === "..")) {
    console.error(`DIFF_FAIL ${p} is not a plain path`);
    process.exit(1);
  }
  let st;
  try {
    st = lstatSync(join(TREE, p));
  } catch {
    st = null;
  }
  if (!st || !st.isFile()) {
    console.error(`DIFF_FAIL ${p} is not a file in the tree`);
    process.exit(1);
  }
}
// The paths every other patch touches, from its `diff --git a/X b/Y` headers (adds, edits and deletes alike).
for (const file of readdirSync(join(APP, "patches"))) {
  if (!file.endsWith(".patch") || file === `${name}.patch`) continue;
  const owned = new Set();
  for (const m of readFileSync(join(APP, "patches", file), "utf8").matchAll(/^diff --git a\/(\S+) b\/(\S+)$/gm)) {
    owned.add(m[1]);
    owned.add(m[2]);
  }
  for (const p of paths) {
    if (owned.has(p)) {
      console.error(`DIFF_FAIL ${p} is already patched by ${file}`);
      process.exit(1);
    }
  }
}
// The other patches' edits are in the tree too; diff the named paths against upstream's commit only. No hook, no
// file-system monitor, no text conversion or external diff from the tree's config (the build container touched it).
const diff = execFileSync(
  "git",
  ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-C", TREE, "diff", "--no-color", "--no-ext-diff", "--no-textconv", "HEAD", "--", ...paths],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);
if (!diff.trim()) {
  console.error("DIFF_FAIL no change in the named paths");
  process.exit(1);
}
writeFileSync(out, diff);
const files = (diff.match(/^\+\+\+ b\//gm) ?? []).length;
const added = (diff.match(/^\+(?!\+\+)/gm) ?? []).length;
const removed = (diff.match(/^-(?!--)/gm) ?? []).length;
console.log(`DIFF_OK ${name}.patch files=${files} +${added} -${removed}`);
