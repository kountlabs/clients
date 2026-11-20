// The product-name scan (plan T0.3; the checker's rule in T1.5): every "bitwarden", any case, in an unpacked build.
//
//   node apps/kount-extension/build/tools/name-scan.mjs <unpacked dir> <report file>
//
// Reads the built files as data (never runs them). Prints one line per file with its counts; the report holds, per
// file, every distinct context of the capitalised word "Bitwarden" (the spelling a person reads) — the lines T0.3
// sorts into "must go" and "licence / attribution text that stays". Lower-case hits (module paths such as
// @bitwarden/…, identifiers, CSS classes) are counted, not listed.
import { lstatSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const [dir, reportFile] = process.argv.slice(2);
if (!dir || !reportFile) {
  console.error("usage: name-scan.mjs <unpacked dir> <report file>");
  process.exit(2);
}
const files = [];
(function walk(d) {
  for (const name of readdirSync(d).sort()) {
    const p = join(d, name);
    const st = lstatSync(p); // never follows a link out of the build
    if (st.isSymbolicLink()) {
      console.error(`SCAN_FAIL a symlink in the build: ${relative(dir, p)}`);
      process.exit(1);
    }
    if (st.isDirectory()) walk(p);
    else files.push(p);
  }
})(dir);

const report = [];
let total = 0;
let visibleTotal = 0;
for (const file of files) {
  const rel = relative(dir, file);
  const buf = readFileSync(file);
  const text = buf.toString("latin1");
  const any = (text.match(/bitwarden/gi) ?? []).length;
  if (any === 0) continue;
  const contexts = new Map();
  for (const m of text.matchAll(/Bitwarden/g)) {
    const at = m.index;
    const ctx = text.slice(Math.max(0, at - 50), at + 60).replace(/\s+/g, " ");
    contexts.set(ctx, (contexts.get(ctx) ?? 0) + 1);
  }
  total += any;
  visibleTotal += contexts.size;
  console.log(`SCAN ${rel} any_case=${any} capitalised_contexts=${contexts.size}`);
  report.push(`## ${rel} — ${any} hits any case, ${contexts.size} distinct capitalised contexts`);
  for (const [ctx, n] of contexts) report.push(`  [${n}x] …${ctx}…`);
}
writeFileSync(reportFile, `${report.join("\n")}\n`);
console.log(`SCAN_DONE files=${files.length} files_with_hits=${report.filter((l) => l.startsWith("## ")).length} any_case=${total} capitalised_contexts=${visibleTotal}`);
