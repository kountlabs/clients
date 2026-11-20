// The artefact checker, offline (plan T1.5): a good store build, a good proofs build and a good release pass; a planted
// fault for each rule fails, naming it. Synthetic packages only — no build, no network.
//
//   node --test apps/kount-extension/build/check-artefacts.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const HERE = dirname(fileURLToPath(import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), "kext-check-artefacts-"));
after(() => rmSync(scratch, { recursive: true, force: true }));
const sha = (b) => createHash("sha256").update(b).digest("hex");

/** A zip of { name: string|Buffer } (deflated), with optional per-entry `mode` for a symlink plant. */
function zip(files, { modes = {} } = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const comp = zlib.deflateRawSync(data);
    const nameBuf = Buffer.from(name);
    const crc = zlib.crc32(data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(((modes[name] ?? 0o100644) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, comp);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const GPL_WASM = Buffer.from("\0asm gpl sdk module");
const COMMERCIAL_WASM = Buffer.from("\0asm commercial sdk module");
const VERSION = "2026.10.2.1";
const DECLARED = ["authenticationInfo", "personallyIdentifyingInfo", "financialAndPaymentInfo", "browsingActivity"];
const README = `# x\n\n- Name: \`Kount Protect\`\n- Firefox id: \`kount-protect@kount.com.au\`\n- Firefox data collection: \`${DECLARED.join(", ")}\`\n`;
const changelog = (status = "candidate") => `# Changelog\n\n## browser-v2026.10.2+kount.1 — ${status}\n\ntext\n`;

// The notice files (plan T3.9): the real template and the Inter licence, filled for the fixture's build.
const TEMPLATE = readFileSync(join(HERE, "notice", "NOTICE.template.txt"), "utf8");
const INTER_OFL = readFileSync(join(HERE, "notice", "inter-OFL.txt"), "utf8");
const { renderNotice, OTHER_MATERIAL, bundledPackageDirs, thirdPartyNotices, noticeSections, thirdPartyPreamble } = await import("./notice/notices.mjs");
const { archiveRequirements, gitObjectId, gitTreeId, readUpstreamTree, UPSTREAM_TREE_RECORD, ATTRIBUTION_LITERAL } = await import("./check-artefacts.mjs");
const { APPROVED_ATTRIBUTION } = await import("./tools/brand-residue.mjs");
/** The approved attribution (T3.1) written out, and as the About dialog's compiled template carries it. */
const ATTRIBUTION = "Kount Protect was developed using Bitwarden® open source software.";
const ABOUT_LINE = JSON.stringify(ATTRIBUTION);
const GPL_TEXT = "                    GNU GENERAL PUBLIC LICENSE\n                       Version 3, 29 June 2007\n\n  TERMS AND CONDITIONS\n...\n                     END OF TERMS AND CONDITIONS\n";
const UPSTREAM_NOTICE = "Source code in this repository is covered by one of two licenses: (i) the\n/bitwarden_license directory.\n\nNo grant of any rights in the trademarks, service marks, or logos of Bitwarden is\nmade.\n";
const LONG_UPSTREAM = `./apps/browser/src/${"a".repeat(120)}.ts`;

/**
 * A synthetic upstream at a synthetic lock commit (review round 48 PR-MED-042), independent of the requirement list:
 * every path the real kit patches or replaces (with upstream's own, different bytes), upstream's licence files and
 * lockfile, untouched build inputs the requirements never name (apps/browser/package.json, webpack.config.js,
 * tsconfig.json, a source file, an executable script, a long name) and a bitwarden_license/ file apply.sh removes.
 * `listing(over)` writes the record, its commit object and that commit's id with real git hashing.
 */
function syntheticUpstream(files) {
  const listing = new Map([...files].map(([p, f]) => [p.slice(2), { mode: f.mode ?? "100644", type: f.type ?? "blob", oid: f.oid ?? gitObjectId("blob", f.data) }]));
  const commitObject = Buffer.from(`tree ${gitTreeId(listing)}\nauthor Planted <planted@example.invalid> 0 +0000\ncommitter Planted <planted@example.invalid> 0 +0000\n\nplanted upstream\n`);
  const lines = [...listing].map(([p, e]) => `${e.mode} ${e.type} ${e.oid}\t${p}\n`).join("");
  return { commit: gitObjectId("commit", commitObject), record: `# planted\ncommit ${commitObject.toString("base64")}\n${lines}` };
}
const UPSTREAM = (() => {
  const base = archiveRequirements(join(HERE, ".."), { lock: `UPSTREAM_TAG=browser-v2026.10.2\nUPSTREAM_COMMIT=${"0".repeat(40)}\n`, changelog: "" });
  const files = new Map();
  for (const [name] of base.need) {
    if (name.startsWith(base.kitPrefix) || name === "./KOUNT-BUILDING.md" || name === UPSTREAM_TREE_RECORD || base.added.has(name)) continue;
    const text = { "./LICENSE_GPL.txt": GPL_TEXT, "./LICENSE.txt": UPSTREAM_NOTICE }[name];
    files.set(name, { data: Buffer.from(text ?? (base.touched.has(name) ? `upstream's ${name}\n` : `planted ${name}\n`)), touched: base.touched.has(name) });
  }
  for (const p of ["./apps/browser/package.json", "./apps/browser/webpack.config.js", "./tsconfig.json", "./libs/common/src/untouched.ts", LONG_UPSTREAM]) {
    files.set(p, { data: Buffer.from(`upstream's ${p}\n`) });
  }
  files.set("./scripts/run.sh", { data: Buffer.from("#!/bin/sh\n"), mode: "100755" });
  files.set("./bitwarden_license/bit-browser/x.ts", { data: Buffer.from("commercial\n") });
  return { files, ...syntheticUpstream(files) };
})();
const LOCK = `UPSTREAM_REPO=https://github.com/bitwarden/clients.git\nUPSTREAM_TAG=browser-v2026.10.2\nUPSTREAM_COMMIT=${UPSTREAM.commit}\n`;
const NOTICE_VALUES = {
  label: "browser-v2026.10.2+kount.1", version: VERSION, upstreamTag: "browser-v2026.10.2",
  upstreamCommit: UPSTREAM.commit, sdkVersion: "0.2.0-main.1126", sdkCommit: "4a9eb239fa7f63132ad7a32cce9aeb5fae252243",
};
const NOTICE = renderNotice(TEMPLATE, NOTICE_VALUES);
const SDK_SOURCE = `gpl-source ${NOTICE_VALUES.sdkVersion} ${NOTICE_VALUES.sdkCommit}\n`;
const INTER = OTHER_MATERIAL.find((m) => m.licence === "inter-OFL.txt");
const TAILWIND = OTHER_MATERIAL.find((m) => m.package === "tailwindcss");
const FONT = "popup/fonts/inter.c504db5c06caaf7cdfba.woff2";
// Its preamble from the generator's one definition (review round 55 PR-MED-052: the checker holds it byte for byte).
const THIRD_PARTY = [
  thirdPartyPreamble(["@bitwarden/sdk-internal 0.2.0-main.1126", "rxjs 7.8.2"]),
  "==== @bitwarden/sdk-internal 0.2.0-main.1126 — licence: GPL-3.0 ====\n--- LICENSE ---\nGNU GENERAL PUBLIC LICENSE\n\n",
  "==== rxjs 7.8.2 — licence: Apache-2.0 ====\n--- LICENSE.txt ---\nApache License\n\n",
  `==== ${INTER.title} ====\n${INTER.text}\n\n${INTER_OFL.trimEnd()}\n\n`,
].join("");
// The checker's own rules (build/reviewed-images.tsv, build/notice/) are read beside it, so the fixture's one picture is
// the real Kount icon, which the real list names.
const ICON = readFileSync(join(HERE, "..", "assets", "apps", "browser", "src", "images", "icon16.png"));

/**
 * A header's checksum as GNU writes it (the unsigned byte sum with the field read as spaces, six octal digits, NUL,
 * space) — or `"nul"` / `"wrong"` to plant a bad one (round 47 PR-MED-037).
 */
function sealTarHeader(h, checksum) {
  h.fill(0x20, 148, 156);
  let sum = 0;
  for (const b of h) sum += b;
  if (checksum === "nul") h.fill(0, 148, 156);
  else h.write(`${(checksum === "wrong" ? sum + 1 : sum).toString(8).padStart(6, "0")}\0 `, 148, "latin1");
  return h;
}

/**
 * A tar archive (GNU, as build.sh writes it) of members { name, data, type } — type "0" a file (the default), "5" a
 * directory, anything else written as given; a name over 99 bytes gets GNU's long-name record first.
 */
function tar(members) {
  const blocks = [];
  const header = (name, size, type, fields = {}) => {
    const h = Buffer.alloc(512);
    h.write(name.slice(0, 100), 0, 100, "latin1"); // GNU: a long name's first 100 bytes in the member's own field
    h.write("0000644\0", 100);
    h.write("0000000\0", 108);
    h.write("0000000\0", 116);
    h.write(fields.size ?? `${size.toString(8).padStart(11, "0")}\0`, 124, "latin1");
    h.write("15122704400\0", 136);
    h.write(type, 156);
    h.write(fields.magic ?? "ustar  \0", 257, "latin1");
    return sealTarHeader(h, fields.checksum);
  };
  const block = (data) => [data, Buffer.alloc((512 - (data.length % 512)) % 512)];
  for (const { name, data = "", type = "0", headerName, fields } of members) {
    const bytes = Buffer.from(data);
    if (Buffer.byteLength(name) > 99) {
      const long = Buffer.from(`${name}\0`);
      blocks.push(header("././@LongLink", long.length, "L"), ...block(long));
    }
    blocks.push(header(headerName ?? name, bytes.length, type, fields), ...block(bytes));
  }
  return Buffer.concat([...blocks, Buffer.alloc(1024)]);
}

/**
 * The checker under test: a copy of the real kit (patches, overlay, assets, build) in a scratch checkout, the vault
 * suite's fence beside it as in a checkout — so its licence pins can name the fixtures' texts (no upstream licence text
 * is committed, so the real pins cannot be met offline; review round 46 PR-MED-031).
 */
const KIT = join(scratch, "repo", "apps", "kount-extension");
for (const d of ["patches", "overlay", "assets", "build"]) cpSync(join(HERE, "..", d), join(KIT, d), { recursive: true });
symlinkSync(join(HERE, "..", "..", "vaultwarden-kount"), join(scratch, "repo", "apps", "vaultwarden-kount"));
writeFileSync(join(KIT, "build", "notice", "licence-pins.tsv"),
  `browser-v2026.10.2\t./LICENSE_GPL.txt\t${sha(GPL_TEXT)}\nbrowser-v2026.10.2\t./LICENSE.txt\t${sha(UPSTREAM_NOTICE)}\n`);
const CHECKER = join(KIT, "build", "check-artefacts.sh");
// Two planted icon fonts, reviewed and pinned in the kit under test (round 46 PR-MED-033): a woff2 pinned to U+E900 and
// an SVG form pinned to U+E903 whose own glyph map names a shield at U+E902.
const BWI_WOFF2 = ["popup/fonts/bwi-font.0123abcd.woff2", Buffer.from("wOF2 planted icon font")];
const BWI_SVG = ["popup/fonts/bwi-font.0123abcd.svg", Buffer.from('<svg><font><glyph glyph-name="bitwarden-shield" unicode="&#xE902;" d="M0 0"/><glyph glyph-name="globe" unicode="&#xE904;" d="M0 0"/></font></svg>')];
writeFileSync(join(KIT, "build", "reviewed-images.tsv"), `${readFileSync(join(KIT, "build", "reviewed-images.tsv"), "utf8")}${sha(BWI_WOFF2[1])}\t${BWI_WOFF2[0]}\ta planted icon font\n${sha(BWI_SVG[1])}\t${BWI_SVG[0]}\ta planted icon font (SVG)\n`);
writeFileSync(join(KIT, "build", "shield-glyphs.tsv"), `${sha(BWI_WOFF2[1])}\t${BWI_WOFF2[0]}\tU+E900\n${sha(BWI_SVG[1])}\t${BWI_SVG[0]}\tU+E903\n`);

/**
 * A source archive as build.sh writes one (review rounds 46 PR-MED-030 and 48 PR-MED-042): the synthetic upstream's
 * files (less bitwarden_license/, the touched ones with Kount's bytes), what the kit under test requires, and the
 * upstream record.
 */
function archiveMembers(changelogText, kitRoot = KIT, lock = LOCK, proofs = false) {
  const { need } = archiveRequirements(kitRoot ?? KIT, { lock, changelog: changelogText }, { proofs });
  const texts = { "./kount-build/CHANGELOG.md": changelogText };
  const members = new Map();
  for (const [path, f] of UPSTREAM.files) if (!path.startsWith("./bitwarden_license/")) members.set(path, f.touched ? null : f.data);
  for (const [name, data] of need) members.set(name, texts[name] ?? data ?? members.get(name) ?? null);
  members.set(UPSTREAM_TREE_RECORD, UPSTREAM.record);
  return [...members].map(([name, data]) => ({ name, data: data ?? `planted ${name}\n` }));
}

/** A package's files; `over` replaces or (with undefined) removes a file. */
function pkg(target, { proofs = false, over = {} } = {}) {
  const manifest = {
    manifest_version: target === "firefox" ? 2 : 3,
    name: "__MSG_extName__",
    short_name: "Kount Protect",
    version: VERSION,
    ...(target === "firefox"
      ? { browser_specific_settings: { gecko: { id: "kount-protect@kount.com.au", strict_min_version: "140.0", data_collection_permissions: { required: [...DECLARED].reverse() } } } }
      : {}),
  };
  const vault = proofs ? "https://127.0.0.1:8100" : "https://vault.kount.com.au";
  const protect = proofs ? "http://127.0.0.1:8180" : "https://protect.kount.com.au";
  const files = {
    "manifest.json": JSON.stringify(manifest),
    "_locales/en/messages.json": JSON.stringify({ extName: { message: "Kount Protect" } }, null, 2),
    "background.js": `e.setEnvironment(nw.SelfHosted,{base:"${vault}"});const p=E$.listen(chrome.webRequest,"${protect}");e.set("Bitwarden-Client-Name",x);`,
    // The page marker's bundle as webpack writes it (unminified): the constant once, its one use (plan T1.4).
    "content/kount-protect-marker.js": `const KOUNT_PROTECT_ORIGIN = "${protect}";\nstartMarker(window, KOUNT_PROTECT_ORIGIN, chrome.runtime);\n`,
    // The About dialog's two paragraphs as Angular compiles them, then the import list (review round 54 PR-MED-049: the
    // good packages carry the approved attribution line, as a real build does).
    "popup/main.js": `x.SpI("© Bitwarden Inc. 2015-",t.year);te.j41(8,"p"),te.EFF(9,${ABOUT_LINE}),te.k0s();const n={bitwarden:{displayName:"Bitwarden",formats:["bitwardencsv"]}};this.l.redirectToSsoLoginWithOrganizationSsoIdentifier("","kount");`,
    "assets/sdk.wasm": GPL_WASM,
    "images/icon16.png": ICON,
    "LICENSE.txt": GPL_TEXT,
    "LICENSE-UPSTREAM.txt": UPSTREAM_NOTICE,
    "NOTICE.txt": NOTICE,
    "THIRD-PARTY-NOTICES.txt": THIRD_PARTY,
    ...(proofs ? { "background.js.map": '{"sources":["webpack://x/a.ts"]}' } : {}),
  };
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) delete files[k];
    else files[k] = typeof v === "function" ? v(files[k]) : v;
  }
  return files;
}

let n = 0;
/** Write an output directory and an app directory; run the checker. */
function run({ mode, targets = ["chrome", "edge", "firefox"], proofs = mode === "--proofs", over = {}, plant = () => {}, status, readme = README, sdk, changelogText, archive = (m) => m, kitRoot, lock = LOCK, record = "packages" } = {}) {
  const dir = join(scratch, `out-${n}`);
  const app = join(scratch, `app-${n++}`);
  mkdirSync(dir, { recursive: true });
  mkdirSync(app, { recursive: true });
  const changelogWritten = changelogText ?? (status === null ? "# Changelog\n" : changelog(status));
  writeFileSync(join(app, "README.md"), readme);
  writeFileSync(join(app, "CHANGELOG.md"), changelogWritten);
  writeFileSync(join(app, "upstream.lock"), lock);
  const names = [];
  // The build's notices record (round 46 PR-MED-032): by default what each planted package carries, as a build writes
  // both; `record: "fixture"` records the good fixture's notices instead, so a package's changed notices differ from it.
  let noticeLines = "";
  for (const t of targets) {
    const name = `kount-protect-${t}.zip`;
    const files = pkg(t, { proofs, over: over[t] ?? {} });
    writeFileSync(join(dir, name), zip(files));
    names.push(name);
    const recorded = record === "fixture" ? THIRD_PARTY : files["THIRD-PARTY-NOTICES.txt"];
    if (recorded !== undefined) noticeLines += noticeSections(recorded).map((s) => `notice ${t} ${sha(s.text)} ${s.key}\n`).join("");
  }
  writeFileSync(join(dir, "kount-protect-source.tar.gz"), zlib.gzipSync(tar(archive([{ name: "./", type: "5" }, ...archiveMembers(changelogWritten, kitRoot, lock, proofs)]))));
  writeFileSync(join(dir, "sdk-hashes.txt"), sdk ?? `gpl ${sha(GPL_WASM)} node_modules/@bitwarden/sdk-internal/x.wasm\n${SDK_SOURCE}commercial ${sha(COMMERCIAL_WASM)} node_modules/@bitwarden/commercial-sdk-internal/x.wasm\n${noticeLines}`);
  names.push("kount-protect-source.tar.gz", "sdk-hashes.txt");
  writeFileSync(join(dir, "SHA256SUMS"), names.map((f) => `${sha(readFileSync(join(dir, f)))}  ${f}\n`).join(""));
  plant(dir);
  const r = spawnSync("bash", [CHECKER, ...(mode ? [mode] : []), "--app-dir", app, dir], { encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr, dir, app };
}
const passes = (r) => {
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /packages checked, 0 problems\.$/m);
};
const fails = (r, re) => {
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(r.out, re);
};
const reseal = (dir) => {
  const names = readFileSync(join(dir, "SHA256SUMS"), "utf8").split("\n").filter(Boolean).map((l) => l.slice(66));
  writeFileSync(join(dir, "SHA256SUMS"), names.map((f) => `${sha(readFileSync(join(dir, f)))}  ${f}\n`).join(""));
};

describe("the good builds", () => {
  test("a store build passes, three packages", () => {
    const r = run();
    passes(r);
    assert.match(r.out, /3 packages checked/);
  });
  test("a proofs build of one target passes", () => passes(run({ mode: "--proofs", targets: ["chrome"] })));
  // Plan T1.4 (s1e2): what the real background now holds — the vault base read twice, kept as one const and named.
  const named = (base) => (b) => b.replace(`{base:"${base}"}`, "{base:v$}") + `const v$="${base}";function b$(e){return e===v$}`;
  test("a store build whose vault site names the one const holding it passes", () => {
    const over = Object.fromEntries(["chrome", "edge", "firefox"].map((t) => [t, { "background.js": named("https://vault.kount.com.au") }]));
    passes(run({ over }));
  });
  test("a proofs build whose vault site names the one const holding it passes", () =>
    passes(run({ mode: "--proofs", targets: ["chrome"], over: { chrome: { "background.js": named("https://127.0.0.1:8100") } } })));
  // Round 11 PR-MED-056: the popup's form — the identifier a later declarator of the build constants' one `const`.
  test("an SSO site naming a later declarator of a const list passes", () => {
    const list = (b) => b.replace('("","kount")', '("",Vo)') + 'const Wo="https://vault.kount.com.au",Vo="kount";';
    passes(run({ over: Object.fromEntries(["chrome", "edge", "firefox"].map((t) => [t, { "popup/main.js": list }])) }));
  });
  test("a release passes once its entry is a release and the placeholder is gone", () => passes(run({ mode: "--release", status: "release" })));
  test("a release refuses a candidate entry", () => fails(run({ mode: "--release", status: "candidate" }), /is a candidate: a candidate is never a release artefact/));
  test("a missing changelog entry is refused in every mode", () => {
    for (const mode of [undefined, "--release", "--proofs"]) fails(run({ mode, status: null }), /ARTEFACT_PROBLEM changelog: no-entry/);
  });
});

describe("each rule, planted", () => {
  const firefox = (over) => ({ firefox: over });
  const chrome = (over) => ({ chrome: over });
  const CASES = [
    ["a wrong name", {}, chrome({ "_locales/en/messages.json": JSON.stringify({ extName: { message: "Bitwarden Password Manager" } }) }), /the name reads "Bitwarden Password Manager"/],
    ["a wrong short_name", {}, chrome({ "manifest.json": (m) => m.replace('"short_name":"Kount Protect"', '"short_name":"Bitwarden"') }), /short_name reads "Bitwarden"/],
    ["a wrong version", {}, chrome({ "manifest.json": (m) => m.replace(VERSION, "2026.10.2") }), /version "2026\.10\.2", the top CHANGELOG\.md entry says 2026\.10\.2\.1/],
    ["a wrong Firefox id", {}, firefox({ "manifest.json": (m) => m.replace("kount-protect@kount.com.au", "{446900e4-71c2-419f-a6a7-df9c091e268b}") }), /the Firefox id reads/],
    ["no data_collection_permissions", {}, firefox({ "manifest.json": (m) => m.replace(/,"data_collection_permissions":\{[^}]*\}/, "") }), /no browser_specific_settings\.gecko\.data_collection_permissions/],
    // Review round 13 PR-MED-011: exactly the README's declaration — the good fixture lists it in another order.
    ...[
      ["an unknown data category", (r) => r.map((c) => (c === "authenticationInfo" ? "everything" : c))],
      ["fewer categories than declared", (r) => r.filter((c) => c !== "browsingActivity")],
      ["one more category than declared", (r) => [...r, "websiteContent"]],
      ["`none` alone", () => ["none"]],
      ["a duplicate standing in for a missing category", (r) => [...r.filter((c) => c !== "browsingActivity"), "authenticationInfo"]],
      ["an empty required list", () => []],
    ].map(([title, edit]) => [
      `a Firefox declaration with ${title}`, {},
      firefox({ "manifest.json": (m) => { const j = JSON.parse(m); j.browser_specific_settings.gecko.data_collection_permissions.required = edit(j.browser_specific_settings.gecko.data_collection_permissions.required); return JSON.stringify(j); } }),
      title === "an empty required list" ? /no browser_specific_settings\.gecko\.data_collection_permissions\.required/ : /data_collection_permissions\.required .* is not the README's declaration/,
    ]),
    ["a Firefox declaration with an optional category", {}, firefox({ "manifest.json": (m) => { const j = JSON.parse(m); j.browser_specific_settings.gecko.data_collection_permissions.optional = ["technicalAndInteraction"]; return JSON.stringify(j); } }), /data_collection_permissions\.optional .*: the README declares required categories only/],
    ["a README without its data collection line", { readme: "# x\n\n- Name: `Kount Protect`\n- Firefox id: `kount-protect@kount.com.au`\n" }, {}, /README identity: want exactly one "- Firefox data collection: `…`" line, found 0/],
    ["a README declaring `none`", { readme: `${README.replace(/- Firefox data collection: .*\n/, "- Firefox data collection: `none`\n")}` }, {}, /the Firefox data collection line names a duplicate or a category Mozilla does not \(none\)/],
    ["a Chromium package on Manifest V2", {}, chrome({ "manifest.json": (m) => m.replace('"manifest_version":3', '"manifest_version":2') }), /manifest_version 2/],
    // Plan T3.6: Firefox's lowest version and no update address of Kount's own (T3.5 chose addons.mozilla.org).
    ...[["upstream's 91.0", "91.0"], ["a lower 139.0", "139.0"], ["a higher 141.0", "141.0"], ["140 without its .0", "140"]].map(([what, v]) => [`a Firefox strict_min_version of ${what}`, {}, firefox({ "manifest.json": (m) => m.replace('"strict_min_version":"140.0"', `"strict_min_version":"${v}"`) }), new RegExp(`the Firefox strict_min_version reads "${v.replace(/\./g, "\\.")}", want "140\\.0"`)]),
    ["a Firefox package with no strict_min_version", {}, firefox({ "manifest.json": (m) => m.replace('"strict_min_version":"140.0",', "") }), /the Firefox strict_min_version reads undefined, want "140\.0"/],
    ["the deprecated applications alias carrying an update address", {}, firefox({ "manifest.json": (m) => m.replace(/^\{/, '{"applications":{"gecko":{"update_url":"https://protect.kount.com.au/updates.json"}},') }), /an applications key \(Firefox's deprecated alias of browser_specific_settings\)/],
    ["a gecko update_url", {}, firefox({ "manifest.json": (m) => m.replace('"strict_min_version":"140.0",', '"strict_min_version":"140.0","update_url":"https://protect.kount.com.au/updates.json",') }), /a gecko update_url \("https:\/\/protect\.kount\.com\.au\/updates\.json"\)/],
    ...["chrome", "edge", "firefox"].map((t) => [`a top-level update_url in the ${t} package`, {}, { [t]: { "manifest.json": (m) => m.replace(/^\{/, '{"update_url":"https://example.invalid/u.xml",') } }, new RegExp(`kount-protect-${t}\\.zip: an update_url \\("https://example\\.invalid/u\\.xml"\\)`)]),
    ["loopback constants in a store package (E21)", {}, chrome({ "background.js": (b) => b.replace("https://vault.kount.com.au", "https://127.0.0.1:8100") }), /the vault constant is "https:\/\/127\.0\.0\.1:8100": a store package carries https:\/\/vault\.kount\.com\.au/],
    ["a production constant in a proofs package (E21)", { mode: "--proofs", targets: ["chrome"] }, chrome({ "background.js": (b) => b.replace("http://127.0.0.1:8180", "https://protect.kount.com.au") }), /the protect constant is "https:\/\/protect\.kount\.com\.au": a proofs package points at loopback/],
    ["a constant's use site missing", {}, chrome({ "background.js": (b) => b.replace(".listen(chrome.webRequest", ".listen(webRequest") }), /the protect constant's use site was found 0 times/],
    ["a constant's use site twice", {}, chrome({ "background.js": (b) => `${b};a.SelfHosted,{base:"https://vault.kount.com.au"}` }), /the vault constant's use site was found 2 times in background\.js/],
    // Round 11 PR-MED-056: each site in the bundle that runs it, and only there.
    ["the vault site in the wrong bundle", {}, chrome({ "popup/main.js": (b) => `${b};a.SelfHosted,{base:"https://vault.kount.com.au"}` }), /the vault constant's use site is in popup\/main\.js: it belongs in background\.js alone/],
    ["the SSO site moved out of the popup", {}, chrome({ "popup/main.js": (b) => b.replace('this.l.redirectToSsoLoginWithOrganizationSsoIdentifier("","kount");', ""), "background.js": (b) => `${b}this.l.redirectToSsoLoginWithOrganizationSsoIdentifier("","kount");` }), /the sso constant's use site is in background\.js: it belongs in popup\/main\.js alone/],
    ["a named site whose only same-named string is a let", {}, chrome({ "background.js": (b) => b.replace('{base:"https://vault.kount.com.au"}', "{base:v$}") + 'let v$="https://vault.kount.com.au";' }), /the vault constant's use site reads v\$, which its file defines as a string 0 times/],
    ["a named site whose only same-named string is an assignment", {}, chrome({ "background.js": (b) => b.replace('{base:"https://vault.kount.com.au"}', "{base:v$}") + 'function f(){v$="https://vault.kount.com.au"}' }), /the vault constant's use site reads v\$, which its file defines as a string 0 times/],
    ["the marker's call only in a comment", {}, chrome({ "content/kount-protect-marker.js": (b) => b.replace("startMarker(window, KOUNT_PROTECT_ORIGIN, chrome.runtime);", "// startMarker(window, KOUNT_PROTECT_ORIGIN, chrome.runtime);") }), /the marker's origin was found 1 times and its call 0 times/],
    ["the marker's origin only in a comment", {}, chrome({ "content/kount-protect-marker.js": (b) => b.replace('const KOUNT_PROTECT_ORIGIN = "https://protect.kount.com.au";', '/* const KOUNT_PROTECT_ORIGIN = "https://protect.kount.com.au"; */') }), /the marker's origin was found 0 times and its call 1 times/],
    // Plan T1.4 (s1e2): a bundle that reads the vault base twice keeps it as ONE const, and the site names it.
    ["a site naming a const defined twice", {}, chrome({ "background.js": (b) => b.replace('{base:"https://vault.kount.com.au"}', "{base:v$}") + 'const v$="https://vault.kount.com.au";function g(){const v$="https://vault.example.com"}' }), /the vault constant's use site reads v\$, which its file defines as a string 2 times/],
    ["a site naming a const never defined", {}, chrome({ "background.js": (b) => b.replace('{base:"https://vault.kount.com.au"}', "{base:v$}") }), /the vault constant's use site reads v\$, which its file defines as a string 0 times/],
    ["a site naming a const holding another address", {}, chrome({ "background.js": (b) => b.replace('{base:"https://vault.kount.com.au"}', "{base:v$}") + 'const v$="https://vault.example.com";' }), /the vault constant is "https:\/\/vault\.example\.com": a store package carries https:\/\/vault\.kount\.com\.au/],
    // Plan T1.3: the SSO identifier, the third constant (the sign-in screen's e-mail-less call).
    ["no e-mail-less SSO call", {}, chrome({ "popup/main.js": (b) => b.replace('redirectToSsoLoginWithOrganizationSsoIdentifier("","kount")', 'redirectToSsoLogin("")') }), /the sso constant's use site was found 0 times/],
    ["the e-mail-less SSO call twice", {}, firefox({ "popup/main.js": (b) => `${b}a.redirectToSsoLoginWithOrganizationSsoIdentifier("","kount");` }), /the sso constant's use site was found 2 times/],
    ["another SSO identifier", {}, chrome({ "popup/main.js": (b) => b.replace('("","kount")', '("","acme")') }), /the sso constant is "acme": every package carries "kount"/],
    ["another SSO identifier in a proofs package", { mode: "--proofs", targets: ["chrome"] }, chrome({ "popup/main.js": (b) => b.replace('("","kount")', '("","acme")') }), /the sso constant is "acme": every package carries "kount"/],
    ["upstream's own SSO call with an e-mail is not the site", {}, chrome({ "popup/main.js": (b) => `${b}a.redirectToSsoLoginWithOrganizationSsoIdentifier(n,t.ssoOrganizationIdentifier);` }), null],
    ["a proofs site naming a const holding the production address", { mode: "--proofs", targets: ["chrome"] }, chrome({ "background.js": (b) => b.replace('{base:"https://127.0.0.1:8100"}', "{base:v$}") + 'const v$="https://vault.kount.com.au";' }), /the vault constant is "https:\/\/vault\.kount\.com\.au": a proofs package points at loopback/],
    // Plan T1.4: the page marker's bundle, the origin's second checked consumer (Decision 6, E55).
    ...["chrome", "edge", "firefox"].map((t) => [`no marker bundle in the ${t} package`, {}, { [t]: { "content/kount-protect-marker.js": undefined } }, new RegExp(`kount-protect-${t}\\.zip: no content/kount-protect-marker\\.js: the page marker's bundle is missing`)]),
    ["a marker bundle with another origin than the background's", {}, firefox({ "content/kount-protect-marker.js": (b) => b.replace("https://protect.kount.com.au", "https://protect.example.com") }), /the marker's origin is "https:\/\/protect\.example\.com", the background's "https:\/\/protect\.kount\.com\.au"/],
    ["a proofs marker bundle still carrying the production origin", { mode: "--proofs", targets: ["chrome"] }, chrome({ "content/kount-protect-marker.js": (b) => b.replace("http://127.0.0.1:8180", "https://protect.kount.com.au") }), /the marker's origin is "https:\/\/protect\.kount\.com\.au", the background's "http:\/\/127\.0\.0\.1:8180"/],
    ["a marker bundle carrying the origin twice", {}, chrome({ "content/kount-protect-marker.js": (b) => `${b}const KOUNT_PROTECT_ORIGIN = "https://protect.kount.com.au";\n` }), /the marker's origin was found 2 times and its call 1 times/],
    ["a marker bundle that never starts the marker", {}, chrome({ "content/kount-protect-marker.js": (b) => b.replace("startMarker(", "noMarker(") }), /the marker's origin was found 1 times and its call 0 times/],
    ["the commercial SDK's module", {}, chrome({ "assets/sdk.wasm": COMMERCIAL_WASM }), /assets\/sdk\.wasm is the commercial SDK's module/],
    ["an unknown module", {}, chrome({ "assets/sdk.wasm": Buffer.from("\0asm other") }), /is no GPL SDK module/],
    ["no module at all", {}, chrome({ "assets/sdk.wasm": undefined }), /no \.wasm module/],
    ["a bitwarden_license path in the code", {}, chrome({ "popup/main.js": (b) => `${b}//bitwarden_license/bit-browser/x` }), /popup\/main\.js names bitwarden_license/],
    ["the commercial SDK named in the code", {}, chrome({ "background.js": (b) => `${b}require("@bitwarden/commercial-sdk-internal")` }), /background\.js names the commercial SDK/],
    // Plan T3.8: the marks.
    ["a picture nobody reviewed", {}, chrome({ "popup/images/logo-dark@2x.png": Buffer.from("\x89PNG wordmark") }), /popup\/images\/logo-dark@2x\.png \([0-9a-f]{12}…\) is a picture or font build\/reviewed-images\.tsv does not name with this hash/],
    ["a reviewed picture changed", {}, chrome({ "images/icon16.png": Buffer.from("\x89PNG a new shield") }), /images\/icon16\.png \([0-9a-f]{12}…\) is a picture or font/],
    ["a reviewed picture at another path", {}, chrome({ "images/icon16.png": undefined, "images/icon19.png": ICON }), /images\/icon19\.png .* is a picture or font/],
    ["an SVG nobody reviewed", {}, chrome({ "popup/images/close.svg": "<svg/>" }), /popup\/images\/close\.svg .* is a picture or font/],
    ["a font nobody reviewed", {}, chrome({ "popup/fonts/other.0123abcd.woff2": Buffer.from("wOF2") }), /popup\/fonts\/other\.0123abcd\.woff2 .* is a picture or font/],
    ["Bitwarden's shield path data in a script", {}, chrome({ "popup/main.js": (b) => `${b}const s='<path d="M12.66.175A.566.566 0 0 0 12.248 0"/>';` }), /popup\/main\.js draws Bitwarden's shield or wordmark \(path data "M12\.66\.175A\.566\.566"\)/],
    ["the wordmark's path data in a page", {}, chrome({ "notification/bar.html": '<svg><path d="M47.948 7.444c0 1"/></svg>' }), /notification\/bar\.html draws Bitwarden's shield or wordmark/],
    ["the shield glyph drawn by a script", {}, chrome({ "popup/main.js": (b) => `${b}["aria-hidden","true",1,"bwi","bwi-shield","bwi-3x"]` }), /popup\/main\.js draws the icon font's Bitwarden shield glyph \(bwi-shield\)/],
    ["the other shield glyph drawn by a page", {}, chrome({ "popup/index.html": '<i class="bwi bwi-bitwarden-shield"></i>' }), /popup\/index\.html draws the icon font's Bitwarden shield glyph \(bwi-bitwarden-shield\)/],
    ["the glyph defined in the stylesheet passes (nothing draws it)", {}, chrome({ "popup/main.css": ".bwi-shield:before{content:\"\\e900\"}" }), null],
    ["the glyph drawn by its code point in a script", {}, chrome({ "popup/main.css": ".bwi-shield:before{content:\"\\e900\"}", "popup/main.js": (b) => `${b}el.textContent="\\ue900";` }), /popup\/main\.js names the shield glyph's code point U\+E900 outside its definitions/],
    ["the glyph's character itself in a page", {}, chrome({ "popup/main.css": ".bwi-bitwarden-shield:before{content:\"\ue900\"}", "popup/index.html": "<i class=\"bwi\">\ue900</i>" }), /popup\/index\.html names the shield glyph's code point U\+E900/],
    ["the glyph's code point in a second stylesheet rule", {}, chrome({ "popup/main.css": ".bwi-shield:before{content:\"\\e900\"}.brand:after{content:\"\\e900\"}" }), /popup\/main\.css names the shield glyph's code point U\+E900 outside its definitions/],
    // Review round 46 PR-MED-033: the reviewed icon font keeps the rule on with no CSS definition at all.
    ["the font's shield drawn literally, every CSS definition gone", {}, chrome({ [BWI_WOFF2[0]]: BWI_WOFF2[1], "popup/index.html": "<i class=\"bwi\">\ue900</i>" }), /popup\/index\.html names the shield glyph's code point U\+E900 outside its definitions/],
    ["the font's shield by an entity, every CSS definition gone", {}, chrome({ [BWI_WOFF2[0]]: BWI_WOFF2[1], "popup/index.html": "<i class=\"bwi\">&#xe900;</i>" }), /popup\/index\.html names the shield glyph's code point U\+E900/],
    ["the font's shield through an alias selector", {}, chrome({ [BWI_WOFF2[0]]: BWI_WOFF2[1], "popup/main.css": ".brand:after{content:\"\\e900\"}" }), /popup\/main\.css names the shield glyph's code point U\+E900 outside its definitions/],
    ["the SVG font's own shield glyph, whatever its pin says", {}, chrome({ [BWI_SVG[0]]: BWI_SVG[1], "popup/main.js": (b) => `${b}el.textContent="\\ue902";` }), /popup\/main\.js names the shield glyph's code point U\+E902/],
    // Review round 47 PR-MED-038: every static spelling, by syntax, with the whole run compared.
    ...[
      ["a JS escape followed by a hex letter", "popup/main.js", (b) => `${b}el.textContent="\\ue900A";`],
      ["a JS escape followed by a digit", "popup/main.js", (b) => `${b}el.textContent="\\ue9000";`],
      ["a JSON escape in capitals followed by a letter", "popup/main.js", (b) => `${b}const g=JSON.parse('{"g":"\\uE900B"}');`],
      ["a braced JS escape", "popup/main.js", (b) => `${b}el.textContent="\\u{0e900}";`],
      ["fromCharCode with the point among several arguments", "popup/main.js", (b) => `${b}el.textContent=String.fromCharCode(0xe900,65);`],
      ["fromCodePoint with the point second, in decimal", "popup/main.js", (b) => `${b}el.textContent=String.fromCodePoint(65, 59648);`],
      ["fromCharCode in octal", "popup/main.js", (b) => `${b}el.textContent=String.fromCharCode(0o164400);`],
    ].map(([title, file, edit]) => [`the font's shield by ${title}`, {}, chrome({ [BWI_WOFF2[0]]: BWI_WOFF2[1], [file]: edit }), /names the shield glyph's code point U\+E900 outside its definitions/]),
    ["an entity of a longer code point passes (&#xe900a; is not U+E900)", {}, chrome({ [BWI_WOFF2[0]]: BWI_WOFF2[1], "popup/index.html": "<i>&#xe900a;</i>" }), null],
    ["a CSS escape of a longer code point passes (\\e900a is not U+E900)", {}, chrome({ [BWI_WOFF2[0]]: BWI_WOFF2[1], "popup/main.css": ".x:before{content:\"\\e900a\"}" }), null],
    // Review round 48 PR-MED-040: the point searched for in decoded text; call arguments read in one literal grammar and
    // converted as each API converts them.
    ...[
      ["a JS escape followed by a low-surrogate escape", (b) => `${b}el.textContent="\\ue900\\udc00";`],
      ["fromCharCode past 16 bits (0x1e900 is U+E900 to it)", (b) => `${b}el.textContent=String.fromCharCode(0x1e900);`],
      ["fromCharCode wrapping a negative number", (b) => `${b}el.textContent=String.fromCharCode(-5888);`],
      ["fromCodePoint with a fraction", (b) => `${b}el.textContent=String.fromCodePoint(59648.0);`],
      ["fromCodePoint with an exponent", (b) => `${b}el.textContent=String.fromCodePoint(5.9648e4);`],
      ["fromCharCode with a fraction", (b) => `${b}el.textContent=String.fromCharCode(59648.0);`],
      ["fromCharCode with a separator", (b) => `${b}el.textContent=String.fromCharCode(0x1_e900);`],
      ["fromCharCode with a decimal string", (b) => `${b}el.textContent=String.fromCharCode("59648");`],
      ["fromCharCode with a hex string", (b) => `${b}el.textContent=String.fromCharCode('0xe900');`],
      ["a CSS escape inside a JS string", (b) => `${b}el.style.setProperty("content",'"\\\\e900"');`],
      ["a JSON escape inside a JS string", (b) => `${b}el.textContent=JSON.parse('"\\\\ue900"');`],
    ].map(([title, edit]) => [`the font's shield by ${title}`, {}, chrome({ [BWI_WOFF2[0]]: BWI_WOFF2[1], "popup/main.js": edit }), /popup\/main\.js names the shield glyph's code point U\+E900 outside its definitions/]),
    ...[
      ["a genuine surrogate pair (another code point)", (b) => `${b}el.textContent="\\ud83d\\ude00";`],
      ["fromCodePoint(0x1e900) (U+1E900, not U+E900)", (b) => `${b}el.textContent=String.fromCodePoint(0x1e900);`],
      ["fromCharCode's surrogate pair for U+1E900", (b) => `${b}el.textContent=String.fromCharCode(0xd83a,0xdd00);`],
      ["fromCodePoint with a fraction that throws", (b) => `${b}el.textContent=String.fromCodePoint(59648.5);`],
      // The documented limit: arguments outside the literal grammar are computed input, not read.
      ["fromCharCode over an array (outside the grammar: the documented limit)", (b) => `${b}el.textContent=String.fromCharCode([59648]);`],
      ["fromCharCode.apply (outside the grammar: the documented limit)", (b) => `${b}el.textContent=String.fromCharCode.apply(null,[0xe900]);`],
      ["fromCharCode with a spread (outside the grammar: the documented limit)", (b) => `${b}el.textContent=String.fromCharCode(...[0xe900]);`],
    ].map(([title, edit]) => [`${title} passes`, {}, chrome({ [BWI_WOFF2[0]]: BWI_WOFF2[1], "popup/main.js": edit }), null]),
    // Review round 49 PR-MED-043: a string argument with an escaped white space around the number — both APIs, every
    // escape JavaScript's Number reads as white space, each quote — draws the glyph; `\b` is not white space.
    ...["fromCharCode", "fromCodePoint"].flatMap((api) => ["\\n", "\\t", "\\r", "\\v", "\\f"].flatMap((esc) => [
      [`${api} with "59648${esc}"`, (b) => `${b}el.textContent=String.${api}("59648${esc}");`],
      [`${api} with '${esc}59648'`, (b) => `${b}el.textContent=String.${api}('${esc}59648');`],
      [`${api} with \`59648${esc}\``, (b) => `${b}el.textContent=String.${api}(\`59648${esc}\`);`],
    ])).map(([title, edit]) => [`the font's shield by ${title}`, {}, chrome({ [BWI_WOFF2[0]]: BWI_WOFF2[1], "popup/main.js": edit }), /popup\/main\.js names the shield glyph's code point U\+E900 outside its definitions/]),
    ...["fromCharCode", "fromCodePoint"].map((api) => [`${api} with "59648\\b" passes (not white space: NaN to JavaScript too)`, {}, chrome({ [BWI_WOFF2[0]]: BWI_WOFF2[1], "popup/main.js": (b) => `${b}el.textContent=String.${api}("59648\\b");` }), null]),
    // Review round 50 PR-MED-046: a CRLF line continuation (real bytes) in a quoted argument, before, within and after
    // the number — both APIs, both quote forms — draws the glyph; a raw CR (JavaScript refuses the file) draws nothing.
    ...(() => {
      const CRLF = String.fromCharCode(92, 13, 10);
      return ["fromCharCode", "fromCodePoint"].flatMap((api) => [['"', "double"], ["'", "single"]].flatMap(([q, name]) => [
        ["before", `${CRLF}59648`], ["within", `596${CRLF}48`], ["after", `59648${CRLF}`],
      ].map(([where, body]) => [`the font's shield by ${api} with a CRLF continuation ${where} the number, ${name}-quoted`, {}, chrome({ [BWI_WOFF2[0]]: BWI_WOFF2[1], "popup/main.js": (b) => `${b}el.textContent=String.${api}(${q}${body}${q});` }), /popup\/main\.js names the shield glyph's code point U\+E900 outside its definitions/])));
    })(),
    // Review round 51: each former bound, through a package — at, just past and well past it.
    ...[4, 5, 40].flatMap((zeros) => [
      [`the font's shield by a braced escape with ${zeros} leading zeroes`, (b) => `${b}el.textContent="\\u{${"0".repeat(zeros)}e900}";`],
      [`the font's shield by a call argument whose digit is a braced escape with ${zeros} leading zeroes`, (b) => `${b}el.textContent=String.fromCharCode("\\u{${"0".repeat(zeros)}35}9648");`],
    ]).map(([title, edit]) => [title, {}, chrome({ [BWI_WOFF2[0]]: BWI_WOFF2[1], "popup/main.js": edit }), /popup\/main\.js names the shield glyph's code point U\+E900 outside its definitions/]),
    ...[63, 64, 65, 200].map((n) => [`the font's shield by a call with a trailing comma then ${n} spaces`, {}, chrome({ [BWI_WOFF2[0]]: BWI_WOFF2[1], "popup/main.js": (b) => `${b}el.textContent=String.fromCharCode(0xe900,${" ".repeat(n)});` }), /popup\/main\.js names the shield glyph's code point U\+E900 outside its definitions/]),
    ...[[1005, "at the former bound"], [1006, "just past it"], [5000, "well past it"]].map(([n, where]) => [`a PNG data: URL whose head is ${n + 19} characters (${where})`, {}, chrome({ "popup/index.html": `<img src="data:image/png;x=${"a".repeat(n)};base64,iVBORw0KGgo=">` }), /popup\/index\.html embeds a image\/png .* does not name under popup\/index\.html#embedded/]),
    ["a PNG data: URL whose head is padded with 1,100 tabs", {}, chrome({ "popup/index.html": `<img src="data:image/png${String.fromCharCode(9).repeat(1100)};base64,iVBORw0KGgo=">` }), /popup\/index\.html embeds a image\/png .* does not name under popup\/index\.html#embedded/],
    ["an undecodable base64 payload behind a 5,019-character head", {}, chrome({ "popup/index.html": `<img src="data:image/png;x=${"a".repeat(5000)};base64,iVBOR*w0K">` }), /popup\/index\.html holds a base64 data: URL whose payload does not decode/],
    ["a raw CR in a quoted argument passes (no engine runs it; nothing is drawn)", {}, chrome({ [BWI_WOFF2[0]]: BWI_WOFF2[1], "popup/main.js": (b) => `${b}el.textContent=String.fromCharCode("59648${String.fromCharCode(13)}");` }), null],
    ["an icon font no glyph pin names", {}, chrome({ "popup/fonts/bwi-font.feedface.ttf": Buffer.from("planted ttf") }), /popup\/fonts\/bwi-font\.feedface\.ttf is an icon font build\/shield-glyphs\.tsv does not name/],
    ["the pinned font present and unused passes", {}, chrome({ [BWI_WOFF2[0]]: BWI_WOFF2[1] }), null],
    ["a raster picture embedded in a script", {}, chrome({ "popup/main.js": (b) => `${b}const logo="data:image/png;base64,iVBORw0KGgo=";` }), /popup\/main\.js embeds a image\/png \([0-9a-f]{12}…\) build\/reviewed-images\.tsv does not name under popup\/main\.js#embedded/],
    ["a base64 SVG embedded in a stylesheet", {}, chrome({ "popup/main.css": ".x{background:url(data:image/svg+xml;base64,PHN2Zz4=)}" }), /popup\/main\.css embeds a image\/svg\+xml .* does not name under popup\/main\.css#embedded/],
    ["a font embedded in a stylesheet", {}, chrome({ "popup/main.css": "@font-face{src:url(data:font/woff2;charset=utf-8;base64,d09GMg==)}" }), /popup\/main\.css embeds a font\/woff2 .* does not name under popup\/main\.css#embedded/],
    ["an unencoded raster picture", {}, chrome({ "popup/main.js": (b) => `${b}const logo="data:image/png,%89PNG";` }), /popup\/main\.js embeds a image\/png \([0-9a-f]{12}…\) build\/reviewed-images\.tsv does not name under popup\/main\.js#embedded/],
    // Review round 48 PR-MED-041: one classifier for every data: URL, whatever the case of its scheme, type or marker.
    ...[["image/png", "iVBORw0KGgo="], ["image/svg+xml", "PHN2Zz4="], ["font/woff2", "d09GMg=="]].flatMap(([type, payload]) => [
      ["the scheme in capitals", `DATA:${type};base64,${payload}`],
      ["the type in capitals", `data:${type.toUpperCase()};base64,${payload}`],
      ["the marker in capitals", `data:${type};BASE64,${payload}`],
      ["a parameter, then a mixed-case marker", `data:${type};charset=x;BaSe64,${payload}`],
    ].flatMap(([how, url]) => [
      ["popup/main.css", () => `.x{background:url("${url}")}`],
      ["popup/index.html", () => `<img src="${url}">`],
      ["popup/main.js", (b) => `${b}const u="${url}";`],
    ].map(([file, edit]) => [`a ${type} data: URL with ${how}, in ${file}`, {}, chrome({ [file]: edit }), new RegExp(`${file.replace(/[./]/g, "\\$&")} embeds a ${type.replace(/[+/]/g, "\\$&")} \\([0-9a-f]{12}…\\) build/reviewed-images\\.tsv does not name under ${file.replace(/[./]/g, "\\$&")}#embedded`)]))),
    ...[
      ["a PNG under no media type", 'data:;base64,iVBORw0KGgo='],
      ["a PNG under a type that is not one", 'data:x;base64,iVBORw0KGgo='],
      ["a PNG under application/octet-stream", 'data:application/octet-stream;base64,iVBORw0KGgo='],
    ].map(([title, url]) => [`${title} (known by its bytes)`, {}, chrome({ "popup/main.js": (b) => `${b}const u="${url}";` }), /popup\/main\.js embeds a picture \(by its bytes; declared (text\/plain|application\/octet-stream)\) \([0-9a-f]{12}…\) build\/reviewed-images\.tsv does not name/]),
    ["a base64 payload with white space and percent-escapes", {}, chrome({ "popup/main.css": ".x{background:url(\"data:image/png;base64,iVBO%52w0K Ggo=\")}" }), /popup\/main\.css embeds a image\/png .* does not name under popup\/main\.css#embedded/],
    ["a base64 payload that does not decode", {}, chrome({ "popup/main.js": (b) => `${b}const u="data:image/png;base64,iVBOR*w0K";` }), /popup\/main\.js holds a base64 data: URL whose payload does not decode \(data:image\/png;base64,…\)/],
    ["a data: URL spelled with JS escapes", {}, chrome({ "popup/main.js": (b) => `${b}const u="\\x64ata:image/png;base64,iVBORw0KGgo=";` }), /popup\/main\.js embeds a image\/png .* does not name under popup\/main\.js#embedded/],
    ["a data: URL percent-encoded inside an SVG URI", {}, chrome({ "popup/main.css": ".x{background:url(\"data:image/svg+xml,%3Csvg%3E%3Cimage href='data%3Aimage/png;base64,iVBORw0KGgo='/%3E%3C/svg%3E\")}" }), /popup\/main\.css embeds a image\/png .* does not name under popup\/main\.css#embedded/],
    // Review round 49 PR-MED-044: the URL parser removes tab, LF and CR anywhere in a URL — in the scheme, before its
    // colon, in the type and in the base64 marker — each written as its language writes it: literally in an HTML
    // attribute, as a JS escape in a script, as a CSS escape in a stylesheet. A base64 SVG has no magic bytes, so only
    // the type can make it a picture.
    ...[["TAB", "\t", "\\t", "\\9 "], ["LF", "\n", "\\n", "\\a "], ["CR", "\r", "\\r", "\\d "]].flatMap(([what, html, js, css]) => [
      ["in the scheme", (c) => `da${c}ta:image/svg+xml;base64,PHN2Zz4=`],
      ["before the colon", (c) => `data${c}:image/svg+xml;base64,PHN2Zz4=`],
      ["in the type", (c) => `data:im${c}age/svg+xml;base64,PHN2Zz4=`],
      ["in the base64 marker", (c) => `data:image/svg+xml;ba${c}se64,PHN2Zz4=`],
    ].flatMap(([where, url]) => [
      ["popup/index.html", () => `<img src="${url(html)}">`],
      ["popup/main.js", (b) => `${b}const u="${url(js)}";`],
      ["popup/main.css", () => `.x{background:url("${url(css)}")}`],
    ].map(([file, edit]) => [`a ${what} ${where} of a base64 SVG data: URL, in ${file}`, {}, chrome({ [file]: edit }), new RegExp(`${file.replace(/[./]/g, "\\$&")} embeds a image/svg\\+xml \\([0-9a-f]{12}…\\) build/reviewed-images\\.tsv does not name under ${file.replace(/[./]/g, "\\$&")}#embedded`)]))),
    ["a PNG with a TAB in its type (its type, and its bytes)", {}, chrome({ "popup/index.html": '<img src="data:im\tage/png;base64,iVBORw0KGgo=">' }), /popup\/index\.html embeds a image\/png .* does not name under popup\/index\.html#embedded/],
    ["a plain SVG with a TAB in its type passes (readable text the drawing list reads)", {}, chrome({ "popup/index.html": '<img src="data:im\tage/svg+xml,%3Csvg%3E%3C/svg%3E">' }), null],
    // Review round 49 PR-MED-045: every text scan reads the same readings — a known drawing, the shield class and the
    // product name are refused behind an escape or an encoding, not only as written.
    ...[
      ["a JS hex escape", "popup/main.js", (b) => `${b}p.setAttribute("d","\\x4d22.01 17.055V4.135");`],
      ["a JS unicode escape", "popup/main.js", (b) => `${b}p.setAttribute("d","\\u004d22.01 17.055V4.135");`],
      ["an HTML decimal reference", "popup/index.html", () => '<svg><path d="&#77;22.01 17.055V4.135"/></svg>'],
      ["an HTML hex reference", "popup/index.html", () => '<svg><path d="&#x4d;22.01 17.055V4.135"/></svg>'],
      ["a CSS escape in a plain SVG data: URL", "popup/main.css", () => ".x{background:url(\"data:image/svg+xml,<path d='\\4d 22.01 17.055V4.135'/>\")}"],
      ["a JS escape in a percent-encoded SVG data: URL", "popup/main.js", (b) => `${b}const u="data:image/svg+xml,%3Cpath d='\\x4d22.01 17.055V4.135'/%3E";`],
    ].map(([how, file, edit]) => [`Bitwarden's drawing behind ${how}`, {}, chrome({ [file]: edit }), new RegExp(`${file.replace(/[./]/g, "\\$&")} draws Bitwarden's shield or wordmark \\(path data "M22\\.01 17\\.055V4\\.135"\\)`)]),
    ["the shield class behind a JS escape", {}, chrome({ "popup/main.js": (b) => `${b}["aria-hidden","true",1,"bwi","bwi-\\x73hield"]` }), /popup\/main\.js draws the icon font's Bitwarden shield glyph \(bwi-shield\)/],
    ["the shield class behind a CSS escape in a stylesheet", {}, chrome({ "popup/main.css": ".bwi-\\73 hield:before{content:\"\\e900\"}" }), /popup\/main\.css names a shield glyph class in a shape the checker cannot read its code point from/],
    ...[
      ["a JS escape", "popup/main.js", (b) => `${b}x.title="Bit\\x77arden";`],
      ["an HTML reference", "popup/index.html", () => "<p>&#66;itwarden</p>"],
      ["percent-encoding", "popup/main.js", (b) => `${b}u="https://example.invalid/?q=Bit%77arden";`],
    ].map(([how, file, edit]) => [`the product name behind ${how}`, {}, chrome({ [file]: edit }), new RegExp(`${file.replace(/[./]/g, "\\$&")} spells the product name through an escape or encoding`)]),
    // The stated limit: the drawing list matches upstream's own spelling of its known paths, not their geometry.
    ...[
      ["with a comma", "M22.01,17.055V4.135"],
      ["with spaces", "M 22.01 17.055 V 4.135"],
      ["with a trailing zero", "M22.010 17.055V4.135"],
    ].map(([how, d]) => [`a known path re-formatted ${how} passes (the stated limit: geometry is not recognised)`, {}, chrome({ "popup/main.js": (b) => `${b}p.setAttribute("d","${d}");` }), null]),
    ...[
      ["a comment naming the scheme", "// no origin to compare (file:, data:, etc.)"],
      ["an object key named data", "x({data:e,type:t});"],
      ["a data: URL assembled at run time (the stated limit)", "u='data:image/png;base64,'+b;"],
    ].map(([title, code]) => [`${title} passes`, {}, chrome({ "popup/main.js": (b) => `${b}${code}` }), null]),
    // Review round 46 PR-MED-032: the notices held to the build's record, and every package section to a body.
    ["a package dropped from list and sections alike", { record: "fixture" }, chrome({ "THIRD-PARTY-NOTICES.txt": (t) => t.replace("Packages (2): @bitwarden/sdk-internal 0.2.0-main.1126, rxjs 7.8.2", "Packages (1): @bitwarden/sdk-internal 0.2.0-main.1126").replace(/==== rxjs 7\.8\.2[\s\S]*?(?=====)/, "") }), /THIRD-PARTY-NOTICES\.txt lacks the recorded section rxjs 7\.8\.2 — licence: Apache-2\.0/],
    ["the SDK listed under another version, self-consistently", {}, chrome({ "THIRD-PARTY-NOTICES.txt": (t) => t.replaceAll("@bitwarden/sdk-internal 0.2.0-main.1126", "@bitwarden/sdk-internal 9.9.9") }), /does not list @bitwarden\/sdk-internal 0\.2\.0-main\.1126, whose module the package carries/],
    ["the SDK's version changed against the record", { record: "fixture" }, chrome({ "THIRD-PARTY-NOTICES.txt": (t) => t.replaceAll("@bitwarden/sdk-internal 0.2.0-main.1126", "@bitwarden/sdk-internal 9.9.9") }), /holds a section the build did not record: @bitwarden\/sdk-internal 9\.9\.9/],
    ["a licence body emptied (record and file alike)", {}, chrome({ "THIRD-PARTY-NOTICES.txt": (t) => t.replace("--- LICENSE.txt ---\nApache License\n", "--- LICENSE.txt ---\n\n") }), /section rxjs 7\.8\.2 — licence: Apache-2\.0 has no licence text/],
    ["a licence body changed against the record", { record: "fixture" }, chrome({ "THIRD-PARTY-NOTICES.txt": (t) => t.replace("Apache License", "Some licence") }), /lacks the recorded section rxjs 7\.8\.2 — licence: Apache-2\.0 \(or its text changed\)/],
    // x sorts after rxjs, so its section follows rxjs's, as the generator writes it (the preamble is held to the record's
    // order since review round 55).
    ["a package with no licence file passes on the fixed line", {}, chrome({ "THIRD-PARTY-NOTICES.txt": (t) => t.replace("rxjs 7.8.2\n", "rxjs 7.8.2, x 1.0.0\n").replace("Packages (2)", "Packages (3)").replace(`==== ${INTER.title}`, `==== x 1.0.0 — licence: MIT ====\n(the package carries no licence file; its package.json states the licence above)\n\n==== ${INTER.title}`) }), null],
    ["Tailwind's heading kept, its licence section gone", {}, chrome({ "popup/main.css": "/*! tailwindcss v3.4.18 | MIT License | https://tailwindcss.com\n */", "THIRD-PARTY-NOTICES.txt": (t) => `${t}==== ${TAILWIND.title} ====\n${TAILWIND.text}\n` }), /carries no tailwindcss licence section for Tailwind CSS/],
    ["no notices record for the package's target", { sdk: `gpl ${sha(GPL_WASM)} x.wasm\n${SDK_SOURCE}commercial not-installed\n` }, {}, /sdk-hashes\.txt records no notices for this package's target/],
    ["the notices' sections out of the recorded order", { record: "fixture" }, chrome({ "THIRD-PARTY-NOTICES.txt": (t) => { const [head, ...rest] = t.split(/(?=^==== )/m); return [head, rest[1], rest[0], ...rest.slice(2)].join(""); } }), /sections are not in the recorded order/],
    ["Tailwind's compiled base styles with no section", {}, chrome({ "popup/main.css": "/*! tailwindcss v3.4.18 | MIT License | https://tailwindcss.com\n */*{box-sizing:border-box}" }), /THIRD-PARTY-NOTICES\.txt has no section for Tailwind CSS/],
    ["an embedded Open Sans with no section", {}, chrome({ "overlay/menu-list.css": "@font-face{font-family:\"Open Sans\";font-weight:400;src:url(data:font/woff2;base64,d09GMg==)}" }), /THIRD-PARTY-NOTICES\.txt has no section for The Open Sans typeface/],
    ["the shield's path data percent-encoded in an SVG URI", {}, chrome({ "popup/main.js": (b) => `${b}const s="url(data:image/svg+xml,%3Cpath%20d='M22.01%2017.055V4.135'/%3E)";` }), /popup\/main\.js draws Bitwarden's shield or wordmark \(path data "M22\.01 17\.055V4\.135"\)/],
    ["a picture under another name", {}, chrome({ "assets/logo.bin": Buffer.from("\x89PNG\r\n\x1a\nshield", "latin1") }), /assets\/logo\.bin .* is a picture or font build\/reviewed-images\.tsv does not name/],
    ["an .apng nobody reviewed", {}, chrome({ "images/mark.apng": Buffer.from("x") }), /images\/mark\.apng .* is a picture or font/],
    ["one glyph's code point reused beside a second glyph's definition", {}, chrome({ "popup/main.css": ".bwi-shield:before{content:\"\\e900\"}.bwi-bitwarden-shield:before{content:\"\\e901\"}.brand:after{content:\"\\e900\"}" }), /popup\/main\.css names the shield glyph's code point U\+E900 outside its definitions/],
    ["the glyph by an HTML entity", {}, chrome({ "popup/main.css": ".bwi-shield:before{content:\"\\e900\"}", "popup/index.html": "<i class=\"bwi\">&#xe900;</i>" }), /popup\/index\.html names the shield glyph's code point U\+E900/],
    ["the glyph by String.fromCharCode", {}, chrome({ "popup/main.css": ".bwi-shield:before{content:\"\\e900\"}", "popup/main.js": (b) => `${b}el.textContent=String.fromCharCode(0xe900);` }), /popup\/main\.js names the shield glyph's code point U\+E900/],
    ["a shield class the checker cannot read a code point from", {}, chrome({ "popup/main.css": ".bwi-shield::before { content: \"\\e900\"; }" }), /popup\/main\.css names a shield glyph class in a shape the checker cannot read its code point from/],
    ["an SVG data URI (a check mark) passes", {}, chrome({ "popup/main.js": (b) => `${b}const tick="url(data:image/svg+xml,%3Csvg%3E%3C/svg%3E)";` }), null],
    // Plan T3.9: the GPL-3.0 files and the source archive.
    ...["LICENSE.txt", "LICENSE-UPSTREAM.txt", "NOTICE.txt", "THIRD-PARTY-NOTICES.txt"].map((name) => [`no ${name}`, {}, chrome({ [name]: undefined }), new RegExp(`no ${name.replace(/\./g, "\\.")} at the package's root`)]),
    ["a LICENSE.txt that is not GPL-3.0", {}, chrome({ "LICENSE.txt": "MIT License\n" }), /LICENSE\.txt is not the source archive's \.\/LICENSE_GPL\.txt, the text pinned/],
    ["a LICENSE-UPSTREAM.txt that is not upstream's notice", {}, chrome({ "LICENSE-UPSTREAM.txt": "Kount\n" }), /LICENSE-UPSTREAM\.txt is not the source archive's \.\/LICENSE\.txt, the text pinned/],
    // Review round 46 PR-MED-031: a text keeping every marker the old rule read is still refused.
    ["a GPL text with its terms cut, markers kept", {}, chrome({ "LICENSE.txt": (t) => t.replace("  TERMS AND CONDITIONS\n...\n", "") }), /LICENSE\.txt is not the source archive's \.\/LICENSE_GPL\.txt/],
    ["one paragraph of upstream's notice changed", {}, chrome({ "LICENSE-UPSTREAM.txt": (t) => t.replace("made.", "made, except to Kount.") }), /LICENSE-UPSTREAM\.txt is not the source archive's \.\/LICENSE\.txt/],
    ["an archive copy that is not the pinned text", { archive: (m) => m.map((x) => (x.name === "./LICENSE_GPL.txt" ? { ...x, data: `${GPL_TEXT}x` } : x)) }, chrome({ "LICENSE.txt": `${GPL_TEXT}x` }), /the source archive's \.\/LICENSE_GPL\.txt is not the text pinned for browser-v2026\.10\.2.*[\s\S]*LICENSE\.txt cannot be held to a pinned \.\/LICENSE_GPL\.txt/],
    ["a lock whose tag has no pinned licence texts", { lock: LOCK.replace(/browser-v2026\.10\.2/g, "browser-v2026.10.3"), changelogText: "# Changelog\n\n## browser-v2026.10.3+kount.1 — candidate\n" }, {}, /licence-pins\.tsv has no row for browser-v2026\.10\.3 \.\/LICENSE_GPL\.txt: read the text in the new tree, then pin it/],
    ["a NOTICE.txt with another version", {}, chrome({ "NOTICE.txt": renderNotice(TEMPLATE, { ...NOTICE_VALUES, version: "2026.10.2.2" }) }), /NOTICE\.txt's VERSION reads "2026\.10\.2\.2", want "2026\.10\.2\.1"/],
    ["a NOTICE.txt with another upstream commit", {}, chrome({ "NOTICE.txt": renderNotice(TEMPLATE, { ...NOTICE_VALUES, upstreamCommit: "0".repeat(40) }) }), /NOTICE\.txt's UPSTREAM_COMMIT reads "0{40}"/],
    ["a NOTICE.txt pointing at another label's source", {}, chrome({ "NOTICE.txt": (t) => t.replace("/tree/browser-v2026.10.2+kount.1", "/tree/main") }), /NOTICE\.txt's SOURCE_URL reads "https:\/\/github\.com\/kountlabs\/clients\/tree\/main"/],
    ["a NOTICE.txt whose wording drifted from the template", {}, chrome({ "NOTICE.txt": (t) => t.replace("Kount modified it", "Kount built it") }), /NOTICE\.txt is not the notice template's text/],
    ["a NOTICE.txt with no SDK commit", {}, chrome({ "NOTICE.txt": renderNotice(TEMPLATE, { ...NOTICE_VALUES, sdkCommit: "main" }) }), /NOTICE\.txt's SDK_COMMIT reads "main", want "4a9eb239/],
    ["a NOTICE.txt naming another SDK commit than the build installed", {}, chrome({ "NOTICE.txt": renderNotice(TEMPLATE, { ...NOTICE_VALUES, sdkCommit: "5".repeat(40) }) }), /NOTICE\.txt's SDK_COMMIT reads "5{40}"/],
    ["a NOTICE.txt naming another SDK version", {}, chrome({ "NOTICE.txt": renderNotice(TEMPLATE, { ...NOTICE_VALUES, sdkVersion: "0.2.0-main.1" }) }), /NOTICE\.txt's SDK_VERSION reads "0\.2\.0-main\.1"/],
    ["an SDK record without its source line", { sdk: `gpl ${sha(GPL_WASM)} node_modules/@bitwarden/sdk-internal/x.wasm\ncommercial not-installed\n` }, {}, /sdk-hashes\.txt has no gpl-source line/],
    ["an SDK record naming its source twice", { sdk: `gpl ${sha(GPL_WASM)} x.wasm\n${SDK_SOURCE}${SDK_SOURCE}` }, {}, /names the GPL SDK's source twice/],
    ["a long LICENSE-UPSTREAM.txt", {}, chrome({ "LICENSE-UPSTREAM.txt": (t) => `${t}${"padding\n".repeat(300)}` }), /LICENSE-UPSTREAM\.txt is not the source archive's \.\/LICENSE\.txt/],
    ["the product name in THIRD-PARTY-NOTICES.txt", {}, chrome({ "THIRD-PARTY-NOTICES.txt": (t) => `${t}Bitwarden Password Manager\n` }), /the product name, not allowed: THIRD-PARTY-NOTICES\.txt/],
    ["the product name in LICENSE.txt", {}, chrome({ "LICENSE.txt": (t) => `${t}Bitwarden\n` }), /the product name, not allowed: LICENSE\.txt/],
    ["bitwarden_license named in THIRD-PARTY-NOTICES.txt", {}, chrome({ "THIRD-PARTY-NOTICES.txt": (t) => `${t}bitwarden_license/x\n` }), /THIRD-PARTY-NOTICES\.txt names bitwarden_license/],
    ["a THIRD-PARTY-NOTICES.txt without the SDK", {}, chrome({ "THIRD-PARTY-NOTICES.txt": (t) => t.replace("Packages (2): @bitwarden/sdk-internal 0.2.0-main.1126, rxjs 7.8.2", "Packages (1): rxjs 7.8.2") }), /does not list @bitwarden\/sdk-internal/],
    ["a THIRD-PARTY-NOTICES.txt listing a package with no section", {}, chrome({ "THIRD-PARTY-NOTICES.txt": (t) => t.replace("rxjs 7.8.2\n", "rxjs 7.8.2, lit 3.3.1\n").replace("Packages (2)", "Packages (3)") }), /lists lit 3\.3\.1 with no section/],
    ["a THIRD-PARTY-NOTICES.txt whose section is another version's", {}, chrome({ "THIRD-PARTY-NOTICES.txt": (t) => t.replace("rxjs 7.8.2\n", "rxjs 7.8.1\n") }), /lists rxjs 7\.8\.1 with no section/],
    ["a THIRD-PARTY-NOTICES.txt whose count and list differ", {}, chrome({ "THIRD-PARTY-NOTICES.txt": (t) => t.replace("Packages (2)", "Packages (3)") }), /package count and list differ/],
    ["a THIRD-PARTY-NOTICES.txt with no packages", {}, chrome({ "THIRD-PARTY-NOTICES.txt": "THIRD-PARTY NOTICES — Kount Protect\n" }), /THIRD-PARTY-NOTICES\.txt lists no package/],
    ["the Inter typeface with no section", {}, chrome({ [FONT]: Buffer.from("wOF2 inter"), "THIRD-PARTY-NOTICES.txt": (t) => t.replace(`==== ${INTER.title} ====`, "==== a font ====") }), /has no section for The Inter typeface/],
    ["the Inter typeface without its licence", {}, chrome({ [FONT]: Buffer.from("wOF2 inter"), "THIRD-PARTY-NOTICES.txt": (t) => t.replace("SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007", "") }), /does not carry inter-OFL\.txt/],
    ["a card logo with no section", {}, chrome({ "popup/images/visa-light.png": Buffer.from("\x89PNG visa") }), /has no section for Payment card brand logos/],
    ["a notice file's name elsewhere is still scanned", {}, chrome({ "popup/NOTICE.txt": "Bitwarden" }), /the product name, not allowed: popup\/NOTICE\.txt/],
    ["the commercial SDK named in a notice file", {}, chrome({ "THIRD-PARTY-NOTICES.txt": (t) => `${t}@bitwarden/commercial-sdk-internal\n` }), /THIRD-PARTY-NOTICES\.txt names the commercial SDK/],
    // Review round 46 PR-MED-030: the archive must hold what the real kit requires, file for file.
    ...(() => {
      const without = (path) => (m) => m.filter((x) => x.name !== path);
      const emptied = (path) => (m) => m.map((x) => (x.name === path ? { ...x, data: "" } : x));
      const changed = (path) => (m) => m.map((x) => (x.name === path ? { ...x, data: Buffer.concat([Buffer.from(x.data), Buffer.from("\n")]) } : x));
      const first = (prefix) => archiveMembers(changelog("candidate")).find((x) => x.name.startsWith(prefix)).name;
      const patch = first("./kount-build/patches/");
      const asset = first("./kount-build/assets/apps/");
      const overlay = first("./kount-build/overlay/");
      const treeAsset = `./${asset.slice("./kount-build/assets/".length)}`;
      const treeOverlay = `./${overlay.slice("./kount-build/overlay/".length)}`;
      const re = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return [
        ["a source archive with bitwarden_license/", { archive: (m) => [...m, { name: "./bitwarden_license/", type: "5" }, { name: "./bitwarden_license/bit-browser/x.ts", data: "x" }] }, {}, /the source archive carries \.\/bitwarden_license\/ \(apply\.sh removes bitwarden_license\/\)/],
        ["a source archive with bitwarden_license/ named without ./", { archive: (m) => [...m, { name: "bitwarden_license/bit-browser/x.ts", data: "x" }] }, {}, /cannot be read: a tar member name outside the archive's grammar: "bitwarden_license\/bit-browser\/x\.ts"/],
        ["a source archive without the building steps", { archive: without("./KOUNT-BUILDING.md") }, {}, /the source archive has no \.\/KOUNT-BUILDING\.md/],
        ["a source archive without the lockfile", { archive: without("./package-lock.json") }, {}, /the source archive has no \.\/package-lock\.json/],
        ["a source archive without upstream's licence notice", { archive: without("./LICENSE.txt") }, {}, /the source archive has no \.\/LICENSE\.txt/],
        ["a source archive without a font licence the notices read", { archive: without("./kount-build/build/notice/open-sans-OFL.txt") }, {}, /has no \.\/kount-build\/build\/notice\/open-sans-OFL\.txt/],
        ["a source archive without one patch", { archive: without(patch) }, {}, new RegExp(`has no ${re(patch)}`)],
        ["a source archive with an empty build script", { archive: emptied("./kount-build/build/build.sh") }, {}, /\.\/kount-build\/build\/build\.sh is not the kit's/],
        ["a source archive with an empty lockfile", { archive: emptied("./package-lock.json") }, {}, /\.\/package-lock\.json is empty/],
        ["a source archive whose kit asset changed", { archive: changed(asset) }, {}, new RegExp(`${re(asset)} is not the kit's`)],
        ["a source archive whose tree asset is not the kit's", { archive: changed(treeAsset) }, {}, new RegExp(`${re(treeAsset)} is not the kit's`)],
        ["a source archive whose tree lacks an overlay file", { archive: without(treeOverlay) }, {}, new RegExp(`has no ${re(treeOverlay)}`)],
        ["a source archive with a file the kit does not hold", { archive: (m) => [...m, { name: "./kount-build/build/stray.mjs", data: "x" }] }, {}, /kit holds \.\/kount-build\/build\/stray\.mjs, which the checker's kit does not/],
        ["a source archive whose kit holds another lock", { archive: (m) => m.map((x) => (x.name === "./kount-build/upstream.lock" ? { ...x, data: LOCK.replace(/UPSTREAM_COMMIT=\w+/, `UPSTREAM_COMMIT=${"0".repeat(40)}`) } : x)) }, {}, /\.\/kount-build\/upstream\.lock is not the kit's/],
        ["a source archive whose kit changelog tops with another entry", { archive: (m) => m.map((x) => (x.name === "./kount-build/CHANGELOG.md" ? { ...x, data: "# Changelog\n\n## browser-v2026.10.2+kount.2 — candidate\n" } : x)) }, {}, /\.\/kount-build\/CHANGELOG\.md tops with browser-v2026\.10\.2\+kount\.2 \(candidate\), not the build's browser-v2026\.10\.2\+kount\.1/],
        ["a source archive whose kit changelog cannot be read", { archive: (m) => m.map((x) => (x.name === "./kount-build/CHANGELOG.md" ? { ...x, data: "# other\n" } : x)) }, {}, /\.\/kount-build\/CHANGELOG\.md cannot be read/],
      ];
    })(),
    // Review round 46 PR-MED-035: only files, directories and GNU long names; no name twice.
    ...(() => {
      const paxPath = (p) => { const rec = ` path=${p}\n`; const len = rec.length + String(rec.length + 3).length; return { name: "./PaxHeaders/x", type: "x", data: `${len}${rec}` }; };
      const reader = (what) => new RegExp(`kount-protect-source\\.tar\\.gz cannot be read: ${what}`);
      return [
        ["a PAX record renaming the next member to bitwarden_license/", { archive: (m) => [...m, paxPath("bitwarden_license/x.ts"), { name: "./innocuous.ts", data: "x" }] }, {}, reader('a tar member of type "x"')],
        ["a global PAX record", { archive: (m) => [{ name: "./pax_global_header", type: "g", data: "20 comment=planted\n" }, ...m] }, {}, reader('a tar member of type "g"')],
        ["a required script stored as a symlink", { archive: (m) => m.map((x) => (x.name === "./kount-build/build/build.sh" ? { ...x, type: "2", data: "" } : x)) }, {}, reader('a tar member of type "2"')],
        ["a hard link", { archive: (m) => [...m, { name: "./hard", type: "1" }] }, {}, reader('a tar member of type "1"')],
        ["a device node", { archive: (m) => [...m, { name: "./dev", type: "3" }] }, {}, reader('a tar member of type "3"')],
        ["a GNU long-link record", { archive: (m) => [...m, { name: "././@LongLink", type: "K", data: "elsewhere\0" }, { name: "./x", data: "x" }] }, {}, reader('a tar member of type "K"')],
        ["a required file given twice, the later empty", { archive: (m) => [...m, { name: "./kount-build/build/apply.sh", data: "" }] }, {}, reader("a tar member named twice: \\./kount-build/build/apply\\.sh")],
        ["a name given twice, with and without ./", { archive: (m) => [...m, { name: "package.json", data: "{}" }] }, {}, reader("a tar member name outside the archive's grammar: \"package\\.json\"")],
      ];
    })(),
    // Review round 47 PR-MED-036: one canonical name grammar, checked before every other rule.
    ...(() => {
      const reader = (what) => new RegExp(`kount-protect-source\\.tar\\.gz cannot be read: ${what}`);
      return [
        ["an aliased overwrite of the pinned GPL text", { archive: (m) => [...m, { name: "././LICENSE_GPL.txt", data: "other" }] }, {}, reader("a tar member name with a \\. or \\.\\. segment: \"\\./\\./LICENSE_GPL\\.txt\"")],
        ["an aliased overwrite of a kit script", { archive: (m) => [...m, { name: "././kount-build/build/build.sh", data: "echo x" }] }, {}, reader("a tar member name with a \\. or \\.\\. segment")],
        ["an aliased commercial path", { archive: (m) => [...m, { name: "././bitwarden_license/x.ts", data: "x" }] }, {}, reader("a tar member name with a \\. or \\.\\. segment")],
        ["a repeated separator", { archive: (m) => [...m, { name: ".//bitwarden_license/x.ts", data: "x" }] }, {}, reader("a tar member name outside the archive's grammar")],
        ["an interior dot segment", { archive: (m) => [...m, { name: "./apps/./browser/x.ts", data: "x" }] }, {}, reader("a tar member name with a \\. or \\.\\. segment")],
        ["a dot-dot segment into bitwarden_license/", { archive: (m) => [...m, { name: "./a/../bitwarden_license/x.ts", data: "x" }] }, {}, reader("a tar member name with a \\. or \\.\\. segment")],
        ["an absolute path", { archive: (m) => [...m, { name: "/etc/x", data: "x" }] }, {}, reader("a tar member name outside the archive's grammar: \"/etc/x\"")],
        ["a backslash path", { archive: (m) => [...m, { name: ".\\bitwarden_license\\x.ts", data: "x" }] }, {}, reader("a tar member name outside the archive's grammar")],
        ["a name without the ./ root", { archive: (m) => [...m, { name: "x.ts", data: "x" }] }, {}, reader("a tar member name outside the archive's grammar: \"x\\.ts\"")],
        ["a file named like a directory", { archive: (m) => [...m, { name: "./x/", data: "x" }] }, {}, reader("a tar file ending in /")],
        ["a directory without its trailing /", { archive: (m) => [...m, { name: "./d", type: "5" }] }, {}, reader("a tar directory not ending in /")],
        ["a file and a directory of one path", { archive: (m) => [...m, { name: "./package.json/", type: "5" }] }, {}, reader("a tar member named twice: \\./package\\.json/")],
        ["a long name whose member header names something else", { archive: (m) => [...m, { name: `./apps/browser/src/${"c".repeat(120)}.ts`, data: "x", headerName: "./innocuous.ts" }] }, {}, reader("a GNU long name whose member header names something else")],
      ];
    })(),
    // Review round 47 PR-MED-037: every header's integrity before any field is trusted.
    ...(() => {
      const reader = (what) => new RegExp(`kount-protect-source\\.tar\\.gz cannot be read: ${what}`);
      const onOne = (fields) => (m) => m.map((x, i) => (i === 3 ? { ...x, fields } : x));
      return [
        ["every header's checksum NUL", { archive: (m) => m.map((x) => ({ ...x, fields: { checksum: "nul" } })) }, {}, reader("a tar header whose checksum field is not plain octal")],
        ["one header's checksum wrong", { archive: onOne({ checksum: "wrong" }) }, {}, reader("a tar header whose checksum is wrong")],
        ["a size field with junk after its octal digits", { archive: onOne({ size: "0000000003x\0" }) }, {}, reader("a tar header whose size field is not plain octal")],
        ["a base-256 size field", { archive: onOne({ size: "\x80\0\0\0\0\0\0\0\0\0\0\x03" }) }, {}, reader("a tar header whose size field is not plain octal")],
        ["a POSIX ustar header", { archive: onOne({ magic: "ustar\u000000" }) }, {}, reader("a tar header without GNU's magic")],
      ];
    })(),
    ["a source archive with a long name (a GNU long-name record) passes", { archive: (m) => (assert.ok(m.some((x) => x.name === LONG_UPSTREAM)), m) }, {}, null],
    // Review round 48 PR-MED-042: the archive's upstream part is upstream's own tree at the lock, file by file.
    ...(() => {
      const without = (path) => (m) => m.filter((x) => x.name !== path);
      const record = (edit) => (m) => m.map((x) => (x.name === UPSTREAM_TREE_RECORD ? { ...x, data: edit(x.data) } : x));
      /**
       * The options and package edits for another synthetic upstream, made consistently — its record, a lock naming its
       * commit, and NOTICE.txt naming that commit — so only the rule under test can refuse it.
       */
      const otherUpstream = (extra) => {
        const u = syntheticUpstream(new Map([...UPSTREAM.files, ...extra]));
        const notice = renderNotice(TEMPLATE, { ...NOTICE_VALUES, upstreamCommit: u.commit });
        return [
          { lock: LOCK.replace(/UPSTREAM_COMMIT=\w+/, `UPSTREAM_COMMIT=${u.commit}`), archive: record(() => u.record) },
          Object.fromEntries(["chrome", "edge", "firefox"].map((t) => [t, { "NOTICE.txt": notice }])),
        ];
      };
      return [
        ["a source archive without upstream's record", { archive: without(UPSTREAM_TREE_RECORD) }, {}, /the source archive has no \.\/KOUNT-UPSTREAM-TREE\.txt/],
        ["a source archive without apps/browser/package.json", { archive: without("./apps/browser/package.json") }, {}, /the source archive lacks upstream's files at the lock \(1\): \.\/apps\/browser\/package\.json/],
        ["a source archive without apps/browser/webpack.config.js", { archive: without("./apps/browser/webpack.config.js") }, {}, /the source archive lacks upstream's files at the lock \(1\): \.\/apps\/browser\/webpack\.config\.js/],
        ["a source archive without an untouched source file", { archive: without("./libs/common/src/untouched.ts") }, {}, /lacks upstream's files at the lock \(1\): \.\/libs\/common\/src\/untouched\.ts/],
        ["an untouched source file changed by one byte", { archive: (m) => m.map((x) => (x.name === "./tsconfig.json" ? { ...x, data: `${x.data} ` } : x)) }, {}, /holds files that differ from upstream's at the lock, though the queue does not touch them \(1\): \.\/tsconfig\.json/],
        ["a file that is neither upstream's nor the queue's", { archive: (m) => [...m, { name: "./apps/browser/src/extra.ts", data: "x" }] }, {}, /holds files that are neither upstream's at the lock nor the queue's \(1\): \.\/apps\/browser\/src\/extra\.ts/],
        ["a listing whose one id was changed", { archive: record((t) => t.replace(/^(100644 blob )[0-9a-f]/m, (a, head) => `${head}${a.at(-1) === "0" ? "1" : "0"}`)) }, {}, /KOUNT-UPSTREAM-TREE\.txt lists a tree that is not the lock commit's tree/],
        ["a listing with a file left out", { archive: record((t) => t.replace(/^100644 blob \S+\ttsconfig\.json\n/m, "")) }, {}, /KOUNT-UPSTREAM-TREE\.txt lists a tree that is not the lock commit's tree/],
        ["a commit object that is not the lock's", { archive: record((t) => t.replace(/^commit (\S+)$/m, (a, b) => `commit ${Buffer.concat([Buffer.from(b, "base64"), Buffer.from("x")]).toString("base64")}`)) }, {}, /KOUNT-UPSTREAM-TREE\.txt holds a commit object that is not the lock's commit/],
        ["a listing line in another shape", { archive: record((t) => `${t}100644 blob ${"0".repeat(40)}\t"quoted name"\n`) }, {}, /KOUNT-UPSTREAM-TREE\.txt line \d+ is not "commit <base64>"/],
        ["upstream holding a symbolic link", ...otherUpstream([["./apps/browser/link", { data: Buffer.from("target"), mode: "120000" }]]), /upstream's tree holds a symbolic link the source archive cannot carry: apps\/browser\/link/],
        ["upstream holding a path build.sh's tar leaves out", ...otherUpstream([["./apps/browser/build/kept.js", { data: Buffer.from("x") }]]), /upstream's tree holds apps\/browser\/build\/kept\.js, which build\.sh's exclusions leave out/],
        ["upstream holding a submodule passes (a clone does not check one out)", ...otherUpstream([["./libs/vendored", { type: "commit", mode: "160000", oid: "1".repeat(40) }]]), null],
        ["the control: the same consistent re-making of the fixture's own upstream passes", ...otherUpstream([]), null],
      ];
    })(),
    ["a long name under bitwarden_license/ is read whole and refused", { archive: (m) => [...m, { name: `./bitwarden_license/${"b".repeat(120)}.ts`, data: "x" }] }, {}, /the source archive carries \.\/bitwarden_license\/b{120}\.ts/],
    // A proofs build archives the constants build.sh pointed at loopback: exactly those two lines, and only in --proofs.
    ["a store archive holding the loopback constants", { archive: (m) => m.map((x) => (x.name === "./apps/browser/src/kount/build-constants.ts" ? { ...x, data: archiveMembers(changelog("candidate"), KIT, LOCK, true).find((y) => y.name === x.name).data } : x)) }, {}, /\.\/apps\/browser\/src\/kount\/build-constants\.ts is not the kit's/],
    ["a proofs archive whose constants carry a third change", { mode: "--proofs", targets: ["chrome"], archive: (m) => m.map((x) => (x.name === "./apps/browser/src/kount/build-constants.ts" ? { ...x, data: `${x.data}export const EXTRA = 1;\n` } : x)) }, {}, /\.\/apps\/browser\/src\/kount\/build-constants\.ts is not the kit's/],
    ["a source archive cut at a member boundary", {}, {}, /no end-of-archive block \(cut short\)/, (dir) => {
      const t = tar(archiveMembers(changelog("candidate")));
      writeFileSync(join(dir, "kount-protect-source.tar.gz"), zlib.gzipSync(t.subarray(0, t.length - 1024)));
      reseal(dir);
    }],
    ["a source archive cut inside a member", {}, {}, /a tar member that runs past the end of the archive/, (dir) => {
      const t = tar([{ name: "./kount-build/upstream.lock", data: LOCK }]);
      writeFileSync(join(dir, "kount-protect-source.tar.gz"), zlib.gzipSync(t.subarray(0, 600)));
      reseal(dir);
    }],
    ["a source archive that is not a tar", {}, {}, /kount-protect-source\.tar\.gz cannot be read: a tar archive with no end-of-archive block/, (dir) => {
      writeFileSync(join(dir, "kount-protect-source.tar.gz"), zlib.gzipSync(Buffer.from("tar")));
      reseal(dir);
    }],
    ["a source map in a store package", {}, chrome({ "background.js.map": "{}" }), /background\.js\.map: a source map in a store package/],
    ["a product name nothing allows", {}, chrome({ "popup/index.html": "<title>Bitwarden</title>" }), /the product name, not allowed: popup\/index\.html/],
    ["an allowed class in the wrong file", {}, chrome({ "background.js": (b) => `${b}"example": "Bitwarden Phishing Blocker"` }), /the product name, not allowed: background\.js/],
    ["a symlink entry", {}, chrome({}), /a symlink entry/, (dir) => {
      writeFileSync(join(dir, "kount-protect-chrome.zip"), zip(pkg("chrome"), { modes: { "images/icon16.png": 0o120777 } }));
      reseal(dir);
    }],
    ["an entry with a .. segment", {}, chrome({ "../evil.js": "x" }), /an entry name that is not plain/],
    ["a package that does not match SHA256SUMS", {}, {}, /kount-protect-edge\.zip does not match its SHA256SUMS line/, (dir) => writeFileSync(join(dir, "kount-protect-edge.zip"), zip(pkg("edge", { over: { "popup/main.js": "x" } })))],
    ["a store build missing a package", { targets: ["chrome", "firefox"] }, {}, /SHA256SUMS does not name kount-protect-edge\.zip/],
    ["an extra file in SHA256SUMS", {}, {}, /SHA256SUMS names notes\.txt, which is not an artefact/, (dir) => {
      writeFileSync(join(dir, "notes.txt"), "x");
      writeFileSync(join(dir, "SHA256SUMS"), `${readFileSync(join(dir, "SHA256SUMS"), "utf8")}${sha(Buffer.from("x"))}  notes.txt\n`);
    }],
    ["no SHA256SUMS", {}, {}, /ARTEFACT_PROBLEM no SHA256SUMS/, (dir) => rmSync(join(dir, "SHA256SUMS"))],
    ["an SDK record with no GPL module", { sdk: "gpl not-installed\ncommercial not-installed\n" }, {}, /names no GPL SDK module/],
    ["a README without its identity", { readme: "# x\n" }, {}, /README identity: want exactly one "- Name: `…`" line, found 0/],
    ["the attribution placeholder in a release", { mode: "--release", status: "release" }, chrome({ "popup/main.js": (b) => `${b}"[attribution wording pending the legal check]"` }), /still holds the attribution placeholder/],
    // Review round 9: what the capitalised scan cannot see, and a class tied to its neighbours.
    ["a shown message naming bitwarden.com", {}, chrome({ "_locales/en/messages.json": JSON.stringify({ extName: { message: "Kount Protect" }, visitSite: { message: "Visit bitwarden.com now" } }) }), /the English message visitSite shows "Visit bitwarden\.com now": not an allowed message/],
    ["an allowed message key passes", {}, chrome({ "_locales/en/messages.json": JSON.stringify({ extName: { message: "Kount Protect" }, downloadFromBitwardenNow: { message: "Download from bitwarden.com now" } }) }), null],
    ["HTML markup naming bitwarden in lower case", {}, chrome({ "popup/index.html": '<link rel="help" href="https://bitwarden.com/help">' }), /popup\/index\.html names bitwarden in its markup/],
    ["a bare name:\"Bitwarden\" away from the import list", {}, chrome({ "background.js": (b) => `${b};const t={name:"Bitwarden"};` }), /the product name, not allowed: background\.js/],
    // Review round 9 MED-001: a zip a browser would read differently from the checker.
    ["a directory holding one record more than the end record counts", {}, {}, /holding more or fewer records than its end record counts/, (dir) => {
      const z = zip(pkg("chrome"));
      const eocd = z.length - 22;
      z.writeUInt16LE(z.readUInt16LE(eocd + 8) - 1, eocd + 8);
      z.writeUInt16LE(z.readUInt16LE(eocd + 10) - 1, eocd + 10);
      writeFileSync(join(dir, "kount-protect-chrome.zip"), z);
      reseal(dir);
    }],
    ["bytes after the end record", {}, {}, /bytes after the end record/, (dir) => {
      writeFileSync(join(dir, "kount-protect-chrome.zip"), Buffer.concat([zip(pkg("chrome")), Buffer.from("PK trailing")]));
      reseal(dir);
    }],
    // Review round 12 SEC-001: an entry that inflates past its record is refused, not expanded.
    ["an entry that inflates past its recorded size", {}, {}, /an entry that does not inflate to its recorded size: manifest\.json/, (dir) => {
      const z = zip(pkg("chrome"));
      const cd = z.readUInt32LE(z.length - 22 + 16);
      z.writeUInt32LE(10, cd + 24); // the first directory record's uncompressed size: far below what it inflates to
      writeFileSync(join(dir, "kount-protect-chrome.zip"), z);
      reseal(dir);
    }],
    ["a local header naming another file", {}, {}, /a local header that disagrees with the directory: manifest\.json/, (dir) => {
      const z = zip(pkg("chrome"));
      z.write("X", 30); // the first local header's name: manifest.json → Xanifest.json
      writeFileSync(join(dir, "kount-protect-chrome.zip"), z);
      reseal(dir);
    }],
  ];
  for (const [title, opts, over, re, plant] of CASES) {
    test(title, () => (re === null ? passes(run({ ...opts, over, plant })) : fails(run({ ...opts, over, plant }), re)));
  }
});

// Review round 54: the approved attribution line is REQUIRED in each release package's About output (PR-MED-049), and the
// placeholder and the two other word rules read every reading, not the file alone (PR-MED-050). Every plant is in ONE
// package, the other two left good: two correct siblings and one incorrect target, so the problem must name that target.
describe("the attribution line and the word rules (review round 54)", () => {
  const BS = String.fromCharCode(92);
  const RELEASE = { mode: "--release", status: "release" };
  const MARKER = "[attribution wording pending the legal check]";
  const swap = (to) => (b) => {
    assert.equal(b.split(ABOUT_LINE).length, 2, "the fixture holds the line once");
    return b.replace(ABOUT_LINE, to);
  };
  const withMessage = (key, message) => JSON.stringify({ extName: { message: "Kount Protect" }, [key]: { message } });
  test("the checker's literal, the rule's constant and the line the legal check approved are one value", () => {
    assert.equal(APPROVED_ATTRIBUTION, ATTRIBUTION);
    assert.equal(ATTRIBUTION_LITERAL, ABOUT_LINE);
  });
  const REQUIRED = /the approved attribution line must be in popup\/main\.js exactly once/;
  const WORDING = /holds attribution wording other than the approved line/;
  const CASES = [
    // PR-MED-049: deletion, alteration, a copy, a move, and wording added in, beside, before or after the line.
    ["the line deleted", RELEASE, { "popup/main.js": swap('""') }, [REQUIRED]],
    ["the line altered (open-source)", RELEASE, { "popup/main.js": swap(JSON.stringify(ATTRIBUTION.replace("open source", "open-source"))) }, [REQUIRED]],
    ["the line with wording naming Bitwarden appended", RELEASE, { "popup/main.js": swap(JSON.stringify(`${ATTRIBUTION} Kount Protect is not affiliated with Bitwarden, Inc.`)) }, [REQUIRED]],
    ["the line with wording appended, no name", RELEASE, { "popup/main.js": swap(JSON.stringify(`${ATTRIBUTION} Kount is not endorsed by its authors.`)) }, [REQUIRED]],
    ["the line with wording prepended", RELEASE, { "popup/main.js": swap(JSON.stringify(`Endorsed by no one. ${ATTRIBUTION}`)) }, [REQUIRED, WORDING]],
    ["the line replaced by another wording", RELEASE, { "popup/main.js": swap('"Kount Protect is built on open source software."') }, [REQUIRED, WORDING]],
    ["the line twice in the About output", RELEASE, { "popup/main.js": (b) => `${b};var a2=${ABOUT_LINE};` }, [/popup\/main\.js ×2/]],
    ["a second copy in another file", RELEASE, { "background.js": (b) => `${b};var a2=${ABOUT_LINE};` }, [/background\.js ×1/]],
    ["the line moved to another file", RELEASE, { "popup/main.js": swap('""'), "background.js": (b) => `${b};var a2=${ABOUT_LINE};` }, [/found background\.js ×1 \(/]],
    ["a second copy only through an escape", RELEASE, { "popup/main.js": (b) => `${b};var a2=${ABOUT_LINE.replace("®", `${BS}u00ae`)};` }, [/popup\/main\.js ×2 \(1 as written\)/]],
    ["the line only through an escape", RELEASE, { "popup/main.js": swap(ABOUT_LINE.replace("®", `${BS}u00ae`)) }, [/popup\/main\.js ×1 \(0 as written\)/]],
    ["an alternative wording beside the line, no name", RELEASE, { "popup/main.js": (b) => `${b};var a2="Kount Protect is built on open source software.";` }, [WORDING]],
    ["attribution wording in a message", RELEASE, { "_locales/en/messages.json": withMessage("aboutKount", "Kount Protect: developed using free software.") }, [WORDING]],
    // PR-MED-050: the placeholder in every reading, beside the approved line (which the good package keeps).
    ["the placeholder, raw", RELEASE, { "popup/main.js": (b) => `${b};var m="${MARKER}";` }, [/popup\/main\.js still holds the attribution placeholder/]],
    ["the placeholder through a JS Unicode escape", RELEASE, { "popup/main.js": (b) => `${b};var m="${MARKER.replace("check", `${BS}u0063heck`)}";` }, [/popup\/main\.js still holds the attribution placeholder/]],
    ["the placeholder through a JS hex escape", RELEASE, { "popup/main.js": (b) => `${b};var m="${MARKER.replace("check", `${BS}x63heck`)}";` }, [/popup\/main\.js still holds the attribution placeholder/]],
    ["the placeholder through an HTML reference", RELEASE, { "popup/index.html": `<p>${MARKER.replace("]", "&#93;")}</p>` }, [/popup\/index\.html still holds the attribution placeholder/]],
    ["the placeholder percent-encoded", RELEASE, { "popup/main.js": (b) => `${b};var m="${MARKER.replace(" ", "%20")}";` }, [/popup\/main\.js still holds the attribution placeholder/]],
    // PR-MED-050's siblings: the commercial SDK's name and bitwarden_license, in any mode.
    ["bitwarden_license through a JS escape", {}, { "popup/main.js": (b) => `${b};var l="bitwarden${BS}u005flicense";` }, [/popup\/main\.js names bitwarden_license/]],
    ["the commercial SDK's name through a JS escape", {}, { "popup/main.js": (b) => `${b};var c="commercial${BS}x2dsdk-internal";` }, [/popup\/main\.js names the commercial SDK/]],
  ];
  for (const target of ["chrome", "edge", "firefox"]) {
    const zipName = `kount-protect-${target}.zip`;
    for (const [title, opts, over, res] of CASES) {
      test(`${target}: ${title}`, () => {
        const r = run({ ...opts, over: { [target]: over } });
        assert.equal(r.code, 1, r.out + r.err);
        for (const re of res) assert.match(r.out, new RegExp(`ARTEFACT_PROBLEM ${zipName.replace(/\./g, "\\.")}: .*${re.source}`));
        // The two good siblings are clean: every problem names the target.
        for (const line of r.out.split("\n").filter((l) => l.startsWith("ARTEFACT_PROBLEM"))) assert.ok(line.startsWith(`ARTEFACT_PROBLEM ${zipName}: `), line);
      });
    }
  }
  test("the requirement is the release gate's: a store build without the line passes", () => passes(run({ over: { edge: { "popup/main.js": swap('""') } } })));
  test("a good release with the line in all three passes", () => passes(run(RELEASE)));
});

// Review round 55 PR-MED-052: THIRD-PARTY-NOTICES.txt's preamble is the generator's text for the recorded packages, byte
// for byte, so every byte of the file is bound (the sections by their recorded hashes). Each plant in ONE package, the
// other two good; the section hashes are untouched by every plant.
describe("the third-party notices' preamble (review round 55)", () => {
  const RELEASE = { mode: "--release", status: "release" };
  const SENTENCE = "Kount Protect is built on open source software.";
  const TITLE = "THIRD-PARTY NOTICES — Kount Protect\n";
  const LIST = "Packages (2): @bitwarden/sdk-internal 0.2.0-main.1126, rxjs 7.8.2\n";
  const FIRST = "==== @bitwarden/sdk-internal";
  const CASES = [
    ["a sentence right after the title", (t) => t.replace(TITLE, `${TITLE}${SENTENCE}\n`)],
    ["a sentence between the package list and the first section", (t) => t.replace(LIST, `${LIST}${SENTENCE}\n`)],
    ["a sentence immediately before the first section", (t) => t.replace(FIRST, `${SENTENCE}\n${FIRST}`)],
    ["a blank line added", (t) => t.replace(TITLE, `${TITLE}\n`)],
    ["a blank line removed", (t) => t.replace(`${LIST}\n`, LIST)],
    ["the package list reordered", (t) => t.replace(LIST, "Packages (2): rxjs 7.8.2, @bitwarden/sdk-internal 0.2.0-main.1126\n")],
    ["a second package list line", (t) => t.replace(LIST, `${LIST}${LIST}`)],
  ];
  for (const target of ["chrome", "edge", "firefox"]) {
    const zipName = `kount-protect-${target}.zip`;
    for (const [title, edit] of CASES) {
      test(`${target}: ${title}`, () => {
        const r = run({ ...RELEASE, over: { [target]: { "THIRD-PARTY-NOTICES.txt": (t) => {
          const out = edit(t);
          assert.notEqual(out, t, "the plant changed the file");
          return out;
        } } } });
        assert.equal(r.code, 1, r.out + r.err);
        assert.match(r.out, new RegExp(`ARTEFACT_PROBLEM ${zipName.replace(/\./g, "\\.")}: THIRD-PARTY-NOTICES\\.txt's text before its first section is not the generated preamble`));
        for (const line of r.out.split("\n").filter((l) => l.startsWith("ARTEFACT_PROBLEM"))) assert.ok(line.startsWith(`ARTEFACT_PROBLEM ${zipName}: `), line);
      });
    }
  }
  test("the real third-party licence wording in a section passes (its section is recorded as built)", () => passes(run({
    ...RELEASE, over: { chrome: { "THIRD-PARTY-NOTICES.txt": (t) => t.replace("Apache License\n", "Apache License\nThis software is free software, distributed under the licence below.\n") } },
  })));
});

// Review round 13 PR-MED-010: the one changelog reader, an ordinary entry, a rollback entry and the refused shapes; and the
// checker holding a rollback build's package to its STORE version.
describe("the changelog reader", () => {
  const TAG10 = "browser-v2026.10.2";
  const head = (h) => `# Changelog\n\ntext\n\n## ${h}\n\nbody\n\n## browser-v2026.10.1+kount.3 — release\n`;
  test("an ordinary entry: the store version is the lock's tag and n; the source is the lock", async () => {
    const { topEntry } = await import("./changelog.mjs");
    assert.deepEqual(topEntry(head(`${TAG10}+kount.1 — candidate`), TAG10), {
      label: `${TAG10}+kount.1`, version: "2026.10.2.1", status: "candidate", tag: TAG10, n: 1, source: TAG10, sourceVersion: "2026.10.2", rollback: false,
    });
  });
  test("a rollback entry: the replaced release's tag and the next n, built from the lock's older source", async () => {
    const { topEntry } = await import("./changelog.mjs");
    assert.deepEqual(topEntry(head(`browser-v2026.11.0+kount.2 — release, rollback to ${TAG10}`), TAG10), {
      label: "browser-v2026.11.0+kount.2", version: "2026.11.0.2", status: "release", tag: "browser-v2026.11.0", n: 2, source: TAG10, sourceVersion: "2026.10.2", rollback: true,
    });
  });
  for (const [title, heading, reason] of [
    ["another tag with no rollback clause", `browser-v2026.11.0+kount.2 — release`, /entry-tag/],
    ["a rollback to a tag that is not the lock's", `browser-v2026.11.0+kount.2 — release, rollback to browser-v2026.10.1`, /rollback-source/],
    ["a rollback to the same tag", `${TAG10}+kount.2 — release, rollback to ${TAG10}`, /rollback-not-older/],
    ["a rollback to a NEWER tag", `browser-v2026.9.0+kount.2 — release, rollback to ${TAG10}`, /rollback-not-older/],
    ["a malformed rollback clause", `browser-v2026.11.0+kount.2 — release, rolled back to ${TAG10}`, /malformed-entry/],
    ["a version part over 65535", `browser-v2026.70000.0+kount.1 — release, rollback to ${TAG10}`, /entry-version/],
  ]) {
    test(`refuses ${title}`, async () => {
      const { topEntry } = await import("./changelog.mjs");
      assert.throws(() => topEntry(head(heading), TAG10), reason);
    });
  }
  // Review round 14 PR-MED-012: the top entry's store version strictly above every earlier RELEASE entry's.
  const history = (top, ...earlier) => `# Changelog\n\n## ${top}\n\nbody\n${earlier.map((h) => `\n## ${h}\n\nbody\n`).join("")}`;
  const R3 = `browser-v2026.11.0+kount.3 — release, rollback to ${TAG10}`; // released 2026.11.0.3
  for (const [title, text] of [
    ["an equal store version (a rollback reusing the replaced release's number)", history(`browser-v2026.11.0+kount.3 — release, rollback to ${TAG10}`, R3)],
    ["a lower store version", history(`browser-v2026.11.0+kount.2 — release, rollback to ${TAG10}`, R3, "browser-v2026.11.0+kount.1 — release")],
    ["an intermediate target below a newer release", history(`browser-v2026.11.0+kount.2 — release, rollback to ${TAG10}`, "browser-v2026.12.0+kount.1 — release", "browser-v2026.11.0+kount.1 — release")],
    ["an ordinary entry reusing a released version", history(`${TAG10}+kount.1 — release`, `${TAG10}+kount.1 — release`)],
    ["a candidate below a release", history(`${TAG10}+kount.1 — candidate`, "browser-v2026.11.0+kount.1 — release")],
  ]) {
    test(`refuses ${title}`, async () => {
      const { topEntry } = await import("./changelog.mjs");
      assert.throws(() => topEntry(text, TAG10), /entry-not-newer/);
    });
  }
  test("accepts the valid next number over the replaced release, and ignores earlier candidates", async () => {
    const { topEntry } = await import("./changelog.mjs");
    assert.equal(topEntry(history(`browser-v2026.11.0+kount.4 — release, rollback to ${TAG10}`, R3, "browser-v2026.11.0+kount.2 — release"), TAG10).version, "2026.11.0.4");
    assert.equal(topEntry(history(`${TAG10}+kount.1 — candidate`, `${TAG10}+kount.2 — candidate`), TAG10).version, "2026.10.2.1");
    // Earlier entries' sources are history: an old rollback clause to another tag is not compared with today's lock.
    assert.equal(topEntry(history(`${TAG10}+kount.2 — release`, `${TAG10}+kount.1 — release, rollback to browser-v2026.9.0`), TAG10).version, "2026.10.2.2");
  });
  test("refuses an earlier heading that is not an entry (a hidden release cannot be skipped)", async () => {
    const { topEntry } = await import("./changelog.mjs");
    assert.throws(() => topEntry(history(`${TAG10}+kount.2 — release`, "Notes on the first build"), TAG10), /history-malformed/);
  });
  test("the CLI prints the store version and the source version for build.sh", () => {
    const dir = join(scratch, `cli-${n++}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "CHANGELOG.md"), head(`browser-v2026.11.0+kount.2 — release, rollback to ${TAG10}`));
    writeFileSync(join(dir, "upstream.lock"), LOCK);
    const r = spawnSync("node", [join(HERE, "changelog.mjs"), join(dir, "CHANGELOG.md"), join(dir, "upstream.lock")], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(r.stdout, `CHANGELOG_TOP label=browser-v2026.11.0+kount.2 version=2026.11.0.2 status=release source=${TAG10} source_version=2026.10.2\n`);
  });
  test("the checker holds a rollback build's package to its store version, and refuses the source's", () => {
    const rollback = `# Changelog\n\n## browser-v2026.11.0+kount.2 — release, rollback to ${TAG10}\n`;
    // The store label and version, built from the lock's older source (NOTICE.txt names both).
    const good = {
      "manifest.json": (m) => m.replace(VERSION, "2026.11.0.2"),
      "NOTICE.txt": renderNotice(TEMPLATE, { ...NOTICE_VALUES, label: "browser-v2026.11.0+kount.2", version: "2026.11.0.2" }),
    };
    passes(run({ mode: "--release", changelogText: rollback, over: { chrome: good, edge: good, firefox: good } }));
    fails(run({ mode: "--release", changelogText: rollback }), /version "2026\.10\.2\.1", the top CHANGELOG\.md entry says 2026\.11\.0\.2/);
  });
});

// Round 47 PR-MED-037: the fixture archive the checker accepts is one the documented extractor (GNU tar) reads, and a
// header the checker refuses for its checksum is one GNU tar refuses too.
describe("the fixture archive and GNU tar", () => {
  const write = (members) => {
    const file = join(scratch, `gnu-${n++}.tar.gz`);
    writeFileSync(file, zlib.gzipSync(tar(members)));
    return file;
  };
  test("the passing fixture, a long name included, is listed whole by tar -tzf", () => {
    const members = [{ name: "./", type: "5" }, ...archiveMembers(changelog("candidate"))];
    assert.ok(members.some((m) => m.name === LONG_UPSTREAM));
    const r = spawnSync("tar", ["-tzf", write(members)], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.stdout.split("\n").filter(Boolean), members.map((m) => m.name));
  });
  test("a wrong checksum is refused by tar -tzf too", () => {
    const r = spawnSync("tar", ["-tzf", write([{ name: "./x", data: "x", fields: { checksum: "wrong" } }])], { encoding: "utf8" });
    assert.notEqual(r.status, 0);
  });
});

// The notices generator (plan T3.9), offline: which modules count as bundled, and what each package's section says.
describe("the notices generator", () => {
  const mod = (path, chunks = [1], inner) => ({ nameForCondition: path, chunks, ...(inner ? { modules: inner } : {}) });
  test("bundled packages: the last node_modules in each path, scoped names whole; orphans, runtime and stand-ins skipped", () => {
    const stats = {
      children: [
        { modules: [
          mod("/src/node_modules/lit/index.js"),
          mod("/src/node_modules/@angular/core/fesm2022/core.mjs"),
          mod("/src/node_modules/a/node_modules/b/x.js"),
          mod("/src/node_modules/orphan/x.js", []),
          mod("webpack/runtime/global"),
          { identifier: "ignored|/src/node_modules/jszip/lib|crypto", chunks: [1] },
          mod("/src/libs/common/x.ts", [1], [mod("/src/node_modules/tslib/tslib.es6.mjs", [])]),
          { identifier: "/src/node_modules/babel-loader/lib/index.js!/src/node_modules/rxjs/dist/esm/index.js?x", chunks: [2] },
        ] },
      ],
    };
    assert.deepEqual([...bundledPackageDirs(stats)].sort(), [
      "/src/node_modules/@angular/core", "/src/node_modules/a/node_modules/b", "/src/node_modules/lit", "/src/node_modules/rxjs", "/src/node_modules/tslib",
    ]);
  });
  test("a stats file naming no module is refused", () => assert.throws(() => bundledPackageDirs({ modules: [] }), /the stats name no bundled module/));
  test("each package's stated licence and files; a workspace link skipped; no licence file said so; the commercial SDK refused", () => {
    const root = join(scratch, `gen-${n++}`);
    const pkgDir = (name, json, files = {}) => {
      const d = join(root, "node_modules", name);
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, "package.json"), JSON.stringify(json));
      for (const [f, t] of Object.entries(files)) writeFileSync(join(d, f), t);
      return d;
    };
    const lit = pkgDir("lit", { name: "lit", version: "3.3.1", license: "BSD-3-Clause" }, { LICENSE: "BSD text" });
    const bare = pkgDir("@x/bare", { name: "@x/bare", version: "1.0.0", license: "MIT" });
    mkdirSync(join(root, "libs", "common"), { recursive: true });
    writeFileSync(join(root, "libs", "common", "package.json"), JSON.stringify({ name: "@bitwarden/common", version: "0.0.0" }));
    mkdirSync(join(root, "node_modules", "@bitwarden"), { recursive: true });
    symlinkSync(join(root, "libs", "common"), join(root, "node_modules", "@bitwarden", "common"));
    const out = thirdPartyNotices([lit, bare, join(root, "node_modules", "@bitwarden", "common")], ["popup/fonts/inter.abc.woff2"], join(HERE, "notice"));
    assert.match(out, /^Packages \(2\): @x\/bare 1\.0\.0, lit 3\.3\.1$/m);
    // The round trip (review round 55): the generator writes the one preamble the checker holds the file to.
    assert.equal(out.slice(0, out.search(/^==== .+ ====$/m)), thirdPartyPreamble(["@x/bare 1.0.0", "lit 3.3.1"]));
    assert.match(out, /==== lit 3\.3\.1 — licence: BSD-3-Clause ====\n--- LICENSE ---\nBSD text\n/);
    assert.match(out, /==== @x\/bare 1\.0\.0 — licence: MIT ====\n\(the package carries no licence file/);
    assert.doesNotMatch(out, /@bitwarden\/common/);
    assert.ok(out.includes(INTER_OFL.trimEnd()), "the Inter licence follows its section");
    const commercial = pkgDir("@bitwarden/commercial-sdk-internal", { name: "@bitwarden/commercial-sdk-internal", version: "0.2.0" });
    assert.throws(() => thirdPartyNotices([commercial], []), /the commercial SDK was bundled/);
  });
});

// The checker's own rules beside it (plan T3.8, T3.9): checked through the module, which takes another rules directory.
describe("the checker's own rules", () => {
  // A copy of the real kit (the archive is held to the kit beside the checker), its build/ edited, the archive built
  // from the copy.
  const kitCopy = (edit) => {
    const root = join(scratch, `rules-${n++}`);
    for (const d of ["patches", "overlay", "assets", "build"]) cpSync(join(KIT, d), join(root, d), { recursive: true });
    edit(join(root, "build"));
    return root;
  };
  const withRules = (edit, opts = {}) => {
    const root = kitCopy(edit);
    const { dir, app } = run({ ...opts, kitRoot: root });
    return import("./check-artefacts.mjs").then(({ checkArtefacts }) => checkArtefacts(dir, { appDir: app, kitDir: join(root, "build") }).problems.join("\n"));
  };
  test("the real rules pass the good build", async () => assert.equal(await withRules(() => {}), ""));
  test("no reviewed list", async () => assert.match(await withRules((k) => rmSync(join(k, "reviewed-images.tsv"))), /no build\/reviewed-images\.tsv/));
  test("a malformed reviewed line", async () => {
    assert.match(await withRules((k) => writeFileSync(join(k, "reviewed-images.tsv"), "# x\nimages/icon16.png\n")), /reviewed-images\.tsv line 2 is not/);
  });
  test("a reviewed list that does not name the icon's hash", async () => {
    assert.match(await withRules((k) => writeFileSync(join(k, "reviewed-images.tsv"), `${"0".repeat(64)}\timages/icon16.png\tx\n`)), /images\/icon16\.png .* is a picture or font/);
  });
  test("an embedded font the list names under <file>#embedded passes, with its notice section and licence", async () => {
    const css = "@font-face{font-family:\"Source Code Pro\";font-weight:400;src:url(data:font/woff2;base64,d09GMg==)}";
    const font = OTHER_MATERIAL.find((m) => m.licence === "source-code-pro-OFL.txt");
    const licence = readFileSync(join(HERE, "notice", font.licence), "utf8").trimEnd();
    const problems = await withRules((k) => writeFileSync(join(k, "reviewed-images.tsv"), `${readFileSync(join(HERE, "reviewed-images.tsv"), "utf8")}${sha(Buffer.from("d09GMg==", "base64"))}\toverlay/menu-list.css#embedded\ta planted font\n`), {
      over: Object.fromEntries(["chrome", "edge", "firefox"].map((t) => [t, {
        "overlay/menu-list.css": css,
        "THIRD-PARTY-NOTICES.txt": (x) => `${x}==== ${font.title} ====\n${font.text}\n\n${licence}\n`,
      }])),
    });
    assert.equal(problems, "");
  });
  test("the same reviewed font passes under every case spelling of its URL (review round 48 PR-MED-041)", async () => {
    const font = OTHER_MATERIAL.find((m) => m.licence === "source-code-pro-OFL.txt");
    const licence = readFileSync(join(HERE, "notice", font.licence), "utf8").trimEnd();
    for (const url of ["DATA:font/woff2;base64,d09GMg==", "data:FONT/WOFF2;base64,d09GMg==", "data:font/woff2;charset=utf-8;BaSe64,d09GMg=="]) {
      const problems = await withRules((k) => writeFileSync(join(k, "reviewed-images.tsv"), `${readFileSync(join(HERE, "reviewed-images.tsv"), "utf8")}${sha(Buffer.from("d09GMg==", "base64"))}\toverlay/menu-list.css#embedded\ta planted font\n`), {
        over: Object.fromEntries(["chrome", "edge", "firefox"].map((t) => [t, {
          "overlay/menu-list.css": `@font-face{font-family:"Source Code Pro";font-weight:400;src:url(${url})}`,
          "THIRD-PARTY-NOTICES.txt": (x) => `${x}==== ${font.title} ====\n${font.text}\n\n${licence}\n`,
        }])),
      });
      assert.equal(problems, "", url);
    }
  });
  test("no notice template", async () => assert.match(await withRules((k) => rmSync(join(k, "notice", "NOTICE.template.txt"))), /no build\/notice\/NOTICE\.template\.txt/));
  test("a template the packages no longer match", async () => {
    assert.match(await withRules((k) => writeFileSync(join(k, "notice", "NOTICE.template.txt"), `${TEMPLATE}\nA new line.\n`)), /NOTICE\.txt is not the notice template's text/);
  });
});

describe("the glyph scan against JavaScript's own evaluation (review round 48 PR-MED-040)", () => {
  // Each expression is written by this test (no package code is evaluated): the count must equal the uses of the point
  // in the string JavaScript makes of it, for every spelling inside the stated grammar.
  const P = 0xe900;
  for (const js of [
    '"\\ue900"', '"\\ue900\\udc00"', '"\\ud83a\\udd00"', '"\\u{E900}"', '"\\u{0000e900}"', '"\\u{1e900}"', '"\\ue900A"',
    "String.fromCharCode(0xe900)", "String.fromCharCode(0x1e900)", "String.fromCharCode(-5888)", "String.fromCharCode(59648.0)",
    "String.fromCharCode(5.9648e4)", "String.fromCharCode(0x1_e900)", 'String.fromCharCode("59648")', "String.fromCharCode('0xe900')",
    "String.fromCharCode(`59648`)", "String.fromCharCode(0o164400)", "String.fromCharCode(0b1110100100000000)", "String.fromCharCode(65, 0xe900,)",
    "String.fromCharCode(0xd83a, 0xdd00)", "String.fromCharCode(59648.9)", "String.fromCharCode(1e400)", "String.fromCharCode()",
    "String.fromCodePoint(59648)", "String.fromCodePoint(59648.0)", "String.fromCodePoint(5.9648e4)", "String.fromCodePoint(0x1e900)",
    "String.fromCodePoint(.59648e5)", 'String.fromCodePoint("0xe900")',
  ]) {
    test(js, async () => {
      const { codePointUses } = await import("./check-artefacts.mjs");
      const present = [...new Function(`return ${js};`)()].filter((c) => c.codePointAt(0) === P).length;
      assert.equal(codePointUses(`el.textContent=${js};`, P), present);
    });
  }
  // Review round 49 PR-MED-043: ECMAScript's whole escape table, held to JavaScript's own reading of each escape.
  test("every escape of 0x00–0x7F, U+2028 and U+2029 decodes as JavaScript reads it", async () => {
    const { decodeJsEscapes } = await import("./check-artefacts.mjs");
    const points = [...Array.from({ length: 0x80 }, (_, i) => i), 0x2028, 0x2029];
    let compared = 0;
    for (const p of points) {
      const ch = String.fromCharCode(p);
      let want;
      try {
        want = new Function(`return "\\${ch}";`)();
      } catch {
        continue; // `\x` / `\u` with nothing after them are syntax errors in JavaScript; their forms are tested below
      }
      assert.equal(decodeJsEscapes(`\\${ch}`), want, `the escape of U+${p.toString(16).padStart(4, "0")}`);
      compared++;
    }
    assert.ok(compared >= 126, `compared ${compared}`);
    for (const lit of ["\\x41", "\\x4d22", "\\u0041", "\\u{1F600}", "\\u{0000e900}", "\\101", "\\08", "\\0", "\\377", "\\400", "\\1234", "a\\\r\nb", "\\\\n", "\\\\\\n"]) {
      assert.equal(decodeJsEscapes(lit), new Function(`return "${lit}";`)(), lit);
    }
  });
  // Review round 50 PR-MED-046: a string argument is lexed as ECMAScript lexes it — the whole matrix of line
  // continuations, quote forms and positions, with real bytes, against JavaScript's own reading of the same call.
  test("every line continuation in every quote form, before, within and after the number, as JavaScript reads it", async () => {
    const { codePointUses } = await import("./check-artefacts.mjs");
    const [CR, LF, LS, PS, BS] = [13, 10, 0x2028, 0x2029, 92].map((c) => String.fromCharCode(c));
    let compared = 0;
    for (const api of ["fromCharCode", "fromCodePoint"]) {
      for (const cont of [BS + LF, BS + CR, BS + CR + LF, BS + LS, BS + PS]) {
        for (const [open, close] of [['"', '"'], ["'", "'"], ["`", "`"]]) {
          for (const body of [`${cont}59648`, `596${cont}48`, `59648${cont}`]) {
            const src = `String.${api}(${open}${body}${close})`;
            const present = [...new Function(`return ${src};`)()].filter((c) => c.codePointAt(0) === P).length;
            assert.equal(codePointUses(`el.textContent=${src};`, P), present, JSON.stringify(src));
            compared++;
          }
        }
      }
    }
    assert.equal(compared, 90);
  });
  // Review round 51: no bound inside a stated grammar fails open — each former bound tested at, just past and well past.
  test("a braced escape with any number of leading zeroes decodes as JavaScript reads it (PR-MED-047)", async () => {
    const { decodeJsEscapes, codePointUses } = await import("./check-artefacts.mjs");
    const BS = String.fromCharCode(92);
    // The former window held `u{` + 8 hex digits + `}`: 4 leading zeroes before e900 was at the bound, 5 just past.
    for (const zeros of [0, 3, 4, 5, 6, 8, 12, 40, 1000]) {
      const esc = `${BS}u{${"0".repeat(zeros)}e900}`;
      assert.equal(decodeJsEscapes(esc), new Function(`return "${esc}";`)(), `${zeros} leading zeroes`);
      const call = `String.fromCharCode("${BS}u{${"0".repeat(zeros)}35}9648")`;
      assert.equal(codePointUses(call, P), [...new Function(`return ${call};`)()].filter((c) => c.codePointAt(0) === P).length, `${zeros} zeroes in a call argument`);
    }
    assert.equal(decodeJsEscapes(`${BS}u{110000}`), `${BS}u{110000}`, "past U+10FFFF is a SyntaxError to JavaScript: the escape is left as written");
  });
  test("a call's closing parenthesis after any amount of white space (the former 64-character look-ahead)", async () => {
    const { codePointUses, literalCallResults } = await import("./check-artefacts.mjs");
    for (const n of [0, 63, 64, 65, 200, 100000]) {
      const src = `String.fromCharCode(0xe900,${" ".repeat(n)})`;
      assert.equal(codePointUses(src, P), 1, `a trailing comma then ${n} spaces`);
      assert.equal(literalCallResults(`String.fromCharCode(${" ".repeat(n)})`).length, 1, `an empty call with ${n} spaces`);
    }
  });
  test("the call grammar reads in linear time: an unterminated body of escaped CRLFs, long white space", async () => {
    const { literalCallResults } = await import("./check-artefacts.mjs");
    const crlf = String.fromCharCode(92, 13, 10);
    // With two ways to match each escaped CRLF, 40 of them would backtrack 2^40 times; one way reads them once.
    for (const open of ["`", '"', "'"]) assert.deepEqual(literalCallResults(`String.fromCharCode(${open}${crlf.repeat(40)}`), [], open);
    assert.deepEqual(literalCallResults(`String.fromCharCode(${" ".repeat(200000)}x)`), [], "white space then a non-literal");
  });
  test("an argument list of any length is read without overflowing the stack (the former spread)", async () => {
    const { codePointUses, literalCallResults } = await import("./check-artefacts.mjs");
    for (const n of [8191, 8192, 8193, 300000]) {
      const src = `String.fromCharCode(${Array(n).fill("65").join(",")},0xe900)`;
      assert.equal(codePointUses(src, P), 1, `${n + 1} arguments`);
    }
    // A surrogate pair split across two chunks still pairs: U+1E900 is not U+E900.
    const split = `String.fromCharCode(${Array(8191).fill("65").join(",")},0xd83a,0xdd00)`;
    assert.equal(literalCallResults(split)[0].codePointAt(8191), 0x1e900);
    assert.equal(codePointUses(split, P), 0);
  });
  test("the lexical controls: what a quoted body may not hold, and where it ends", async () => {
    const { codePointUses, literalCallResults } = await import("./check-artefacts.mjs");
    const [CR, LF, LS, BS] = [13, 10, 0x2028, 92].map((c) => String.fromCharCode(c));
    for (const raw of [LF, CR]) {
      for (const q of ['"', "'"]) {
        const src = `String.fromCharCode(${q}59648${raw}${q})`;
        assert.throws(() => new Function(`return ${src};`), SyntaxError);
        assert.equal(literalCallResults(src).length, 0, `a raw ${raw === LF ? "LF" : "CR"} in ${q}…${q} is not read`);
        assert.equal(codePointUses(src, P), 0);
      }
    }
    assert.equal(literalCallResults(`String.fromCharCode("596${LS}48")`).length, 1, "a raw U+2028 is read (ES2019 allows it)");
    assert.equal(literalCallResults(`String.fromCharCode(\`596${LF}48\`)`).length, 1, "a raw LF is read in a template");
    assert.equal(codePointUses(`String.fromCharCode("59648${BS}"")`, P), 0, "an escaped quote does not close the body");
    assert.equal(codePointUses(`String.fromCharCode("59648", "65")`, P), 1, "the closing quote, then a second argument");
    assert.equal(codePointUses(`String.fromCharCode("${BS}${CR}${LF}59648${BS}"")`, P), 0, "a continuation does not swallow the closing quote");
  });
  test("a fromCodePoint argument out of range draws nothing (the call throws)", async () => {
    const { codePointUses } = await import("./check-artefacts.mjs");
    assert.throws(() => String.fromCodePoint(59648.5), RangeError);
    assert.equal(codePointUses("String.fromCodePoint(59648.5, 0xe900)", P), 0);
  });
  test("the documented limit: arguments outside the literal grammar are not read", async () => {
    const { codePointUses } = await import("./check-artefacts.mjs");
    for (const js of ["String.fromCharCode([59648])", "String.fromCharCode.apply(null,[0xe900])", "String.fromCharCode(...[0xe900])", "String.fromCharCode(0xe800+0x100)", "String.fromCharCode(x)"]) {
      assert.equal(codePointUses(js, P), 0, js);
    }
  });
  test("a stylesheet's escaped definition is counted once", async () => {
    const { codePointUses } = await import("./check-artefacts.mjs");
    assert.equal(codePointUses('.bwi-shield:before{content:"\\e900"}', P), 1);
    assert.equal(codePointUses('.bwi-shield:before{content:"\\e900"}.x:after{content:"\\e900 "}', P), 2);
  });
});

describe("the data: URL classifier (review round 48 PR-MED-041)", () => {
  test("a payload running on through an escape is left to the reading that decodes it", async () => {
    const { dataUrls, decodeJsEscapes } = await import("./check-artefacts.mjs");
    const text = 'const u="data:image/png;base64,iVBO\\/w0KGgo=";';
    assert.deepEqual(dataUrls(text), []);
    const [url] = dataUrls(decodeJsEscapes(text));
    assert.equal(url.picture, true);
    assert.equal(url.undecodable, false);
  });
  test("an escaped payload in a package is hashed, not refused as undecodable", () => {
    const r = run({ over: { chrome: { "popup/main.js": (b) => `${b}const u="data:image/png;base64,iVBO\\/w0KGgo=";` } } });
    fails(r, /popup\/main\.js embeds a image\/png .* does not name under popup\/main\.js#embedded/);
    assert.doesNotMatch(r.out, /does not decode/);
  });
});

describe("the data: URL head is read whole (review round 51 PR-MED-048)", () => {
  test("a head of any length, by a parameter or by tabs the URL parser removes, and the scan stays linear", async () => {
    const { dataUrls } = await import("./check-artefacts.mjs");
    const png = "iVBORw0KGgo=";
    // The former matcher held a head of at most 1,024 characters: `image/png;x=` (12) + n + `;base64` (7).
    for (const n of [1000, 1005, 1006, 1100, 5000, 1000000]) {
      const [url, ...rest] = dataUrls(`<img src="data:image/png;x=${"a".repeat(n)};base64,${png}">`);
      assert.equal(rest.length, 0);
      assert.ok(url && url.type === "image/png" && url.picture, `a head of ${n + 19} characters`);
    }
    const tabs = String.fromCharCode(9).repeat(1100);
    assert.equal(dataUrls(`<img src="data:image/png${tabs};base64,${png}">`)[0]?.type, "image/png", "1,100 tabs inside the head");
    // A `data:` inside an earlier head is part of that head, as the browser reads it — one URL, read once: 200,000 of
    // them would take minutes if each were read on to the comma.
    const many = `<img src="data:x;${"data:".repeat(200000)}image/png;base64,${png}">`;
    const urls = dataUrls(many);
    assert.equal(urls.length, 1);
    assert.equal(urls[0].picture, true, "a picture by its bytes, whatever the head says");
    // Two URLs, the second inside the first's payload (an srcset): each is read; the first's payload ends at the second.
    const two = dataUrls(`<img srcset="data:image/png;base64,${png} 1x, data:image/svg+xml;base64,PHN2Zz4= 2x">`);
    assert.deepEqual(two.map((u) => u.type), ["image/png", "image/svg+xml"]);
  });
});

describe("upstream's tree, rebuilt as git builds it (review round 48 PR-MED-042)", () => {
  test("the empty tree has git's well-known id", () => assert.equal(gitTreeId(new Map()), "4b825dc642cb6eb9a060e54bf8d69288fbee4904"));
  test("a nested tree, with names that sort differently as trees, has the id git write-tree gives it", () => {
    const repo = join(scratch, `git-${n++}`);
    const files = { "a.b": "1\n", "a-c": "2\n", "a/b": "3\n", "a/c/d.sh": "4\n", "ab": "5\n", "z/y/x/w.ts": "6\n" };
    for (const [p, d] of Object.entries(files)) {
      mkdirSync(join(repo, dirname(p)), { recursive: true });
      writeFileSync(join(repo, p), d, { mode: p.endsWith(".sh") ? 0o755 : 0o644 });
    }
    const git = (...args) => spawnSync("git", ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-C", repo, ...args], { encoding: "utf8" });
    assert.equal(git("init", "-q").status, 0);
    assert.equal(git("add", "-A").status, 0);
    const want = git("write-tree").stdout.trim();
    const listing = new Map(Object.entries(files).map(([p, d]) => [p, { mode: p.endsWith(".sh") ? "100755" : "100644", oid: gitObjectId("blob", Buffer.from(d)) }]));
    assert.equal(gitTreeId(listing), want);
  });
  test("a file and a directory of one name cannot share a tree", () => {
    assert.equal(gitTreeId(new Map([["a", { mode: "100644", oid: "0".repeat(40) }], ["a/b", { mode: "100644", oid: "0".repeat(40) }]])), null);
  });
  test("the fixture's record proves itself against its lock", () => {
    const { problems, listing } = readUpstreamTree(UPSTREAM.record, UPSTREAM.commit);
    assert.deepEqual(problems, []);
    assert.equal(listing.size, UPSTREAM.files.size);
  });
});

// The typeface licence texts are the projects' own bytes (README § The source offer pins each by sha256). Git must
// never convert their line ends (`apps/kount-extension/.gitattributes`): the root's `* text=auto eol=lf` once stored
// source-code-pro-OFL.txt's CRLF lines as LF, so a fresh checkout held other bytes than the pin and the local builds.
describe("the pinned licence texts, byte for byte as committed", () => {
  const app = join(HERE, "..");
  const git = (...args) => spawnSync("git", ["-c", "core.fsmonitor=false", "-C", app, ...args], { encoding: "utf8" });
  const readme = readFileSync(join(app, "README.md"), "utf8").replace(/\s+/g, " ");
  for (const [file, prefix] of [["inter-OFL.txt", "262481e8"], ["open-sans-OFL.txt", "01cd5ffb"], ["source-code-pro-OFL.txt", "7c940e28"]]) {
    test(`build/notice/${file}: README's pin, these bytes, and no line-end conversion`, () => {
      assert.ok(readme.includes(`sha256 \`${prefix}…\``), `README pins ${file} at ${prefix}…`);
      assert.ok(sha(readFileSync(join(HERE, "notice", file))).startsWith(prefix), "the checked-out bytes are the pinned ones");
      const r = git("check-attr", "text", "--", `build/notice/${file}`);
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /: text: unset$/m, "git never converts its line ends");
    });
  }
  test("no tracked text file in the directory holds a CRLF its attributes would let git convert", () => {
    const listed = git("ls-files", "-z");
    assert.equal(listed.status, 0, listed.stderr);
    const converted = [];
    for (const path of listed.stdout.split("\0").filter(Boolean)) {
      let bytes;
      try {
        bytes = readFileSync(join(app, path));
      } catch {
        continue; // deleted in the working tree
      }
      if (!bytes.includes("\r\n") || bytes.subarray(0, 8000).includes(0)) continue; // no CRLF, or binary to git
      if (!/: text: unset$/m.test(git("check-attr", "text", "--", path).stdout)) converted.push(path);
    }
    assert.deepEqual(converted, []);
  });
});

describe("usage", () => {
  test("no directory, two directories, or two modes exits 2", () => {
    for (const args of [[], [scratch, scratch], ["--release", "--proofs", scratch], [join(scratch, "absent")]]) {
      assert.equal(spawnSync("bash", [CHECKER, ...args], { encoding: "utf8" }).status, 2, args.join(" "));
    }
  });
});
