// The GPL-3.0 files each package carries (plan T3.9), written into the build output by in-container.sh before it zips:
//
//   LICENSE.txt               GPL-3.0, upstream's LICENSE_GPL.txt from the applied tree, unchanged
//   LICENSE-UPSTREAM.txt      upstream's own licence notice (LICENSE.txt), unchanged
//   NOTICE.txt                NOTICE.template.txt filled in: that Kount modified the work and since when, the build, the
//                             upstream release and commit, where the corresponding source is, and the SDK module's source
//   THIRD-PARTY-NOTICES.txt   every third-party npm package webpack bundled (from its own stats, so a package whose
//                             source maps hide its path is still found), each with its package.json licence and its
//                             licence file(s); then the fonts and pictures bundled with terms of their own
//
//   node /kext/notice/notices.mjs <stats.json> <build dir> <tree>       (inside the build container only)
//
// Reads the stats and the installed packages as data; runs nothing from them. Fails (exit 1) on a bundled package with
// no package.json, on the commercial SDK, and on a stats file naming no module.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The public fork that holds each build's corresponding source (README § The source offer; its name is T4.1's). */
export const FORK = "https://github.com/kountlabs/clients";
/** Where a build's corresponding source is: its tag on the fork (NOTICE.txt names it; the checker holds it to this). */
export const sourceUrl = (label) => `${FORK}/tree/${label}`;

/** The NOTICE.txt a build with these values carries — the checker renders it again to hold a package to it. */
export function renderNotice(template, v) {
  const values = {
    LABEL: v.label,
    VERSION: v.version,
    UPSTREAM_TAG: v.upstreamTag,
    UPSTREAM_COMMIT: v.upstreamCommit,
    SOURCE_URL: sourceUrl(v.label),
    SDK_VERSION: v.sdkVersion,
    SDK_COMMIT: v.sdkCommit,
  };
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (all, key) => {
    if (typeof values[key] !== "string" || values[key] === "") throw new Error(`NOTICE: no value for {{${key}}}`);
    return values[key];
  });
}

/**
 * The fonts and pictures bundled with terms of their own (not npm packages). Each is present when `match` (a package
 * path) names a file of the package, or `embedded` matches the text of one of its stylesheets; `text` is what the
 * notices file says, `licence` a file in this directory reproduced in full. The three font licences are each project's
 * published licence file, read 2026-11-12 (README § The source offer).
 */
export const OTHER_MATERIAL = [
  {
    match: /^popup\/fonts\/inter\.[0-9a-f]+\.woff2$/,
    title: "The Inter typeface (popup/fonts/inter.*.woff2)",
    text: "From upstream's libs/components/src/webfonts/inter.woff2. Licensed under the SIL Open Font License 1.1; its notice and licence (https://github.com/rsms/inter, LICENSE.txt) follow.",
    licence: "inter-OFL.txt",
  },
  {
    embedded: /font-family:\s*"Open Sans"[^}]*url\(data:font\//,
    title: "The Open Sans typeface (embedded in the inline menu's stylesheets)",
    text: "From upstream's apps/browser/src/autofill/shared/styles/webfonts.scss, which embeds it. Licensed under the SIL Open Font License 1.1; its notice and licence (https://github.com/googlefonts/opensans, OFL.txt) follow.",
    licence: "open-sans-OFL.txt",
  },
  {
    embedded: /font-family:\s*"Source Code Pro"[^}]*url\(data:font\//,
    title: "The Source Code Pro typeface (embedded in the inline menu's stylesheets)",
    text: "From upstream's apps/browser/src/autofill/shared/styles/webfonts.scss, which embeds it. Licensed under the SIL Open Font License 1.1; its notice and licence (https://github.com/adobe-fonts/source-code-pro, LICENSE.md) follow.",
    licence: "source-code-pro-OFL.txt",
  },
  {
    embedded: /\/\*! tailwindcss v[\d.]+ \| MIT License/,
    title: "Tailwind CSS (its base styles, compiled into the stylesheets)",
    text: "Upstream's stylesheets are built with Tailwind CSS, whose base styles are compiled into them (not bundled as a module, so not listed above); its MIT notice is kept in them. The installed package's licence follows.",
    package: "tailwindcss",
  },
  {
    match: /^popup\/images\/(amex|diners_club|discover|jcb|maestro|mastercard|ru_pay|union_pay|visa)-(dark|light)\.png$/,
    title: "Payment card brand logos (popup/images/<brand>-dark.png, -light.png)",
    text: "Upstream's pictures of the card brands' logos, shown beside a stored card to name its brand. Each logo is a trade mark of its owner; none of them endorses this program.",
  },
  {
    match: /^popup\/images\/(yubikey|u2fkey)\.jpg$/,
    title: "Security key pictures (popup/images/yubikey.jpg, u2fkey.jpg)",
    text: "Upstream's pictures of hardware security keys, shown in the two-step sign-in screens. Any trade mark on them belongs to its owner.",
  },
  {
    match: /^images\/(health-tab\/health_intro(_dark)?\.png|at-risk-password-carousel\/review_at-risk_logins\.(light|dark)\.png)$/,
    title: "Illustrations with other companies' logos (images/health-tab/, images/at-risk-password-carousel/review_at-risk_logins.*)",
    text: "Upstream's illustrations of the password health and at-risk screens show example websites' logos (among them GitHub, Microsoft, Facebook and LinkedIn). Each logo is a trade mark of its owner; none of them endorses this program.",
  },
];

const LICENCE_FILE = /^(licen[cs]e|copying|notice)(\.(md|txt|markdown|mit|bsd))?$|^licen[cs]e[-_.]/i;

/** The npm packages a stats file shows webpack put in a chunk: { dir → true }, by the last node_modules in each path. */
export function bundledPackageDirs(stats) {
  const dirs = new Set();
  let modules = 0;
  const resource = (m) => {
    const raw = m.nameForCondition ?? m.identifier ?? "";
    return raw.slice(raw.lastIndexOf("!") + 1).split("?")[0];
  };
  const take = (m) => {
    modules++;
    const path = resource(m);
    // Only a file webpack read: not its runtime, an external or an `ignored|…` stand-in (a Node built-in left out).
    const at = path.lastIndexOf("/node_modules/");
    if (!path.startsWith("/") || path.includes("|") || at < 0) return;
    const rest = path.slice(at + "/node_modules/".length).split("/");
    const name = rest[0].startsWith("@") ? `${rest[0]}/${rest[1]}` : rest[0];
    dirs.add(path.slice(0, at + "/node_modules/".length) + name);
  };
  const walk = (s) => {
    for (const m of s.modules ?? []) {
      // A module in no chunk (an orphan) was not bundled; a concatenated module's parts were.
      if (!Array.isArray(m.chunks) || m.chunks.length === 0) continue;
      take(m);
      for (const inner of m.modules ?? []) take(inner);
    }
    for (const child of s.children ?? []) walk(child);
  };
  walk(stats);
  if (modules === 0) throw new Error("the stats name no bundled module");
  return dirs;
}

/** One package's section: name, version, its package.json licence, and its licence file(s) in full. */
function packageSection(dir) {
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  } catch {
    throw new Error(`no package.json in ${dir}`);
  }
  if (pkg.name === "@bitwarden/commercial-sdk-internal") throw new Error("the commercial SDK was bundled");
  const declared = typeof pkg.license === "string" ? pkg.license : JSON.stringify(pkg.license ?? pkg.licenses ?? "not stated");
  const files = readdirSync(dir).filter((n) => LICENCE_FILE.test(n)).sort();
  const texts = files.map((n) => `--- ${n} ---\n${readFileSync(join(dir, n), "utf8").trimEnd()}\n`);
  // Keyed by name AND version: two bundled versions of one package keep a section (and a licence text) each.
  return {
    key: `${pkg.name} ${pkg.version}`,
    text: `==== ${pkg.name} ${pkg.version} — licence: ${declared} ====\n${texts.length ? texts.join("\n") : `${NO_LICENCE_FILE}\n`}`,
  };
}

/**
 * THIRD-PARTY-NOTICES.txt cut into its sections: each from a `==== <key> ====` line up to the next, with its key. The
 * build records each section's sha256 per target (sdk-hashes.txt `notice` lines) and the checker holds the delivered
 * file to that record (review round 46 PR-MED-032): one reader, so the two cannot cut it differently.
 */
export function noticeSections(text) {
  const sections = [];
  const lines = text.split("\n");
  let current = null;
  for (const line of lines) {
    const head = /^==== (.+) ====$/.exec(line);
    if (head) {
      current = { key: head[1], lines: [line] };
      sections.push(current);
    } else if (current) current.lines.push(line);
  }
  return sections.map((s) => ({ key: s.key, text: s.lines.join("\n") }));
}

/** The line a package without a licence file carries in place of one (fixed text: a lost body is told apart from it). */
export const NO_LICENCE_FILE = "(the package carries no licence file; its package.json states the licence above)";

/** Whether a package holds this material: a file `match` names, or a stylesheet whose text `embedded` matches. */
export function materialPresent(m, files, textOf) {
  return m.match ? files.some((f) => m.match.test(f)) : files.some((f) => f.endsWith(".css") && m.embedded.test(textOf(f)));
}

/**
 * THIRD-PARTY-NOTICES.txt's text before its first section, for the listed "<name> <version>" packages in the order
 * given. One definition, which the generator writes and the checker holds the delivered file to byte for byte (review
 * round 55 PR-MED-052), so every byte of the file is either this or a recorded section.
 */
export function thirdPartyPreamble(names) {
  let out = "THIRD-PARTY NOTICES — Kount Protect\n\n";
  out += "The packages below are bundled into this extension by its build (webpack, from upstream's lockfile), each with the\n";
  out += "licence its package.json states and the licence file(s) it carries, reproduced unchanged. After them: the fonts and\n";
  out += "pictures in this package that carry terms of their own.\n\n";
  out += `Packages (${names.length}): ${names.join(", ")}\n\n`;
  return out;
}

/**
 * THIRD-PARTY-NOTICES.txt for a build: the bundled packages, then the other material its files include (`textOf(path)`
 * reads a stylesheet of the build, for the embedded fonts).
 */
export function thirdPartyNotices(packageDirs, buildFiles, noticeDir = HERE, textOf = () => "", nodeModules = null) {
  const sections = new Map();
  for (const dir of packageDirs) {
    const real = realpathSync(dir);
    // A workspace package (one of upstream's own libs, linked into node_modules) is the program itself, not a third party.
    if (!real.includes("/node_modules/")) continue;
    const s = packageSection(real);
    sections.set(s.key, s.text);
  }
  const names = [...sections.keys()].sort();
  let out = thirdPartyPreamble(names);
  for (const n of names) out += `${sections.get(n)}\n`;
  for (const m of OTHER_MATERIAL) {
    if (!materialPresent(m, buildFiles, textOf)) continue;
    out += `==== ${m.title} ====\n${m.text}\n`;
    if (m.licence) out += `\n${readFileSync(join(noticeDir, m.licence), "utf8").trimEnd()}\n`;
    if (m.package) {
      if (!nodeModules) throw new Error(`${m.title}: no installed packages to read ${m.package}'s licence from`);
      out += `\n${packageSection(join(nodeModules, m.package)).text}`;
    }
    out += "\n";
  }
  return out;
}

function listFiles(root, dir = root, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const f = join(dir, e.name);
    if (e.isDirectory()) listFiles(root, f, out);
    else out.push(f.slice(root.length + 1));
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [statsPath, build, tree, recordPath, target] = process.argv.slice(2);
  const fail = (why) => {
    console.error(`NOTICES_FAIL ${why}`);
    process.exit(1);
  };
  if (!statsPath || !build || !tree || !recordPath || !/^(chrome|edge|firefox)$/.test(target ?? "")) {
    fail("usage: notices.mjs <stats.json> <build dir> <tree> <record file> <chrome|edge|firefox>");
  }
  try {
    const env = (k) => process.env[k] || fail(`no ${k}`);
    const sdkDir = join(tree, "node_modules/@bitwarden/sdk-internal");
    const sdkCommit = readFileSync(join(sdkDir, "VERSION"), "utf8").trim();
    if (!/^[0-9a-f]{40}$/.test(sdkCommit)) fail(`the SDK's VERSION is not a commit: ${JSON.stringify(sdkCommit.slice(0, 60))}`);
    const sdkVersion = JSON.parse(readFileSync(join(sdkDir, "package.json"), "utf8")).version;
    const notice = renderNotice(readFileSync(join(HERE, "NOTICE.template.txt"), "utf8"), {
      label: env("KEXT_LABEL"),
      version: env("KEXT_VERSION"),
      upstreamTag: env("KEXT_UPSTREAM_TAG"),
      upstreamCommit: env("KEXT_UPSTREAM_COMMIT"),
      sdkVersion,
      sdkCommit,
    });
    const dirs = bundledPackageDirs(JSON.parse(readFileSync(statsPath, "utf8")));
    const third = thirdPartyNotices(dirs, listFiles(build), HERE, (f) => readFileSync(join(build, f), "utf8"), join(tree, "node_modules"));
    writeFileSync(join(build, "LICENSE.txt"), readFileSync(join(tree, "LICENSE_GPL.txt")));
    writeFileSync(join(build, "LICENSE-UPSTREAM.txt"), readFileSync(join(tree, "LICENSE.txt")));
    writeFileSync(join(build, "NOTICE.txt"), notice);
    writeFileSync(join(build, "THIRD-PARTY-NOTICES.txt"), third);
    // The build's record of the notices it derived: one line per section, `notice <target> <sha256> <key>`, which
    // in-container.sh appends to sdk-hashes.txt (under SHA256SUMS) and the checker holds each package's file to.
    writeFileSync(recordPath, noticeSections(third).map((s) => `notice ${target} ${createHash("sha256").update(s.text).digest("hex")} ${s.key}\n`).join(""));
    console.log(`NOTICES_OK packages=${/^Packages \((\d+)\)/m.exec(third)[1]} sdk=${sdkVersion}@${sdkCommit.slice(0, 12)} build=${basename(build)}`);
  } catch (err) {
    fail(err.message);
  }
}
