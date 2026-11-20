// The artefact checker (plan T1.5, E21; Decisions 2, 4, 5). Called through build/check-artefacts.sh:
//
//   bash apps/kount-extension/build/check-artefacts.sh <dir>             a store build (production constants, no maps)
//   bash apps/kount-extension/build/check-artefacts.sh --release <dir>   the same, and the top CHANGELOG entry must be a
//                                                                        `release` and each package carry the approved
//                                                                        attribution line (below)
//   bash apps/kount-extension/build/check-artefacts.sh --proofs <dir>    a proofs build (loopback constants, maps kept)
//
// <dir> is what build.sh writes (.build/out/<label>/) or what the build lane keeps: SHA256SUMS, the packages
// kount-protect-{chrome,edge,firefox}.zip, kount-protect-source.tar.gz and sdk-hashes.txt. Every rule reads the PACKAGES
// themselves (never the unpacked trees beside them), so the publish lane can run it on downloaded artefacts:
//
//   SHA256SUMS      names exactly the files above (all three packages unless --proofs) and each hash matches;
//   identity        each manifest's name (extName) and short_name are the README's name, its version is the top
//                   CHANGELOG.md entry's, Firefox's gecko id is the README's and its data_collection_permissions are
//                   exactly the README's "Firefox data collection" line (no fewer, no more, no `none`, no optional),
//                   its strict_min_version is 140.0 (plan T3.5, T3.6); Chrome and Edge are Manifest V3; no package
//                   carries an update_url, top level or gecko (each store serves the updates);
//   constants       the two build constants, read from their one use site each — the first-install preset's
//                   `.SelfHosted,{base:"…"}` and the hook's `.listen(chrome.webRequest,"…")` — are the production
//                   addresses in a store package and loopback ones in a proofs package (it never scans for loopback
//                   text, which upstream's own files may hold — E21); a site found other than exactly once is refused;
//                   a site may hold the literal or the name of the one const the minifier keeps when its bundle reads
//                   the constant twice — that name then needs exactly one string definition in its file;
//                   Protect's origin has a second checked consumer (plan T1.4, Decision 6): every package carries the
//                   page marker's bundle `content/kount-protect-marker.js`, holding the constant once and its call
//                   once, with exactly the hook's origin; the third constant, the SSO identifier, is read from the
//                   sign-in screen's one e-mail-less call `.redirectToSsoLoginWithOrganizationSsoIdentifier("",…)`
//                   and is the same word in every package;
//   commercial      every .wasm hashes to the GPL SDK's (sdk-hashes.txt, written in the build container) and none to
//                   the commercial SDK's (and NOTICE.txt names the GPL SDK's version and commit sdk-hashes.txt
//                   records); no text file names the commercial SDK's package, and none but NOTICE.txt and
//                   LICENSE-UPSTREAM.txt names bitwarden_license (either, in any reading — the file as written, its
//                   decoded views and each of those percent-decoded, as every text scan reads it);
//   the notices     LICENSE.txt (GPL-3.0), LICENSE-UPSTREAM.txt, NOTICE.txt (exactly the template's text for this build)
//                   and THIRD-PARTY-NOTICES.txt at each package's root (plan T3.9; noticeProblems) — the last one
//                   exactly the generated preamble (thirdPartyPreamble) then the recorded sections, every byte bound;
//   the archive     the source archive carries the kit (./kount-build) and ./KOUNT-BUILDING.md, and no bitwarden_license/;
//                   its other files are exactly upstream's tree at the lock (./KOUNT-UPSTREAM-TREE.txt, proved against
//                   the lock's commit by git's object ids) as the queue changes it, untouched files byte for byte;
//   the marks       every picture and font is one build/reviewed-images.tsv names by path and sha256, and so is every
//                   picture a text file embeds as a data: URL (`dataUrls`, any case; an undecodable base64 payload is
//                   refused), by its decoded bytes under <file>#embedded; no text file holds Bitwarden's shield or wordmark
//                   path data; no script or page draws the shield glyph, by its class or its code point, and no
//                   stylesheet names the code point beyond the glyph's own definitions (plan T3.8);
//   maps            no .map file in a store package;
//   the name scan   every capitalised "Bitwarden" in a text file (maps, NOTICE.txt and LICENSE-UPSTREAM.txt aside)
//                   matches an ALLOWED class below; any other
//                   is refused with its context — a rebase that brings a new one sorts it here or patches it out; every
//                   English message whose shown text names bitwarden in ANY case is a SHOWN_ALLOWED key, and no HTML
//                   page names it at all;
//   the zip itself  its own reader refuses what a browser's reader could see differently: a directory that does not fill
//                   exactly to the end record, bytes after it, a local header that disagrees, a symlink, an encrypted,
//                   zip64, duplicate or not-plain entry;
//   --release       the top entry is `release`; the attribution placeholder is in no reading of any file; each package's
//                   About output (popup/main.js) holds the approved line (build/tools/brand-residue.mjs's
//                   APPROVED_ATTRIBUTION, the one value the About rule writes and store/check-kit.mjs holds the listing
//                   to) exactly once, as the one double-quoted literal the compiled template carries, written as is and
//                   in no other file or reading; and no file but the notices holds other attribution wording
//                   (ATTRIBUTION_WORDING) — so a line deleted, altered, copied, or with wording added beside, before or
//                   after it, with or without the name, is refused (review round 54 PR-MED-049, PR-MED-050).
//
// A missing entry is refused always (build/changelog.mjs). Prints one `ARTEFACT_PROBLEM <what>` line per problem, then
// `Artefacts: <n> packages checked, <p> problems.`; exits 1 on any problem, 2 on a usage error. Repository code only:
// reads the files as data, runs nothing from them, opens no connection.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

import { isLoopbackHost } from "../../vaultwarden-kount/conformance/lib/loopback.mjs";
import { lockTag, topEntry } from "./changelog.mjs";
import { NO_LICENCE_FILE, OTHER_MATERIAL, materialPresent, noticeSections, sourceUrl, thirdPartyPreamble } from "./notice/notices.mjs";
import { APPROVED_ATTRIBUTION, ATTRIBUTION_MARKER, ATTRIBUTION_WORDING } from "./tools/brand-residue.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PRODUCTION = { vault: "https://vault.kount.com.au", protect: "https://protect.kount.com.au", sso: "kount" };
// The two constants' use sites. Each holds the constant either as the literal (the minifier inlines a constant read
// once in its bundle) or as the name of the ONE `const` the minifier keeps when the bundle reads it more than once
// (plan T1.4: the shared Kount-environment test reads the vault base in the background too) — then the name must have
// exactly one string definition in the same file, and that string is the value read back.
const VAULT_SITE = /\.SelfHosted,\{base:(?:"([^"\\]*)"|([A-Za-z_$][\w$]*))\}/g;
const PROTECT_SITE = /\.listen\(chrome\.webRequest,(?:"([^"\\]*)"|([A-Za-z_$][\w$]*))\)/g;
// The SSO identifier (sign-in-lock-and-look T1.3): the sign-in screen's one call that starts SSO with NO e-mail.
const SSO_SITE = /\.redirectToSsoLoginWithOrganizationSsoIdentifier\("",(?:"([^"\\]*)"|([A-Za-z_$][\w$]*))\)/g;
/**
 * Each use site's value: its literal, its name's one `const` string definition, or `{ name, definitions }` when that is
 * not exactly one. Only the `const` forms the pinned builds emit count as a definition — `const NAME="…"`, or NAME as a
 * later declarator of the same `const` whose earlier declarators are all strings (`const a="…",NAME="…"`) — never a
 * `let`, a `var`, an assignment or a parameter of the same name (round 11 PR-MED-056).
 */
function siteValues(text, pattern) {
  return [...text.matchAll(pattern)].map((m) => {
    if (m[1] !== undefined) return m[1];
    const name = m[2];
    const definition = new RegExp(`\\bconst (?:[A-Za-z_$][\\w$]*="[^"\\\\]*",)*${name.replace(/\$/g, "\\$")}="([^"\\\\]*)"`, "g");
    const found = [...text.matchAll(definition)].map((d) => d[1]);
    return found.length === 1 ? found[0] : { name, definitions: found.length };
  });
}
// Where each constant's use site must be (round 11 PR-MED-056): the bundle that actually runs it.
const SITE_OWNERS = { vault: "background.js", protect: "background.js", sso: "popup/main.js" };
/** The bundle's code lines: comment lines (`//`, `/*`, `*`) left out, so a comment never counts as the call. */
function codeOnly(text) {
  return text
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .join("\n");
}
// The page marker's bundle (plan T1.4, Decision 6): content scripts are left unminified, so the constant reads as
// webpack writes a concatenated module's const, and its one use as the entry file's call.
const MARKER_BUNDLE = "content/kount-protect-marker.js";
const MARKER_ORIGIN = /\bKOUNT_PROTECT_ORIGIN = "([^"\\]*)";/g;
const MARKER_CALL = "startMarker(window, KOUNT_PROTECT_ORIGIN, chrome.runtime)";
const TARGETS = ["chrome", "edge", "firefox"];
// Mozilla's data collection categories (extensionworkshop.com, "Firefox built-in consent for data collection and
// transmission", read 2026-11-12; the README records the choice).
const MOZILLA_CATEGORIES = new Set([
  "personallyIdentifyingInfo", "healthInfo", "financialAndPaymentInfo", "authenticationInfo", "personalCommunications",
  "locationInfo", "browsingActivity", "websiteContent", "websiteActivity", "searchTerms", "bookmarksInfo",
]);
const BINARY = /\.(wasm|png|jpe?g|gif|ico|webp|woff2?|ttf|otf|eot)$/i;
/**
 * The lowest Firefox the package installs on (plan T3.5, T3.6): Mozilla's built-in data consent needs 140, and the build
 * has no consent screen of its own (store/README.md § Firefox's channel).
 */
const FIREFOX_MIN_VERSION = "140.0";
/**
 * The approved attribution line as the About dialog's compiled template carries it: one double-quoted string literal
 * (Angular resolves the template's &reg; to the character), in this entry of each package (review round 54 PR-MED-049).
 */
export const ATTRIBUTION_LITERAL = JSON.stringify(APPROVED_ATTRIBUTION);
export const ABOUT_OUTPUT = "popup/main.js";
/**
 * Attribution wording (build/tools/brand-residue.mjs, the one definition the listing kit's check shares — review round
 * 55): any of it outside that one literal is a second, altered or appended attribution. None occurs in a real package
 * outside its notice files, which pass over this rule because each is bound whole: LICENSE.txt and LICENSE-UPSTREAM.txt
 * to pinned texts, NOTICE.txt to the template, THIRD-PARTY-NOTICES.txt to the generated preamble and the recorded
 * section hashes (noticeProblems).
 */
export { ATTRIBUTION_WORDING };
/** No entry of a real package comes near this (the largest, the SDK module, is about 8 MB); a bigger one is refused unread. */
const MAX_ENTRY_BYTES = 128 * 1024 * 1024;
/** The source archive unpacked (about 0.3 GB at browser-v2026.10.2); a bigger one is refused, not expanded. */
const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024;

/**
 * The product-name allowlist (plan T1.5; the spike's § T0.3 sort, finished at T1.1). Each class: the file it may be in
 * (any when absent) and a pattern that must cover the hit. Everything a person can read that names Bitwarden as THIS
 * product is patched out (0001–0003, 0009, 0010); what is left names another product, is a legal notice, or is never shown.
 */
export const ALLOWED = [
  ["identifier", null, /[A-Za-z0-9_$]Bitwarden|Bitwarden[A-Za-z0-9_$]/],
  ["request header sent to the Kount vault", null, /"Bitwarden-(Client-Name|Client-Version|Package-Type)"/],
  ["comment in an unminified content script", null, /Reads the Bitwarden-attribute opt-in settings|(send the text to|request the text from) the Bitwarden app\./],
  ["comment from the SDK's generated bindings in the unminified \"Save login\" bar script (since browser-v2026.11.0)", /^notification\/bar\.js$/,
    /\* (Upload directly to the Bitwarden server via `POST|Client for authenticating Bitwarden users\.|The main entry point for the Bitwarden SDK in WebAssembly environments|Disables the ability to create and edit Bitwarden Sends\.|Sets restrictions or defaults for Bitwarden Sends\.|Removes members' access to the free Bitwarden Families sponsorship benefit\.|Managed Service Provider - sells and manages its clients' Bitwarden organizations\.|Reseller partner - sells Bitwarden to its clients|The `SendAccessClient` is used to interact with the Bitwarden API|- \[`FileUploadType::Direct`\] uploads directly to the Bitwarden server|Receiving is the only Send operation that may target a different Bitwarden instance)/],
  ["comment in the stylesheet", /^popup\/main\.css$/, /\* Bitwarden Tailwind configuration/],
  ["log line (the desktop app bridge, never used here)", null, /\[(Native Messaging )?IPC\][^"`\n]{0,80}Bitwarden Desktop [Aa]pp/],
  ["accurate reference: Bitwarden's export format, in the import and export lists (T3.1)", null,
    /\bname:"Bitwarden( \((json|csv)\))?",featuredImporter:|\bsourceName:"Bitwarden",instructionLink:|\bdisplayName:"Bitwarden",formats:/],
  ["accurate reference: Bitwarden as a vendor in the generator's vendor list, beside DuckDuckGo and the others", null,
    /\{id:[\w$.]+\.bitwarden,name:"Bitwarden"\}/],
  ["legal notice: the copyright line (T3.1)", null, /"\u00a9 ",[\w$.]+," Bitwarden Inc\."|"\u00a9 Bitwarden Inc\. 2015-"/],
  ["the attribution line (T3.1, T3.6)", null, new RegExp(ATTRIBUTION_LITERAL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))],
  ["a developer tool's hint (behind a developer flag)", /^popup\/main\.js$/, /Right-click (the page|an input|a button) \u2192 Bitwarden \u2192 Webmapper/],
  ["another product: the hidden \"More from\" screen's text (0010 removes its link)", /^_locales\/en\/messages\.json$/,
    /"message": "(Bitwarden for Business|Bitwarden Authenticator|Bitwarden Secrets Manager|Free Bitwarden Families|Bitwarden Authenticator allows|Securely store, manage, and share developer secrets with Bitwarden Secrets Manager|You are eligible for Free Bitwarden Families|Bitwarden for Business allows)/],
  ["accurate reference: another product, the authenticator app (T3.1)", /^_locales\/en\/messages\.json$/, /authenticator app like Bitwarden Authenticator\.|'Bitwarden Authenticator' is a product name/],
  ["a translator's example, never shown", /^_locales\/en\/messages\.json$/, /"example": "Bitwarden Phishing Blocker"/],
];

/**
 * The English messages whose SHOWN text names bitwarden in any case — "bitwarden.com" included, which the capitalised scan
 * cannot see (review round 9 LOW). Each key is allowed for its reason; any other message that names it is refused.
 */
export const SHOWN_ALLOWED = {
  continueToBitwardenDotCom: "the hidden \"More from\" screen, and the prompt to BUY Bitwarden premium (never shown: Vaultwarden gives every account premium)",
  bitwardenForBusiness: "the hidden \"More from\" screen",
  bitwardenForBusinessPageDesc: "the hidden \"More from\" screen",
  bitwardenAuthenticator: "the hidden \"More from\" screen",
  continueToAuthenticatorPageDesc: "the hidden \"More from\" screen",
  bitwardenSecretsManager: "the hidden \"More from\" screen",
  continueToSecretsManagerPageDesc: "the hidden \"More from\" screen",
  continueToPasswordlessDotDevPageDesc: "the hidden \"More from\" screen",
  freeBitwardenFamilies: "the hidden \"More from\" screen",
  freeBitwardenFamiliesPageDesc: "the hidden \"More from\" screen",
  downloadFromBitwardenNow: "the \"Download … apps\" page, which 0010 unlinks",
  authenticatorAppDescV2: "accurate reference: another product, the authenticator app (T3.1)",
};

/** The GPL-3.0 files at a package's root (plan T3.9; notice/notices.mjs writes them), each held to its own rule. */
export const NOTICE_FILES = ["LICENSE.txt", "LICENSE-UPSTREAM.txt", "NOTICE.txt", "THIRD-PARTY-NOTICES.txt"];
/**
 * The two of them that name Bitwarden, Inc. and its licence's directory by necessity: the name scan and the
 * bitwarden_license rule pass over these paths — only at the root — because NOTICE.txt must be the template's exact
 * text and LICENSE-UPSTREAM.txt upstream's short notice (noticeProblems). The other two are scanned like any file.
 */
export const NAME_SCAN_EXEMPT = ["NOTICE.txt", "LICENSE-UPSTREAM.txt"];

/** Every picture or font a package may carry is one build/reviewed-images.tsv names by path and sha256 (plan T3.8). */
export const IMAGE = /\.(a?png|jpe?g|gif|ico|cur|webp|svgz?|bmp|avif|jxl|woff2?|ttf|otf|eot)$/i;

/**
 * Bitwarden's shield and wordmark as upstream draws them inline (plan T3.8): the opening of each drawing's path data, from
 * the upstream files 0009 replaces (the logo, the beta logo, the importer's logo, the fill button and menu, the "Save
 * login" bar's shield) and libs/assets' other shield drawings. A script, page or stylesheet holding one is refused.
 */
export const BRAND_DRAWINGS = [
  "M12.66.175A.566.566", "M13.469.2A.647.647", "M22.01 17.055V4.135", "M15.6599 3.17501", "M32.041 24.546V5.95",
  "M18.7697 12.9217V3.29292", "M16.904 13.09V3.175", "M17.904 13.09V3.175", "M28.916 4.484", "M36.825 5.714",
  "M47.948 7.444",
];

/** The icon font's two Bitwarden shield glyphs, as a class a script or page would draw them by. */
const SHIELD_GLYPH = /\bbwi-(?:bitwarden-)?shield\b/;
/**
 * The glyphs' own definitions in a stylesheet, which name their code point (read from the package, not assumed): the
 * minified shape upstream's build writes. A stylesheet that names a shield class in any other shape is refused rather
 * than leaving the code-point rule with nothing to hold (review round 43).
 */
const SHIELD_GLYPH_DEFINITION = /\.bwi-(?:bitwarden-)?shield:before\{content:"([^"\\]|\\[0-9a-fA-F]{1,6} ?)"\}/gu;
const SHIELD_GLYPH_IN_CSS = /\.bwi-(?:bitwarden-)?shield\b/g;
/** A file's first bytes that say picture or font, whatever its name (PNG, JPEG, GIF, WebP, ICO / CUR, WOFF, WOFF2, gzip — svgz). */
const PICTURE_MAGIC = [[0x89, 0x50, 0x4e, 0x47], [0xff, 0xd8, 0xff], [0x47, 0x49, 0x46, 0x38], [0x52, 0x49, 0x46, 0x46], [0x00, 0x00, 0x01, 0x00], [0x00, 0x00, 0x02, 0x00], [0x77, 0x4f, 0x46, 0x46], [0x77, 0x4f, 0x46, 0x32], [0x1f, 0x8b]];
const looksLikePicture = (data) => PICTURE_MAGIC.some((m) => m.every((b, i) => data[i] === b));

/** Percent-decoding as the URL standard does it: `%` + two hex digits is that byte; any other `%` stays. */
function percentDecodeBytes(bytes) {
  const out = [];
  for (let i = 0; i < bytes.length; i++) {
    const hex = bytes[i] === 0x25 && i + 2 < bytes.length ? String.fromCharCode(bytes[i + 1], bytes[i + 2]) : "";
    if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
      out.push(parseInt(hex, 16));
      i += 2;
    } else out.push(bytes[i]);
  }
  return Buffer.from(out);
}

/** The Infra standard's forgiving-base64 decode: white space dropped, at most two `=` at the end, else failure (null). */
function forgivingBase64(text) {
  let s = text.replace(/[\t\n\f\r ]/g, "");
  if (s.length % 4 === 0) s = s.replace(/={1,2}$/, "");
  if (s.length % 4 === 1 || /[^A-Za-z0-9+/]/.test(s)) return null;
  return Buffer.from(s, "base64");
}

/**
 * For a text and a global one-character-class regex: a function giving the index of the first match at or after a
 * position (the text's length when none). Asked for nondecreasing positions, it walks the text once in all: a search
 * resumes only past the last match it found.
 */
function firstAtOrAfter(text, re) {
  let found = -1;
  return (from) => {
    if (found >= from) return found;
    re.lastIndex = from;
    const m = re.exec(text);
    found = m ? m.index : text.length;
    return found;
  };
}

/**
 * Every `data:` URL in a text, classified once (review rounds 48 PR-MED-041 and 49 PR-MED-044), as the URL standard
 * and the Fetch standard's data: URL processor read one. The URL parser first removes every ASCII tab, LF and CR, so the
 * scheme `data:` is found in any case with any of them between its letters (not inside a longer scheme), and they are
 * removed from the head and the payload before either is read. The head is everything to the first comma, holding none
 * of ``"'`(){}<>\`` (else the `data:` is code, not a URL); a head ending in `;base64` (any case, spaces allowed before
 * it) marks the payload base64; the media type is the rest, lowercased, and anything that is not `type/subtype` reads
 * as text/plain. The payload runs to the first quote, backtick, `)` or backslash; it is percent-decoded to bytes, then base64-decoded if marked —
 * a base64 payload that does not decode is `undecodable`. A URL is a `picture` when its bytes open with a picture or
 * font's magic number, or its type is `image/*` or `font/*`, or it is a base64 `application/*` — except a plain
 * (not base64) `image/svg+xml`, which is readable text the drawing list reads. An empty payload is a URL assembled at
 * run time: there are no bytes to review (the stated limit).
 */
export function dataUrls(text) {
  const urls = [];
  // The URL standard removes every ASCII tab, LF and CR from a URL before reading it (review round 49 PR-MED-044), so
  // the scheme is found with any of them between its letters, and the head is read with them removed.
  const schemes = [...text.matchAll(/(?<![A-Za-z0-9+.-])d[\t\n\r]*a[\t\n\r]*t[\t\n\r]*a[\t\n\r]*:/gi)];
  // The head and the payload are read whole — no length bound (review round 51 PR-MED-048) — and the scan stays linear:
  // each terminator search resumes where the last one stopped, a `data:` inside an earlier head is part of that head
  // (as the browser reads it), and a payload ends at the next scheme, so no two heads or payloads overlap.
  const headStop = firstAtOrAfter(text, /[,"'`(){}<>\\]/g);
  const payloadStop = firstAtOrAfter(text, /["'`)\\]/g);
  let headsEndAt = -1;
  let next = 0; // the first scheme at or after the current payload: it only moves forward
  for (const m of schemes) {
    if (m.index < headsEndAt) continue;
    const start = m.index + m[0].length;
    const comma = headStop(start);
    headsEndAt = comma;
    if (text[comma] !== ",") continue; // a quote, bracket or backslash first: the `data:` is code, not a URL
    const head = text.slice(start, comma).replace(/[\t\n\r]/g, "").trim();
    const payloadAt = comma + 1;
    while (next < schemes.length && schemes[next].index < payloadAt) next++;
    const nextScheme = schemes[next]?.index ?? text.length;
    const stop = payloadStop(payloadAt);
    // A payload that runs on through an escape (JSON's `\/`, say) is not whole in this reading; the reading that
    // decodes the escape (decodedViews) classifies it.
    if (stop < nextScheme && text[stop] === "\\") continue;
    const payload = text.slice(payloadAt, Math.min(stop, nextScheme));
    const marker = /;[ ]*base64$/i.exec(head);
    const base64 = marker !== null;
    const declared = (base64 ? head.slice(0, marker.index) : head).trim().toLowerCase();
    const type = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+/.exec(declared)?.[0] ?? "text/plain";
    const url = { at: m.index, head: `data:${head},`, type, base64, bytes: null, undecodable: false, picture: false };
    if (payload.replace(/[\t\n\r]/g, "") === "") {
      urls.push(url);
      continue;
    }
    const bytes = percentDecodeBytes(Buffer.from(payload.replace(/[\t\n\r]/g, ""), "utf8"));
    url.bytes = base64 ? forgivingBase64(bytes.toString("latin1")) : bytes;
    url.undecodable = url.bytes === null;
    const major = type.split("/")[0];
    url.picture = (url.bytes !== null && looksLikePicture(url.bytes))
      || (type === "image/svg+xml" ? base64 : major === "image" || major === "font" || (major === "application" && base64));
    urls.push(url);
  }
  return urls;
}

/** Upstream's icon font, in any of its formats. */
const ICON_FONT = /(^|\/)bwi-font[^/]*\.(woff2?|ttf|otf|eot|svg)$/;

/** The code points an SVG font names for a glyph whose name says shield (`glyph-name` and `unicode`, either order). */
export function svgFontShieldPoints(svg) {
  const points = [];
  for (const m of svg.matchAll(/<glyph\b[^>]*>/g)) {
    const name = /\bglyph-name="([^"]*)"/.exec(m[0])?.[1] ?? "";
    const unicode = /\bunicode="&#x([0-9a-fA-F]+);"/.exec(m[0])?.[1];
    if (/shield/i.test(name) && unicode) points.push(parseInt(unicode, 16));
  }
  return points;
}

/** build/shield-glyphs.tsv: `<sha256>\t<path>\tU+XXXX[,U+XXXX…]` → Map(sha256 → code points). */
export function readShieldGlyphs(text) {
  const pins = new Map();
  for (const [i, line] of text.split("\n").entries()) {
    if (line === "" || line.startsWith("#")) continue;
    const m = /^([0-9a-f]{64})\t(\S+)\t(U\+[0-9A-F]{4,6}(?:,U\+[0-9A-F]{4,6})*)$/.exec(line);
    if (!m) throw new Error(`shield-glyphs.tsv line ${i + 1} is not "<sha256>\\t<path>\\tU+XXXX[,U+XXXX…]"`);
    pins.set(m[1], m[3].split(",").map((u) => parseInt(u.slice(2), 16)));
  }
  return pins;
}

/** Each code point a package's stylesheets give a shield glyph, with how many definitions name it. */
function shieldCodePoints(entries) {
  const points = new Map();
  for (const e of entries) {
    if (!e.name.endsWith(".css")) continue;
    for (const m of e.data.toString("utf8").matchAll(SHIELD_GLYPH_DEFINITION)) {
      const point = m[1].startsWith("\\") ? parseInt(m[1].slice(1), 16) : m[1].codePointAt(0);
      points.set(point, (points.get(point) ?? 0) + 1);
    }
  }
  return points;
}

/** A code point as the decoders below emit it: an out-of-range or surrogate value is U+FFFD, as CSS and HTML read it. */
const pointText = (cp) => String.fromCodePoint(cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) || cp === 0 ? 0xfffd : cp);

/**
 * ECMAScript's string escapes whose value is not the escaped character itself (ECMA-262, SingleEscapeCharacter):
 * `\b \t \n \v \f \r`, by code (review round 49 PR-MED-043 — they were read as the bare letter).
 */
const JS_SINGLE_ESCAPES = new Map([["b", 8], ["t", 9], ["n", 10], ["v", 11], ["f", 12], ["r", 13]]);
/** A line continuation inside a JavaScript string: LF, CR (CRLF as one), LINE SEPARATOR, PARAGRAPH SEPARATOR. */
const JS_LINE_CONTINUATION = new RegExp(`\r\n|[\n\r${String.fromCharCode(0x2028, 0x2029)}]`, "y");
/** The other escape forms, each matched sticky at the character after the backslash (review round 51 PR-MED-047). */
const JS_BRACED_ESCAPE = /u\{([0-9a-fA-F]+)\}/y;
const JS_FIXED_ESCAPE = /u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})/y;
const JS_OCTAL_ESCAPE = /[0-3][0-7]{0,2}|[4-7][0-7]?/y;

/**
 * A text with every JavaScript / JSON string escape decoded, left to right as the engine reads them — ECMAScript's
 * whole escape table: `\\` is one backslash (never the start of an escape); `\uXXXX` and `\xXX` are UTF-16 code units;
 * `\u{X…}` a code point; a legacy octal escape (`\0` … `\377`) its unit; `\b \t \n \v \f \r` their control characters;
 * a line continuation nothing; any other escaped character (`\8`, `\9`, `\"`, `\q` …) itself. The units go into one
 * JavaScript string, so a high surrogate followed by a low one pairs and any other unit stands alone — U+F169 written
 * as an escape and followed by an escaped U+DC00 is U+F169 and a lone U+DC00 (review round 48 PR-MED-040). The test
 * holds it to JavaScript's own reading of every escape of 0x00–0x7F, U+2028 and U+2029.
 */
export function decodeJsEscapes(text) {
  if (!text.includes("\\")) return text;
  let out = "";
  for (let i = 0; i < text.length; ) {
    if (text[i] !== "\\") {
      const j = text.indexOf("\\", i);
      out += text.slice(i, j < 0 ? text.length : j);
      i = j < 0 ? text.length : j;
      continue;
    }
    // Each form is matched at the escape's own position over the whole text — no window, so a braced escape with any
    // number of leading zeroes is read whole (review round 51 PR-MED-047) — and nothing is copied per escape.
    const here = (re) => {
      re.lastIndex = i + 1;
      return re.exec(text);
    };
    let m;
    if ((m = here(JS_BRACED_ESCAPE))) {
      const cp = parseInt(m[1], 16); // exact for any run of leading zeroes; past U+10FFFF it is a SyntaxError to JavaScript
      out += cp <= 0x10ffff ? String.fromCodePoint(cp) : `\\${m[0]}`;
      i += 1 + m[0].length;
    } else if ((m = here(JS_FIXED_ESCAPE))) {
      out += String.fromCharCode(parseInt(m[1] ?? m[2], 16));
      i += 1 + m[0].length;
    } else if ((m = here(JS_OCTAL_ESCAPE))) {
      out += String.fromCharCode(parseInt(m[0], 8));
      i += 1 + m[0].length;
    } else if ((m = here(JS_LINE_CONTINUATION))) {
      i += 1 + m[0].length;
    } else if (JS_SINGLE_ESCAPES.has(text[i + 1])) {
      out += String.fromCharCode(JS_SINGLE_ESCAPES.get(text[i + 1]));
      i += 2;
    } else if (i + 1 < text.length) {
      const cp = text.codePointAt(i + 1);
      out += String.fromCodePoint(cp);
      i += 1 + (cp > 0xffff ? 2 : 1);
    } else {
      out += "\\";
      i += 1;
    }
  }
  return out;
}

/** A text with every CSS escape decoded (CSS Syntax § 4.3.7): `\` + one to six hex digits and one optional white space. */
export function decodeCssEscapes(text) {
  if (!text.includes("\\")) return text;
  return text.replace(/\\(?:([0-9a-fA-F]{1,6})(?:\r\n|[ \t\n\r\f])?|(\r\n|[\n\r\f])|([\s\S]))/gu, (all, hex, newline, other) => {
    if (hex !== undefined) return pointText(parseInt(hex, 16));
    if (newline !== undefined) return "";
    return other;
  });
}

/** A text with every numeric character reference decoded (`&#xX…;` / `&#D…;`, the semicolon optional, the whole digit run). */
export function decodeHtmlReferences(text) {
  if (!text.includes("&#")) return text;
  return text.replace(/&#(?:[xX]([0-9a-fA-F]+)|([0-9]+));?/g, (all, hex, dec) => pointText(hex !== undefined ? parseInt(hex, 16) : parseInt(dec, 10)));
}

const DECODERS = [decodeJsEscapes, decodeCssEscapes, decodeHtmlReferences];

/**
 * The readings of a file: each syntax's escapes decoded, and each syntax's escapes decoded inside another's (or its own)
 * decoded text — a CSS escape written in a JS string (`"\\f169"`), an entity in a string a script writes into a page, a
 * JSON text parsed from a JS literal. Each reading is the whole file under one interpretation, so a use is counted once
 * within it; a reading identical to one already listed is left out.
 */
export function decodedViews(text) {
  const views = [];
  const add = (t) => {
    if (t !== text && !views.includes(t)) views.push(t);
  };
  for (const first of DECODERS) {
    const one = first(text);
    add(one);
    if (one !== text) for (const second of DECODERS) add(second(one));
  }
  return views;
}

/**
 * The literal grammar a `fromCharCode(…)` / `fromCodePoint(…)` call's arguments are read in (review round 48 PR-MED-040):
 * a JavaScript numeric literal (decimal with fraction and exponent, `0x` / `0o` / `0b`, legacy octal, `_` separators)
 * with an optional sign, or a string literal (its escapes decoded, then read as JavaScript's StringToNumber reads it).
 * A string literal is lexed as ECMAScript lexes one (review round 50 PR-MED-046): an escape takes a whole line
 * continuation as one unit (CRLF before any single character), and a single- or double-quoted body holds no raw LF or
 * CR (raw U+2028 / U+2029 are allowed, as ES2019 allows them); a template body may hold any of them, so its escape
 * takes one character and an escaped CRLF's LF is the body's (one parse, no backtracking — review round 51). Every
 * alternative has one way to match a given text, and a sign's white space is read only after a sign, so the grammar
 * reads in linear time however long the white space or the escape runs (review round 51).
 */
const CALL_ARGUMENT = /\s*(?:(?:([+-])\s*)?(0[xX][0-9a-fA-F](?:_?[0-9a-fA-F])*|0[oO][0-7](?:_?[0-7])*|0[bB][01](?:_?[01])*|(?:\d(?:_?\d)*(?:\.(?:\d(?:_?\d)*)?)?|\.\d(?:_?\d)*)(?:[eE][+-]?\d(?:_?\d)*)?)|"((?:[^"\\\n\r]|\\(?:\r\n|[\s\S]))*)"|'((?:[^'\\\n\r]|\\(?:\r\n|[\s\S]))*)'|`((?:[^`\\$]|\\[\s\S]|\$(?!\{))*)`)\s*/y;

function literalNumber(sign, digits) {
  const d = digits.replace(/_/g, "");
  const value = /^0[0-7]+$/.test(d) ? parseInt(d, 8) : Number(/^0\d+$/.test(d) ? d.replace(/^0+(?=\d)/, "") : d);
  return sign === "-" ? -value : value;
}

/** A call's closing parenthesis after any white space at `at` — read sticky, however much white space (review round 51). */
const CALL_CLOSE = /\s*\)/y;
const closesAt = (text, at) => {
  CALL_CLOSE.lastIndex = at;
  return CALL_CLOSE.test(text);
};

/**
 * `fn(...values)` built a chunk at a time, so an argument list of any length is read without overflowing the stack
 * (review round 51; the units concatenate, so a surrogate pair split across chunks still pairs).
 */
function inChunks(fn, values) {
  let out = "";
  for (let k = 0; k < values.length; k += 8192) out += fn(...values.slice(k, k + 8192));
  return out;
}

/** The string each literal-only call in a text evaluates to, by the API's own conversion; a call outside the grammar is skipped. */
export function literalCallResults(text) {
  const results = [];
  for (const m of text.matchAll(/from(CharCode|CodePoint)\s*\(/g)) {
    const values = [];
    let at = m.index + m[0].length;
    let ok = false;
    for (;;) {
      CALL_ARGUMENT.lastIndex = at;
      const a = CALL_ARGUMENT.exec(text);
      if (!a) {
        ok = closesAt(text, at) && values.length === 0;
        break;
      }
      const str = a[3] ?? a[4] ?? a[5];
      values.push(str !== undefined ? Number(decodeJsEscapes(str)) : literalNumber(a[1], a[2]));
      at = CALL_ARGUMENT.lastIndex;
      if (text[at] === ")") {
        ok = true;
        break;
      }
      if (text[at] !== ",") break;
      at++;
      if (closesAt(text, at)) {
        ok = true;
        break;
      }
    }
    if (!ok) continue;
    if (m[1] === "CharCode") {
      // ToUint16: NaN and the infinities are 0, the rest truncated, then taken modulo 2^16.
      results.push(inChunks(String.fromCharCode, values.map((v) => (Number.isFinite(v) ? ((Math.trunc(v) % 65536) + 65536) % 65536 : 0))));
    } else if (values.every((v) => Number.isInteger(v) && v >= 0 && v <= 0x10ffff)) {
      results.push(inChunks(String.fromCodePoint, values));
    } // else fromCodePoint throws a RangeError: it draws nothing.
  }
  return results;
}

/**
 * How often a text names a code point statically (review rounds 47 PR-MED-038 and 48 PR-MED-040). The point is searched
 * for in DECODED text, never matched against escape spellings: the most uses any one reading shows — the text itself or
 * a reading `decodedViews` gives (JS / JSON escapes, CSS escapes, HTML character references, or one of them inside
 * another's decoded text) — plus the uses in the string every `fromCharCode(…)` / `fromCodePoint(…)` call whose arguments
 * are all in `CALL_ARGUMENT`'s literal grammar evaluates to, under the API's own conversion. A stylesheet's definitions
 * are read in its CSS reading, so its allowance is counted there once. Decoding the whole file, not only its string
 * bodies, is conservative — an escape outside a string spells the same point.
 * Not seen — the documented limit, in these words: a call whose arguments are not all such literals (an array,
 * `.apply` / `.call`, a spread, a variable, an expression), and any code point computed at run time (arithmetic,
 * concatenation, `String.raw`, a decoding API on text built at run time, data fetched at run time).
 */
export function codePointUses(text, point, views = decodedViews(text)) {
  const target = String.fromCodePoint(point);
  const count = (t) => t.split(target).length - 1;
  let n = Math.max(count(text), ...views.map(count));
  for (const result of literalCallResults(text)) n += count(result);
  return n;
}

/** A text with every run of percent escapes decoded as UTF-8 bytes (a malformed sequence reads as U+FFFD), as a URL's is. */
const percentDecoded = (text) => (text.includes("%") ? text.replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => Buffer.from(run.replace(/%/g, ""), "hex").toString("utf8")) : text);

/**
 * The readings every text scan reads (review round 49 PR-MED-045) — one list, so no scan sees less than another: the
 * file as written; each `decodedViews` reading (JS / JSON, CSS and HTML decoding, and one inside another); and each of
 * those percent-decoded (a URL's text, an SVG inside a data: URL). `percent` marks the last kind: a payload there may
 * have been percent-decoded twice, so the data-URL scan takes pictures from it but never an undecodable payload.
 */
export function readings(text) {
  const out = [{ text, percent: false }];
  const add = (t, percent) => {
    if (!out.some((r) => r.text === t)) out.push({ text: t, percent });
  };
  for (const v of decodedViews(text)) add(v, false);
  for (const r of [...out]) add(percentDecoded(r.text), true);
  return out;
}

/** build/reviewed-images.tsv: `<sha256> <TAB> <path> <TAB> <what it shows>` per line; `#` lines are comments. */
export function readReviewedImages(text) {
  const reviewed = new Map();
  for (const [i, line] of text.split("\n").entries()) {
    if (line === "" || line.startsWith("#")) continue;
    const m = /^([0-9a-f]{64})\t([A-Za-z0-9._@+/-]+(?:#embedded)?)\t(\S.*)$/.exec(line);
    if (!m) throw new Error(`reviewed-images.tsv line ${i + 1} is not "<sha256>\\t<path>[#embedded]\\t<what it shows>"`);
    if (!reviewed.has(m[2])) reviewed.set(m[2], new Set());
    reviewed.get(m[2]).add(m[1]);
  }
  return reviewed;
}

/** A pattern that matches exactly the NOTICE.txt the template gives, each {{KEY}} captured (a repeat must be equal). */
export function noticePattern(template) {
  const seen = new Set();
  let src = "";
  let last = 0;
  for (const m of template.matchAll(/\{\{([A-Z_]+)\}\}/g)) {
    src += template.slice(last, m.index).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    src += seen.has(m[1]) ? `\\k<${m[1]}>` : `(?<${m[1]}>[^\\s]+)`;
    seen.add(m[1]);
    last = m.index + m[0].length;
  }
  src += template.slice(last).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${src}$`);
}

/** The tar member types the source archive may hold: a file ("0", or NUL in old headers) and a directory. */
const TAR_TYPES = new Set(["0", "", "5"]);
/**
 * The one name grammar a source-archive member may have (review round 47 PR-MED-036), checked before every other rule:
 * `./`, then segments of letters, digits and `. _ @ -` joined by single slashes, a directory ending in `/`. No `.` or
 * `..` segment, no empty segment, no absolute path, no backslash — so a name has one identity, the extractor's. Every
 * member of the real archive fits it (10 711 at browser-v2026.10.2; the only punctuation used is `. / - _ @`).
 */
const TAR_SEGMENT = "[A-Za-z0-9._@-]+";
const TAR_NAME = new RegExp(`^\\./(?:(?:${TAR_SEGMENT}/)*${TAR_SEGMENT}/?)?$`);
/** GNU's long-name record holds at most this many bytes (the real archive's longest is 145). */
const TAR_LONG_NAME_MAX = 4096;
/** A header's numeric fields: [offset, length, name] — each plain octal, NUL- or space-terminated (round 47). */
const TAR_NUMBERS = [[100, 8, "mode"], [108, 8, "uid"], [116, 8, "gid"], [124, 12, "size"], [136, 12, "mtime"], [148, 8, "checksum"]];

/** What is wrong with a member's name and type, or null — the grammar above, and a directory is exactly a `/`-ended name. */
function tarNameProblem(name, type) {
  if (!TAR_NAME.test(name)) return `a tar member name outside the archive's grammar: ${JSON.stringify(name.slice(0, 160))}`;
  if (name !== "./" && name.slice(2).replace(/\/$/, "").split("/").some((s) => s === "." || s === "..")) {
    return `a tar member name with a . or .. segment: ${JSON.stringify(name)}`;
  }
  if ((type === "5") !== name.endsWith("/")) return `a tar ${type === "5" ? "directory not ending" : "file ending"} in /: ${JSON.stringify(name)}`;
  return null;
}

/**
 * The members of a tar archive, each { name, type, data } (ustar or GNU; GNU long-name records read) — for the source
 * archive's rule. Refused: any other member type (PAX, long link, link, device, FIFO), a name given twice, a member
 * running past the end, and an archive with no end-of-archive block.
 */
export function tarEntries(buf) {
  const entries = [];
  const seen = new Set();
  let longName = null;
  let ended = false;
  for (let p = 0; p + 512 <= buf.length; ) {
    const header = buf.subarray(p, p + 512);
    if (header.every((b) => b === 0)) {
      ended = true;
      break;
    }
    const field = (from, len) => header.toString("latin1", from, from + len).replace(/\0.*$/s, "");
    // The header's own integrity before any field is trusted (review round 47 PR-MED-037): GNU's magic (what build.sh's
    // --format=gnu writes — POSIX ustar and base-256 numbers are refused), every numeric field plain octal, and the
    // checksum — the unsigned byte sum with its own field read as spaces — what the documented extractor verifies.
    if (header.toString("latin1", 257, 265) !== "ustar  \0") throw new Error(`a tar header without GNU's magic at offset ${p}`);
    for (const [at, len, what] of TAR_NUMBERS) {
      if (!/^[0-7]+[\0 ]*$/.test(header.toString("latin1", at, at + len))) throw new Error(`a tar header whose ${what} field is not plain octal at offset ${p}`);
    }
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 0x20 : header[i];
    if (parseInt(header.toString("latin1", 148, 156), 8) !== sum) throw new Error(`a tar header whose checksum is wrong at offset ${p}`);
    const size = parseInt(field(124, 12), 8);
    if (p + 512 + size > buf.length) throw new Error("a tar member that runs past the end of the archive");
    const type = field(156, 1);
    const data = buf.subarray(p + 512, p + 512 + size);
    p += 512 + Math.ceil(size / 512) * 512;
    if (type === "L") {
      if (longName !== null) throw new Error("two GNU long-name records in a row");
      if (size > TAR_LONG_NAME_MAX) throw new Error(`a GNU long-name record of ${size} bytes (at most ${TAR_LONG_NAME_MAX})`);
      longName = data.toString("utf8").replace(/\0.*$/s, "");
      continue;
    }
    // What build.sh writes (GNU tar of a tree of files and directories) and nothing else (review round 46 PR-MED-035):
    // a PAX record (`x`, `g`) or GNU long link (`K`) would change what an extractor names a member, and a link,
    // device or FIFO is not a source file — each is refused, never skipped.
    if (!TAR_TYPES.has(type)) throw new Error(`a tar member of type ${JSON.stringify(type)} (only files, directories and GNU long names are read)`);
    // GNU only (the magic above): a long name comes from its `L` record, never from a POSIX prefix field.
    // A long name's member carries the long name's first bytes in its own name field (GNU writes it so); any other
    // pairing is two names for one member.
    if (longName !== null && field(0, 100) !== longName.slice(0, 100).replace(/\0.*$/s, "")) {
      throw new Error(`a GNU long name whose member header names something else: ${JSON.stringify(field(0, 100))}`);
    }
    const name = longName ?? field(0, 100);
    const kind = type === "" ? "0" : type;
    // The grammar first (round 47): one canonical spelling per path, so the rules below see the extractor's identity.
    const wrong = tarNameProblem(name, kind);
    if (wrong) throw new Error(wrong);
    const key = name === "./" ? name : name.replace(/\/$/, ""); // a file and a directory of one path are one identity
    if (seen.has(key)) throw new Error(`a tar member named twice: ${name} (the later would overwrite the earlier)`);
    seen.add(key);
    entries.push({ name, type: kind, data });
    longName = null;
  }
  if (longName !== null) throw new Error("a GNU long-name record with no member after it");
  // A cut archive can end on a whole header boundary and read as complete; its end-of-archive block cannot be there.
  if (!ended) throw new Error("a tar archive with no end-of-archive block (cut short)");
  return entries;
}

/** The kit's directories, copied whole into the archive's ./kount-build/ (build.sh). */
const KIT_DIRS = ["patches", "overlay", "assets", "build"];

function filesUnder(root, rel = "", out = new Map()) {
  for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
    const path = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) filesUnder(root, path, out);
    else if (e.isFile()) out.set(path, readFileSync(join(root, path)));
    else throw new Error(`the kit holds ${path}, which is neither a file nor a directory`);
  }
  return out;
}

/**
 * What a source archive built from this kit must hold (plan T3.9, review round 46 PR-MED-030), every path at its archive
 * name with the bytes it must have (`null` = any non-empty content):
 *   ./kount-build/<patches|overlay|assets|build>/…   every file of the kit beside the checker (`kitRoot`), byte for byte —
 *                                                    the publish lane proves these trees are the build commit's
 *   ./kount-build/upstream.lock                      the build's record (`--app-dir`), byte for byte
 *   ./kount-build/CHANGELOG.md                       topped by the same entry as the build's record
 *   ./KOUNT-BUILDING.md                              the kit's build/notice/KOUNT-BUILDING.md
 *   ./package.json, ./package-lock.json, ./LICENSE.txt, ./LICENSE_GPL.txt          upstream's, non-empty
 *   ./<every path a patch writes>                    present (its content is upstream's plus the patch)
 *   ./<every overlay file>, ./<every assets/MANIFEST path>   byte-equal to the kit's copy
 * Throws when the kit itself cannot be read whole.
 */
/**
 * A proofs build points the build constants at loopback before it archives the tree (build.sh: the two `sed` lines,
 * whole-line replacements), so its archive holds the overlay's constants file with exactly these two lines changed.
 */
const CONSTANTS_FILE = "./apps/browser/src/kount/build-constants.ts";
const PROOFS_CONSTANTS = [
  [/^export const KOUNT_VAULT_BASE = .*$/m, 'export const KOUNT_VAULT_BASE = "https://127.0.0.1:8100";'],
  [/^export const KOUNT_PROTECT_ORIGIN = .*$/m, 'export const KOUNT_PROTECT_ORIGIN = "http://127.0.0.1:8180";'],
];

export function archiveRequirements(kitRoot, records, { proofs = false } = {}) {
  const kit = new Map();
  for (const dir of KIT_DIRS) {
    let files;
    try {
      files = filesUnder(join(kitRoot, dir));
    } catch (err) {
      throw new Error(`the checker's own kit has no readable ${dir}/ (${err.message})`);
    }
    if (files.size === 0) throw new Error(`the checker's own kit has nothing under ${dir}/`);
    for (const [rel, data] of files) kit.set(`./kount-build/${dir}/${rel}`, data);
  }
  const need = new Map(kit);
  need.set("./kount-build/upstream.lock", Buffer.from(records.lock));
  // The changelog by its top entry, not its bytes: the publish lane checks against main's records too, and main's
  // changelog may have moved on beneath the same release entry (its fork-commit line, say).
  need.set("./kount-build/CHANGELOG.md", null);
  let top = null;
  try {
    top = topEntry(records.changelog, lockTag(records.lock));
  } catch {
    // the records' own changelog problem is reported once, by checkArtefacts; nothing to compare the archive's to
  }
  need.set("./KOUNT-BUILDING.md", kit.get("./kount-build/build/notice/KOUNT-BUILDING.md") ?? null);
  for (const path of ["./package.json", "./package-lock.json", "./LICENSE.txt", "./LICENSE_GPL.txt"]) need.set(path, null);
  for (const [path, data] of kit) {
    if (path.startsWith("./kount-build/patches/") && path.endsWith(".patch")) {
      for (const m of data.toString("utf8").matchAll(/^\+\+\+ b\/(\S+)$/gm)) if (!need.has(`./${m[1]}`)) need.set(`./${m[1]}`, null);
    } else if (path.startsWith("./kount-build/overlay/")) {
      need.set(`./${path.slice("./kount-build/overlay/".length)}`, data);
    }
  }
  if (proofs && need.get(CONSTANTS_FILE)) {
    let text = need.get(CONSTANTS_FILE).toString("utf8");
    for (const [line, loopback] of PROOFS_CONSTANTS) text = text.replace(line, loopback);
    need.set(CONSTANTS_FILE, Buffer.from(text));
  }
  const manifest = kit.get("./kount-build/assets/MANIFEST")?.toString("utf8") ?? "";
  for (const line of manifest.split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    need.set(`./${line.trim()}`, kit.get(`./kount-build/assets/${line.trim()}`) ?? null);
  }
  let tag = null;
  try {
    tag = lockTag(records.lock);
  } catch {
    // reported by checkArtefacts
  }
  // What the queue and the build do to upstream's files (review round 48 PR-MED-042): every path a patch writes, an
  // overlay file, an asset, and the two manifests build.sh stamps — their bytes are Kount's, not upstream's blob — and
  // the paths a patch adds or deletes.
  need.set(UPSTREAM_TREE_RECORD, null);
  const touched = new Set(STAMPED_MANIFESTS);
  const added = new Set();
  const deleted = new Set();
  for (const [path, data] of kit) {
    if (path.startsWith("./kount-build/patches/") && path.endsWith(".patch")) {
      for (const block of data.toString("utf8").split(/^(?=diff --git )/m)) {
        const m = /^diff --git a\/(\S+) b\/(\S+)$/m.exec(block);
        if (!m) continue;
        if (/^deleted file mode /m.test(block)) deleted.add(`./${m[1]}`);
        else if (/^new file mode /m.test(block)) added.add(`./${m[2]}`);
        touched.add(`./${m[2]}`);
      }
    } else if (path.startsWith("./kount-build/overlay/")) {
      added.add(`./${path.slice("./kount-build/overlay/".length)}`);
    }
  }
  for (const line of manifest.split("\n")) if (line.trim() && !line.startsWith("#")) touched.add(`./${line.trim()}`);
  for (const p of added) touched.add(p);
  const commit = /^UPSTREAM_COMMIT=([0-9a-f]{40})$/m.exec(records.lock)?.[1] ?? null;
  return { need, top, lockTag: tag, kitPrefix: "./kount-build/", kitPaths: new Set(kit.keys()), commit, touched, added, deleted };
}

/**
 * The record build.sh writes into the source archive (review round 48 PR-MED-042): upstream's own commit object at the
 * lock (`commit <base64>`) and its whole tree (`git ls-tree -r --full-tree`: `<mode> <type> <id>\t<path>` per file), read
 * from the upstream cache. The checker trusts neither: the commit object must hash to the lock's commit, and the tree
 * rebuilt from the listing must be that commit's tree — so the listing is upstream's own, bound by git's object ids
 * (SHA-1, as git uses it: the trust boundary). Nothing is fetched.
 */
export const UPSTREAM_TREE_RECORD = "./KOUNT-UPSTREAM-TREE.txt";
/** build.sh's version stamp writes these two (both are also patch targets at browser-v2026.10.2). */
const STAMPED_MANIFESTS = ["./apps/browser/src/manifest.json", "./apps/browser/src/manifest.v3.json"];
/** build.sh's tar exclusions; upstream's tree at the lock holds none of them, and a listing that does is refused. */
const ARCHIVE_EXCLUDED = /(^|\/)node_modules(\/|$)|^apps\/browser\/(build|dist)(\/|$)|^\.git(\/|$)/;
const LISTED_PATH = new RegExp(`^(?:${TAR_SEGMENT}/)*${TAR_SEGMENT}$`);

/** A git object's id: SHA-1 over `<kind> <length>\0` and the bytes. */
export function gitObjectId(kind, data) {
  return createHash("sha1").update(`${kind} ${data.length}\0`).update(data).digest("hex");
}

/** The root tree id git gives a listing (Map path → { mode, oid }), or null when two entries cannot share one tree. */
export function gitTreeId(listing) {
  const root = new Map();
  for (const [path, entry] of listing) {
    const parts = path.split("/");
    let dir = root;
    for (const part of parts.slice(0, -1)) {
      if (!dir.has(part)) dir.set(part, new Map());
      dir = dir.get(part);
      if (!(dir instanceof Map)) return null;
    }
    if (dir.has(parts.at(-1))) return null;
    dir.set(parts.at(-1), entry);
  }
  const id = (dir) => {
    const items = [...dir].map(([name, v]) => (v instanceof Map ? { name, mode: "40000", oid: id(v), key: `${name}/` } : { name, mode: v.mode, oid: v.oid, key: name }));
    items.sort((a, b) => Buffer.compare(Buffer.from(a.key), Buffer.from(b.key)));
    return gitObjectId("tree", Buffer.concat(items.flatMap((x) => [Buffer.from(`${x.mode} ${x.name}\0`), Buffer.from(x.oid, "hex")])));
  };
  return id(root);
}

/** The record read and proved against the lock's commit: { problems, listing: Map(path → { mode, type, oid }) }. */
export function readUpstreamTree(text, commit) {
  const problems = [];
  const listing = new Map();
  let commitObject = null;
  for (const [i, line] of text.split("\n").entries()) {
    if (line === "" || line.startsWith("#")) continue;
    const c = /^commit ([A-Za-z0-9+/]+={0,2})$/.exec(line);
    if (c && commitObject === null) {
      commitObject = Buffer.from(c[1], "base64");
      continue;
    }
    const m = /^(100644|100755|120000) blob ([0-9a-f]{40})\t(.+)$|^(160000) commit ([0-9a-f]{40})\t(.+)$/.exec(line);
    const path = m?.[3] ?? m?.[6];
    if (!m || !LISTED_PATH.test(path) || path.split("/").some((s) => s === "." || s === "..")) {
      problems.push(`line ${i + 1} is not "commit <base64>" or a "<mode> <type> <id>\\t<path>" listing line: ${JSON.stringify(line.slice(0, 120))}`);
      continue;
    }
    if (listing.has(path)) problems.push(`lists ${path} twice`);
    listing.set(path, { mode: m[1] ?? m[4], type: m[1] ? "blob" : "commit", oid: m[2] ?? m[5] });
  }
  if (commitObject === null) problems.push("holds no commit line");
  else if (gitObjectId("commit", commitObject) !== commit) problems.push(`holds a commit object that is not the lock's commit ${commit}`);
  else if (gitTreeId(listing) !== /^tree ([0-9a-f]{40})\n/.exec(commitObject.toString("latin1"))?.[1]) problems.push("lists a tree that is not the lock commit's tree");
  return { problems, listing };
}

/**
 * The archive's upstream part against upstream's own tree (review round 48 PR-MED-042): its files outside the kit must be
 * exactly upstream's at the lock — less bitwarden_license/ (apply.sh removes it) and what a patch deletes, plus what a
 * patch or the overlay adds — and every file Kount does not touch must carry upstream's blob id. A submodule (none at
 * browser-v2026.10.2) is not part of the tree a clone checks out; a symbolic link (none) or a path build.sh's tar
 * excludes (none) is refused, since the archive could not carry it.
 */
function upstreamTreeProblems(files, recordText, requirements) {
  const { problems: wrong, listing } = readUpstreamTree(recordText, requirements.commit);
  if (wrong.length > 0) return wrong.map((p) => `the source archive's ${UPSTREAM_TREE_RECORD} ${p}`);
  const problems = [];
  const expected = new Map();
  for (const [path, e] of listing) {
    if (path.startsWith("bitwarden_license/") || e.type === "commit") continue;
    if (e.mode === "120000") problems.push(`upstream's tree holds a symbolic link the source archive cannot carry: ${path}`);
    else if (ARCHIVE_EXCLUDED.test(path)) problems.push(`upstream's tree holds ${path}, which build.sh's exclusions leave out of the source archive`);
    else expected.set(`./${path}`, requirements.touched.has(`./${path}`) ? null : e.oid);
  }
  for (const p of requirements.deleted) expected.delete(p);
  for (const p of requirements.added) expected.set(p, null);
  const own = new Set(["./KOUNT-BUILDING.md", UPSTREAM_TREE_RECORD]);
  const list = (what, paths) => {
    if (paths.length > 0) problems.push(`the source archive ${what} (${paths.length}): ${paths.slice(0, 5).join(", ")}${paths.length > 5 ? ", …" : ""}`);
  };
  list("lacks upstream's files at the lock", [...expected.keys()].filter((p) => !files.has(p)));
  list("holds files that are neither upstream's at the lock nor the queue's", [...files.keys()].filter((p) => !p.startsWith(requirements.kitPrefix) && !own.has(p) && !expected.has(p)));
  list("holds files that differ from upstream's at the lock, though the queue does not touch them", [...expected].filter(([p, oid]) => oid && files.has(p) && gitObjectId("blob", files.get(p).data) !== oid).map(([p]) => p));
  return problems;
}

/**
 * What the source archive gets wrong (plan T3.9), or []: every requirement present as a regular file with its bytes
 * (or non-empty), no kit file the checker's kit does not hold, and bitwarden_license/ out (with or without ./).
 */
export function sourceArchiveProblems(entries, requirements) {
  const problems = [];
  const files = new Map();
  for (const e of entries) if (e.type === "0") files.set(e.name, e);
  for (const [path, data] of requirements.need) {
    const e = files.get(path);
    if (!e) problems.push(`the source archive has no ${path} (as a regular file)`);
    else if (data === null ? e.data.length === 0 : !e.data.equals(data)) problems.push(`the source archive's ${path} is ${data === null ? "empty" : "not the kit's"}`);
  }
  const changelog = files.get("./kount-build/CHANGELOG.md");
  if (changelog && changelog.data.length > 0 && requirements.top) {
    let top = null;
    try {
      top = topEntry(changelog.data.toString("utf8"), requirements.lockTag);
    } catch (err) {
      problems.push(`the source archive's ./kount-build/CHANGELOG.md cannot be read: ${err.message}`);
    }
    if (top && JSON.stringify(top) !== JSON.stringify(requirements.top)) {
      problems.push(`the source archive's ./kount-build/CHANGELOG.md tops with ${top.label} (${top.status}), not the build's ${requirements.top.label} (${requirements.top.status})`);
    }
  }
  for (const name of files.keys()) {
    const kitFile = name.startsWith(`${requirements.kitPrefix}`) && !["./kount-build/upstream.lock", "./kount-build/CHANGELOG.md"].includes(name);
    if (kitFile && !requirements.kitPaths.has(name)) problems.push(`the source archive's kit holds ${name}, which the checker's kit does not`);
  }
  const commercial = entries.find((e) => /^(\.\/)?bitwarden_license(\/|$)/.test(e.name));
  if (commercial) problems.push(`the source archive carries ${commercial.name} (apply.sh removes bitwarden_license/)`);
  const record = files.get(UPSTREAM_TREE_RECORD);
  if (record && record.data.length > 0 && requirements.commit) problems.push(...upstreamTreeProblems(files, record.data.toString("utf8"), requirements));
  return problems;
}

/**
 * What a package's GPL-3.0 files get wrong (plan T3.9), or []: all four present; LICENSE.txt is GPL-3.0; LICENSE-UPSTREAM.txt
 * is upstream's notice; NOTICE.txt is exactly the template's text for this build (the changelog's label and version, the
 * lock's tag and commit, the fork's address for that label, the SDK version and commit sdk-hashes.txt records); THIRD-PARTY-NOTICES.txt
 * lists packages, the GPL SDK among them when a module is packed, and carries the section (and licence) of every font or
 * picture with terms of its own that the package holds.
 */
export function noticeProblems(byName, { entry, lock, noticeTemplate, kitDir, sdkSource, licences, noticeRecord = [] }) {
  const problems = [];
  const text = (name) => byName.get(name)?.data.toString("utf8");
  for (const name of NOTICE_FILES) if (!byName.has(name)) problems.push(`no ${name} at the package's root`);

  // Each byte-equal to the source archive's copy, which checkArtefacts has held to the pinned hash (round 46); when the
  // archive could not vouch for one, the package's copy is refused too — never accepted on its look.
  for (const [name, want, what] of [["LICENSE.txt", licences?.gpl, "./LICENSE_GPL.txt"], ["LICENSE-UPSTREAM.txt", licences?.upstream, "./LICENSE.txt"]]) {
    const have = byName.get(name)?.data;
    if (!have) continue;
    if (!want) problems.push(`${name} cannot be held to a pinned ${what} (the source archive's copy is missing or not the pinned text)`);
    else if (!have.equals(want)) problems.push(`${name} is not the source archive's ${what}, the text pinned for the lock's tag`);
  }

  const notice = text("NOTICE.txt");
  if (notice !== undefined && noticeTemplate !== null) {
    const m = noticePattern(noticeTemplate).exec(notice);
    if (!m) problems.push("NOTICE.txt is not the notice template's text");
    else {
      const g = m.groups;
      const want = {
        LABEL: entry?.label, VERSION: entry?.version, UPSTREAM_TAG: lock.tag, UPSTREAM_COMMIT: lock.commit,
        SOURCE_URL: entry && sourceUrl(entry.label), SDK_VERSION: sdkSource?.version, SDK_COMMIT: sdkSource?.commit,
      };
      for (const [key, value] of Object.entries(want)) {
        if (value !== undefined && g[key] !== value) problems.push(`NOTICE.txt's ${key} reads ${JSON.stringify(g[key])}, want ${JSON.stringify(value)}`);
      }
    }
  }

  const third = text("THIRD-PARTY-NOTICES.txt");
  if (third !== undefined) {
    const listed = /^Packages \((\d+)\): (.*)$/m.exec(third);
    if (!third.startsWith("THIRD-PARTY NOTICES — Kount Protect\n") || !listed || Number(listed[1]) === 0) {
      problems.push("THIRD-PARTY-NOTICES.txt lists no package");
    } else {
      const names = listed[2].split(", ");
      if (names.length !== Number(listed[1])) problems.push("THIRD-PARTY-NOTICES.txt's package count and list differ");
      // Each listed "<name> <version>" has its section.
      for (const n of names) if (!third.includes(`\n==== ${n} — `)) problems.push(`THIRD-PARTY-NOTICES.txt lists ${n} with no section`);
      // The SDK by the version the build installed (sdk-hashes.txt's gpl-source line), not by its name alone.
      const sdkKey = `@bitwarden/sdk-internal ${sdkSource?.version ?? "<no gpl-source line>"}`;
      if ([...byName.keys()].some((n) => n.endsWith(".wasm")) && !names.includes(sdkKey)) {
        problems.push(`THIRD-PARTY-NOTICES.txt does not list ${sdkKey}, whose module the package carries`);
      }
    }
    // Held to the build's own record of what it derived (review round 46 PR-MED-032): exactly its sections, in order,
    // each with its recorded sha256 — a package dropped from list and sections alike, an emptied body, another
    // version: each differs from the record. (The record binds the delivered file to the build's derivation from
    // webpack's module list; it is not an independent census of what was bundled.)
    const sections = noticeSections(third);
    if (noticeRecord.length === 0) problems.push("sdk-hashes.txt records no notices for this package's target");
    else {
      const have = sections.map((s) => `${sha256(s.text)} ${s.key}`);
      const want = noticeRecord.map((r) => `${r.hash} ${r.key}`);
      const missing = want.filter((w) => !have.includes(w));
      const extra = have.filter((h) => !want.includes(h));
      for (const w of missing) problems.push(`THIRD-PARTY-NOTICES.txt lacks the recorded section ${w.slice(65)} (or its text changed)`);
      for (const h of extra) problems.push(`THIRD-PARTY-NOTICES.txt holds a section the build did not record: ${h.slice(65)}`);
      if (!missing.length && !extra.length && have.join("\n") !== want.join("\n")) problems.push("THIRD-PARTY-NOTICES.txt's sections are not in the recorded order");
      // The text before the first section (review round 55 PR-MED-052): the generator's preamble for the recorded
      // packages — the record's leading run of package sections, in its order — byte for byte. With the sections
      // held by their hashes above, every byte of the file is then bound to the build's record.
      const firstMaterial = noticeRecord.findIndex((r) => !r.key.includes(" — licence: "));
      const listedNames = noticeRecord.slice(0, firstMaterial < 0 ? noticeRecord.length : firstMaterial).map((r) => r.key.slice(0, r.key.indexOf(" — licence: ")));
      const head = /^==== .+ ====$/m.exec(third);
      if ((head ? third.slice(0, head.index) : third) !== thirdPartyPreamble(listedNames)) {
        problems.push("THIRD-PARTY-NOTICES.txt's text before its first section is not the generated preamble for the recorded packages");
      }
    }
    // Every package section has a body: each licence file's text, or the fixed no-file line — never empty.
    for (const s of sections) {
      if (!/ — licence: /.test(s.key)) continue;
      const body = s.text.split("\n").slice(1).join("\n").trim();
      const files = [...body.matchAll(/^--- (.+) ---\n([\s\S]*?)(?=^--- .+ ---$|$(?![\s\S]))/gm)];
      const hollow = body === "" || (body !== NO_LICENCE_FILE && (files.length === 0 || files.some((f) => f[2].trim() === "")));
      if (hollow) problems.push(`THIRD-PARTY-NOTICES.txt's section ${s.key} has no licence text`);
    }
    for (const m of OTHER_MATERIAL) {
      if (!materialPresent(m, [...byName.keys()], (n) => text(n) ?? "")) continue;
      if (!third.includes(`==== ${m.title} ====\n${m.text}\n`)) problems.push(`THIRD-PARTY-NOTICES.txt has no section for ${m.title}`);
      else if (m.package && !sections.some((s) => s.key.startsWith(`${m.package} `) && / — licence: /.test(s.key))) {
        problems.push(`THIRD-PARTY-NOTICES.txt carries no ${m.package} licence section for ${m.title}`);
      } else if (m.licence) {
        let licence = null;
        try {
          licence = readFileSync(join(kitDir, "notice", m.licence), "utf8").trimEnd();
        } catch {
          problems.push(`no build/notice/${m.licence}`);
        }
        if (licence !== null && !third.includes(licence)) problems.push(`THIRD-PARTY-NOTICES.txt does not carry ${m.licence} for ${m.title}`);
      }
    }
  }
  return problems;
}

/** The entries of a zip, each { name, data } — refuses what a store package never holds. */
export function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip (no end-of-directory record)");
  if (buf.readUInt16LE(eocd + 4) !== 0 || buf.readUInt16LE(eocd + 6) !== 0) throw new Error("a multi-disk zip");
  const total = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (total === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) throw new Error("a zip64 archive");
  if (buf.readUInt16LE(eocd + 8) !== total) throw new Error("an end record whose two entry counts differ");
  // The directory ends exactly at the end record, and the end record (with its comment) ends the file: a browser's zip
  // reader that walks the directory to its end must see no entry this one has not read (review round 9 MED-001).
  if (cdOffset + cdSize !== eocd) throw new Error("a central directory that does not end at the end record");
  if (eocd + 22 + buf.readUInt16LE(eocd + 20) !== buf.length) throw new Error("bytes after the end record");
  const entries = [];
  const names = new Set();
  let p = cdOffset;
  for (let i = 0; i < total; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error("a damaged central directory");
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const mode = buf.readUInt32LE(p + 38) >>> 16;
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nlen);
    p += 46 + nlen + elen + clen;
    if (!/^[A-Za-z0-9._@+-][A-Za-z0-9._@+/-]*$/.test(name) || name.split("/").some((s) => s === "." || s === "..")) {
      throw new Error(`an entry name that is not plain: ${JSON.stringify(name.slice(0, 80))}`);
    }
    if (names.has(name)) throw new Error(`a duplicate entry: ${name}`);
    names.add(name);
    if (flags & 1) throw new Error(`an encrypted entry: ${name}`);
    if ((mode & 0o170000) === 0o120000) throw new Error(`a symlink entry: ${name}`);
    if (name.endsWith("/")) continue; // a directory entry
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw new Error(`a damaged local header: ${name}`);
    // The local header must name the same file, by the same method: a reader that trusts local headers sees what this one does.
    const localName = buf.toString("utf8", local + 30, local + 30 + buf.readUInt16LE(local + 26));
    if (localName !== name || buf.readUInt16LE(local + 8) !== method) throw new Error(`a local header that disagrees with the directory: ${name}`);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    if (start + csize > cdOffset) throw new Error(`an entry whose data runs into the directory: ${name}`);
    const raw = buf.subarray(start, start + csize);
    // Inflated to no more than its record says, and never past the cap: a zip bomb handed to the publish lane is refused,
    // not expanded (review round 12 SEC-001).
    if (usize > MAX_ENTRY_BYTES) throw new Error(`an entry larger than ${MAX_ENTRY_BYTES} bytes: ${name}`);
    let data;
    if (method === 0) data = raw;
    else if (method === 8) {
      try {
        data = zlib.inflateRawSync(raw, { maxOutputLength: Math.max(usize, 1) });
      } catch {
        throw new Error(`an entry that does not inflate to its recorded size: ${name}`);
      }
    } else throw new Error(`an entry compressed by method ${method}: ${name}`);
    if (data.length !== usize) throw new Error(`an entry whose size differs from its record: ${name}`);
    if (typeof zlib.crc32 === "function" && zlib.crc32(data) >>> 0 !== crc) throw new Error(`an entry whose CRC differs: ${name}`);
    entries.push({ name, data });
  }
  if (p !== cdOffset + cdSize) throw new Error("a central directory holding more or fewer records than its end record counts");
  return entries;
}

/**
 * The README's identity fields, exactly one line each: `- Name: \`…\``, `- Firefox id: \`…\`` and `- Firefox data
 * collection: \`<category>, …\`` — the declaration every Firefox package must carry exactly (review round 13
 * PR-MED-011): Mozilla categories only, no duplicate, never `none` (the vault's sync sends data off the device).
 */
export function readmeIdentity(text) {
  const one = (label) => {
    const found = [...text.matchAll(new RegExp(`^- ${label}: \`([^\`]+)\`$`, "gm"))].map((m) => m[1]);
    if (found.length !== 1) throw new Error(`README identity: want exactly one "- ${label}: \`…\`" line, found ${found.length}`);
    return found[0];
  };
  const name = one("Name");
  const firefoxId = one("Firefox id");
  const dataCollection = one("Firefox data collection").split(",").map((c) => c.trim());
  if (dataCollection.some((c) => !MOZILLA_CATEGORIES.has(c)) || new Set(dataCollection).size !== dataCollection.length) {
    throw new Error(`README identity: the Firefox data collection line names a duplicate or a category Mozilla does not (${dataCollection.join(", ")})`);
  }
  return { name, firefoxId, dataCollection };
}

/** What a Firefox manifest's declaration gets wrong against the README's, or null when it is exactly that. */
function declarationProblem(permissions, declared) {
  const required = permissions?.required;
  if (!Array.isArray(required) || required.length === 0) {
    return "no browser_specific_settings.gecko.data_collection_permissions.required (every new Firefox extension declares it)";
  }
  if (permissions.optional !== undefined && !(Array.isArray(permissions.optional) && permissions.optional.length === 0)) {
    return `data_collection_permissions.optional ${JSON.stringify(permissions.optional)}: the README declares required categories only`;
  }
  const want = [...declared].sort();
  const have = [...required].sort();
  if (have.length !== want.length || have.some((c, i) => c !== want[i])) {
    return `data_collection_permissions.required ${JSON.stringify(required)} is not the README's declaration ${JSON.stringify(declared)}`;
  }
  return null;
}

const sha256 = (data) => createHash("sha256").update(data).digest("hex");

/** One allowlist class covers the hit at `at` in `text`, or null. */
function allowedClass(file, text, at) {
  const from = Math.max(0, at - 160);
  const window = text.slice(from, at + 160);
  for (const [cls, fileRe, re] of ALLOWED) {
    if (fileRe && !fileRe.test(file)) continue;
    const g = new RegExp(re.source, "g");
    for (const m of window.matchAll(g)) {
      const s = from + m.index;
      if (s <= at && at < s + m[0].length) return cls;
    }
  }
  return null;
}

/** Check one output directory; resolves to { problems: string[], packages: number, notes: string[] }. */
export function checkArtefacts(dir, { mode = "store", appDir = join(HERE, ".."), kitDir = HERE } = {}) {
  const problems = [];
  const notes = [];
  const problem = (what) => problems.push(what);
  const proofs = mode === "proofs";

  let entry;
  let identity;
  try {
    entry = topEntry(readFileSync(join(appDir, "CHANGELOG.md"), "utf8"), lockTag(readFileSync(join(appDir, "upstream.lock"), "utf8")));
  } catch (err) {
    problem(`changelog: ${err.message}`);
  }
  try {
    identity = readmeIdentity(readFileSync(join(appDir, "README.md"), "utf8"));
  } catch (err) {
    problem(err.message);
  }
  if (mode === "release" && entry && entry.status !== "release") {
    problem(`the top CHANGELOG.md entry ${entry.label} is a ${entry.status}: a candidate is never a release artefact`);
  }
  // The checker's own rules beside it (like ALLOWED, the checker's, never the records': the publish lane passes only the
  // build commit's CHANGELOG.md, README.md and upstream.lock as --app-dir) — the reviewed pictures and the notice kit.
  const ruleFile = (path) => {
    try {
      return readFileSync(join(kitDir, path), "utf8");
    } catch {
      problem(`no build/${path} (the checker's own rules)`);
      return null;
    }
  };
  let reviewed = null;
  const reviewedText = ruleFile("reviewed-images.tsv");
  if (reviewedText !== null) {
    try {
      reviewed = readReviewedImages(reviewedText);
    } catch (err) {
      problem(err.message);
    }
  }
  const noticeTemplate = ruleFile("notice/NOTICE.template.txt");
  let shieldGlyphs = null;
  const glyphsText = ruleFile("shield-glyphs.tsv");
  if (glyphsText !== null) {
    try {
      shieldGlyphs = readShieldGlyphs(glyphsText);
    } catch (err) {
      problem(err.message);
    }
  }
  let licencePins = null;
  const pinsText = ruleFile("notice/licence-pins.tsv");
  if (pinsText !== null) {
    licencePins = new Map();
    for (const [i, line] of pinsText.split("\n").entries()) {
      if (line === "" || line.startsWith("#")) continue;
      const m = /^(\S+)\t(\.\/\S+)\t([0-9a-f]{64})$/.exec(line);
      if (!m) problem(`licence-pins.tsv line ${i + 1} is not "<tag>\\t<archive path>\\t<sha256>"`);
      else licencePins.set(`${m[1]}\t${m[2]}`, m[3]);
    }
  }
  // The lock is a record: the build's.
  let lockText = "";
  try {
    lockText = readFileSync(join(appDir, "upstream.lock"), "utf8");
  } catch {
    // the changelog read above has already named a missing lock
  }
  const lock = { tag: /^UPSTREAM_TAG=(\S+)$/m.exec(lockText)?.[1], commit: /^UPSTREAM_COMMIT=([0-9a-f]{40})$/m.exec(lockText)?.[1] };

  // SHA256SUMS first: every other read is of files it vouches for.
  const wantedPackages = TARGETS.map((t) => `kount-protect-${t}.zip`);
  const listed = new Map();
  let sums = "";
  try {
    sums = readFileSync(join(dir, "SHA256SUMS"), "utf8");
  } catch {
    problem("no SHA256SUMS");
  }
  for (const line of sums.split("\n").filter(Boolean)) {
    const m = /^([0-9a-f]{64}) [ *]([A-Za-z0-9._-]+)$/.exec(line);
    if (!m) {
      problem(`a malformed SHA256SUMS line: ${JSON.stringify(line.slice(0, 120))}`);
      continue;
    }
    if (listed.has(m[2])) problem(`SHA256SUMS names ${m[2]} twice`);
    listed.set(m[2], m[1]);
  }
  for (const name of listed.keys()) {
    if (!wantedPackages.includes(name) && name !== "kount-protect-source.tar.gz" && name !== "sdk-hashes.txt") {
      problem(`SHA256SUMS names ${name}, which is not an artefact`);
    }
  }
  for (const name of ["kount-protect-source.tar.gz", "sdk-hashes.txt", ...(proofs ? [] : wantedPackages)]) {
    if (!listed.has(name)) problem(`SHA256SUMS does not name ${name}`);
  }
  const files = new Map();
  for (const [name, hash] of listed) {
    let data;
    try {
      if (!statSync(join(dir, name)).isFile()) throw new Error("not a file");
      data = readFileSync(join(dir, name));
    } catch {
      problem(`${name} is missing`);
      continue;
    }
    if (sha256(data) !== hash) problem(`${name} does not match its SHA256SUMS line`);
    else files.set(name, data);
  }
  const archive = files.get("kount-protect-source.tar.gz");
  // The licence texts the packages must carry: the archive's copies, held to the pins for the lock's tag (round 46).
  const licences = { gpl: null, upstream: null };
  if (archive && !(archive[0] === 0x1f && archive[1] === 0x8b)) problem("kount-protect-source.tar.gz is not a gzip file");
  else if (archive) {
    try {
      const members = tarEntries(zlib.gunzipSync(archive, { maxOutputLength: MAX_ARCHIVE_BYTES }));
      for (const [key, path] of [["gpl", "./LICENSE_GPL.txt"], ["upstream", "./LICENSE.txt"]]) {
        const member = members.find((e) => e.name === path && e.type === "0");
        if (!member) continue; // the archive rule names it
        const pinned = licencePins?.get(`${lock.tag}\t${path}`);
        if (!pinned) problem(`build/notice/licence-pins.tsv has no row for ${lock.tag} ${path}: read the text in the new tree, then pin it`);
        else if (sha256(member.data) !== pinned) problem(`the source archive's ${path} is not the text pinned for ${lock.tag} (licence-pins.tsv)`);
        else licences[key] = member.data;
      }
      let requirements = null;
      try {
        requirements = archiveRequirements(join(kitDir, ".."), { lock: lockText, changelog: readFileSync(join(appDir, "CHANGELOG.md"), "utf8") }, { proofs });
      } catch (err) {
        problem(`the source archive cannot be held to the kit: ${err.message}`);
      }
      if (requirements) for (const what of sourceArchiveProblems(members, requirements)) problem(what);
    } catch (err) {
      problem(`kount-protect-source.tar.gz cannot be read: ${err.message}`);
    }
  }

  // The SDK record: the GPL SDK's .wasm hashes (at least one) and the commercial SDK's (or "not-installed").
  const gpl = new Set();
  const commercial = new Set();
  let sdkSource = null;
  const sdk = files.get("sdk-hashes.txt")?.toString("utf8") ?? "";
  const noticeRecord = new Map(TARGETS.map((t) => [t, []]));
  for (const line of sdk.split("\n").filter(Boolean)) {
    const noticeLine = /^notice (chrome|edge|firefox) ([0-9a-f]{64}) (\S.*)$/.exec(line);
    if (noticeLine) {
      noticeRecord.get(noticeLine[1]).push({ hash: noticeLine[2], key: noticeLine[3] });
      continue;
    }
    const source = /^gpl-source (\d+\.\d+\.\d+[0-9A-Za-z.+-]*) ([0-9a-f]{40})$/.exec(line);
    if (source) {
      if (sdkSource) problem("sdk-hashes.txt names the GPL SDK's source twice");
      sdkSource = { version: source[1], commit: source[2] };
      continue;
    }
    const m = /^(gpl|commercial) (?:([0-9a-f]{64}) \S+|not-installed)$/.exec(line);
    if (!m) problem(`a malformed sdk-hashes.txt line: ${JSON.stringify(line.slice(0, 120))}`);
    else if (m[2]) (m[1] === "gpl" ? gpl : commercial).add(m[2]);
  }
  if (files.has("sdk-hashes.txt") && gpl.size === 0) problem("sdk-hashes.txt names no GPL SDK module: nothing to hold the .wasm files to");
  if (files.has("sdk-hashes.txt") && !sdkSource) problem("sdk-hashes.txt has no gpl-source line: nothing to hold NOTICE.txt's SDK source to");

  let packages = 0;
  for (const target of TARGETS) {
    const name = `kount-protect-${target}.zip`;
    const buf = files.get(name);
    if (!buf) continue;
    packages++;
    const p = (what) => problem(`${name}: ${what}`);
    let entries;
    try {
      entries = readZip(buf);
    } catch (err) {
      p(err.message);
      continue;
    }
    const byName = new Map(entries.map((e) => [e.name, e]));
    const json = (path) => {
      const e = byName.get(path);
      if (!e) throw new Error(`no ${path}`);
      return JSON.parse(e.data.toString("utf8"));
    };

    // Identity.
    try {
      const manifest = json("manifest.json");
      const messages = json("_locales/en/messages.json");
      if (identity) {
        const extName = manifest.name === "__MSG_extName__" ? messages.extName?.message : manifest.name;
        if (extName !== identity.name) p(`the name reads ${JSON.stringify(extName)}, the README says ${JSON.stringify(identity.name)}`);
        if (manifest.short_name !== identity.name) p(`short_name reads ${JSON.stringify(manifest.short_name)}`);
      }
      for (const [key, value] of Object.entries(messages)) {
        if (typeof value?.message === "string" && /bitwarden/i.test(value.message) && !Object.hasOwn(SHOWN_ALLOWED, key)) {
          p(`the English message ${key} shows ${JSON.stringify(value.message.slice(0, 80))}: not an allowed message`);
        }
      }
      for (const e of entries) {
        if (e.name.endsWith(".html") && /bitwarden/i.test(e.data.toString("utf8").replace(/<script[\s\S]*?<\/script>/gi, ""))) {
          p(`${e.name} names bitwarden in its markup`);
        }
      }
      if (entry && manifest.version !== entry.version) p(`version ${JSON.stringify(manifest.version)}, the top CHANGELOG.md entry says ${entry.version}`);
      // Updates come from each store (plan T3.5): an update address in a package would point browsers elsewhere for good.
      if (Object.hasOwn(manifest, "update_url")) p(`an update_url (${JSON.stringify(manifest.update_url)}): each store serves the updates (plan T3.5)`);
      if (target === "firefox") {
        const gecko = manifest.browser_specific_settings?.gecko ?? {};
        if (identity && gecko.id !== identity.firefoxId) p(`the Firefox id reads ${JSON.stringify(gecko.id)}, the README says ${JSON.stringify(identity.firefoxId)}`);
        if (identity) {
          const wrong = declarationProblem(gecko.data_collection_permissions, identity.dataCollection);
          if (wrong) p(wrong);
        }
        if (gecko.strict_min_version !== FIREFOX_MIN_VERSION) {
          p(`the Firefox strict_min_version reads ${JSON.stringify(gecko.strict_min_version)}, want "${FIREFOX_MIN_VERSION}" (Firefox's own data consent; store/README.md § Firefox's channel)`);
        }
        if (Object.hasOwn(gecko, "update_url")) p(`a gecko update_url (${JSON.stringify(gecko.update_url)}): addons.mozilla.org serves the updates (plan T3.5)`);
        // Firefox still reads Manifest V2's deprecated alias of browser_specific_settings, which could carry another id or
        // an update address past the rules above; the build never writes it (review round 52 LOW-006).
        if (Object.hasOwn(manifest, "applications")) p("an applications key (Firefox's deprecated alias of browser_specific_settings): the package declares its settings once, under browser_specific_settings");
      } else {
        if (manifest.manifest_version !== 3) p(`manifest_version ${manifest.manifest_version} (Chrome and Edge are Manifest V3)`);
        if (manifest.browser_specific_settings) p("a Chromium package carries browser_specific_settings");
      }
    } catch (err) {
      p(`its manifest or English messages cannot be read: ${err.message}`);
    }

    // The GPL-3.0 files (plan T3.9).
    for (const what of noticeProblems(byName, { entry, lock, noticeTemplate, kitDir, sdkSource, licences, noticeRecord: noticeRecord.get(target) })) p(what);

    // The pictures and fonts, each one reviewed (plan T3.8).
    if (reviewed) {
      for (const e of entries) {
        // By name, or by its first bytes whatever its name (a picture renamed .bin is still a picture).
        const picture = IMAGE.test(e.name) || (!e.name.endsWith(".wasm") && looksLikePicture(e.data));
        if (!picture) continue;
        const h = sha256(e.data);
        if (!reviewed.get(e.name)?.has(h)) {
          p(`${e.name} (${h.slice(0, 12)}…) is a picture or font build/reviewed-images.tsv does not name with this hash: look at it, then add its line`);
        }
      }
    }

    // The build constants, each from its one use site.
    const sites = { vault: [], protect: [], sso: [] };
    const elsewhere = { vault: [], protect: [], sso: [] };
    for (const e of entries) {
      if (!e.name.endsWith(".js")) continue;
      const text = e.data.toString("utf8");
      for (const [which, pattern] of [["vault", VAULT_SITE], ["protect", PROTECT_SITE], ["sso", SSO_SITE]]) {
        const values = siteValues(text, pattern);
        if (e.name === SITE_OWNERS[which]) sites[which].push(...values);
        else if (values.length > 0) elsewhere[which].push(e.name);
      }
    }
    for (const which of ["vault", "protect", "sso"]) {
      if (elsewhere[which].length > 0) p(`the ${which} constant's use site is in ${elsewhere[which].join(", ")}: it belongs in ${SITE_OWNERS[which]} alone`);
      if (sites[which].length !== 1) {
        p(`the ${which} constant's use site was found ${sites[which].length} times in ${SITE_OWNERS[which]} (want exactly 1)`);
        continue;
      }
      const value = sites[which][0];
      if (typeof value !== "string") {
        p(`the ${which} constant's use site reads ${value.name}, which its file defines as a string ${value.definitions} times (want exactly 1)`);
        continue;
      }
      if (which === "sso") {
        // Not an address: the same word in a store and a proofs package (build.sh --proofs leaves it as it is).
        if (value !== PRODUCTION.sso) p(`the sso constant is ${JSON.stringify(value)}: every package carries ${JSON.stringify(PRODUCTION.sso)} (sign-in-lock-and-look T1.3)`);
      } else if (proofs) {
        let host = null;
        try {
          host = new URL(value).hostname;
        } catch {
          // reported below
        }
        if (host === null || !isLoopbackHost(host)) p(`the ${which} constant is ${JSON.stringify(value)}: a proofs package points at loopback`);
      } else if (value !== PRODUCTION[which]) {
        p(`the ${which} constant is ${JSON.stringify(value)}: a store package carries ${PRODUCTION[which]} (E21)`);
      }
    }
    // The page marker (plan T1.4, Decision 6): its bundle in every package, and in it the origin's second checked
    // consumer — the constant compiled in once and passed to the marker once — the same full origin as the hook's.
    const marker = entries.find((e) => e.name === MARKER_BUNDLE);
    if (!marker) {
      p(`no ${MARKER_BUNDLE}: the page marker's bundle is missing (plan T1.4)`);
    } else {
      // Code lines only: a comment carrying the call or the constant never counts (round 11 PR-MED-056).
      const text = codeOnly(marker.data.toString("utf8"));
      const values = [...text.matchAll(MARKER_ORIGIN)].map((m) => m[1]);
      const calls = text.split(MARKER_CALL).length - 1;
      if (values.length !== 1 || calls !== 1) {
        p(`the marker's origin was found ${values.length} times and its call ${calls} times in ${MARKER_BUNDLE} (want exactly 1 each)`);
      } else if (sites.protect.length === 1 && typeof sites.protect[0] === "string" && values[0] !== sites.protect[0]) {
        p(`the marker's origin is ${JSON.stringify(values[0])}, the background's ${JSON.stringify(sites.protect[0])}: both bundles carry the one constant`);
      }
    }

    // The commercial code, the maps, the marks, the name scan.
    // The forbidden shield code points: the CSS definitions' AND those of every icon font the package carries — from
    // the reviewed font's pin (shield-glyphs.tsv) and its SVG form's own glyph names — so a stylesheet that drops or
    // renames its selectors cannot switch the rule off (review round 46 PR-MED-033).
    const glyphPoints = new Set(shieldCodePoints(entries).keys());
    for (const e of entries) {
      if (!ICON_FONT.test(e.name)) continue;
      const pinned = shieldGlyphs?.get(sha256(e.data));
      if (shieldGlyphs && !pinned) p(`${e.name} is an icon font build/shield-glyphs.tsv does not name: read its glyph map, then add its row`);
      for (const point of pinned ?? []) glyphPoints.add(point);
      if (e.name.endsWith(".svg")) for (const point of svgFontShieldPoints(e.data.toString("utf8"))) glyphPoints.add(point);
    }
    let wasm = 0;
    let hits = 0;
    const classes = new Map();
    const attribution = [];
    for (const e of entries) {
      if (e.name.endsWith(".wasm")) {
        wasm++;
        const h = sha256(e.data);
        if (commercial.has(h)) p(`${e.name} is the commercial SDK's module`);
        else if (!gpl.has(h)) p(`${e.name} (${h.slice(0, 12)}…) is no GPL SDK module sdk-hashes.txt names`);
        continue;
      }
      if (e.name.endsWith(".map")) {
        if (!proofs) p(`${e.name}: a source map in a store package`);
        continue;
      }
      if (BINARY.test(e.name)) continue;
      const text = e.data.toString("utf8");
      // Every text scan below reads the same readings (review round 49 PR-MED-045; the three word rules since round 54
      // PR-MED-050): the file as written, its decoded views and each of those percent-decoded.
      const all = readings(text);
      const holds = (word) => all.some((r) => r.text.includes(word));
      if (holds("commercial-sdk-internal")) p(`${e.name} names the commercial SDK`);
      if (mode === "release" && holds(ATTRIBUTION_MARKER)) p(`${e.name} still holds the attribution placeholder (T3.6)`);
      // The approved attribution in a release (review round 54 PR-MED-049): its literal is counted in every reading
      // (the most any one holds, so a copy behind an escape counts too) and checked once the package is read; any other
      // attribution wording, in any reading of any file but the notices, is refused here.
      if (mode === "release") {
        const most = Math.max(...all.map((r) => r.text.split(ATTRIBUTION_LITERAL).length - 1));
        if (most > 0) attribution.push({ name: e.name, most, written: text.split(ATTRIBUTION_LITERAL).length - 1 });
        const other = NOTICE_FILES.includes(e.name)
          ? null
          : all.map((r) => ATTRIBUTION_WORDING.exec(r.text.split(ATTRIBUTION_LITERAL).join(""))).find(Boolean);
        if (other) p(`${e.name} holds attribution wording other than the approved line (${JSON.stringify(other[0])}): the About dialog carries ${ATTRIBUTION_LITERAL} and nothing else`);
      }
      const drawing = BRAND_DRAWINGS.find((d) => all.some((r) => r.text.includes(d)));
      if (drawing) p(`${e.name} draws Bitwarden's shield or wordmark (path data ${JSON.stringify(drawing)})`);
      const shieldClass = /\.(js|html?)$/.test(e.name) ? all.map((r) => SHIELD_GLYPH.exec(r.text)).find(Boolean) : null;
      if (shieldClass) p(`${e.name} draws the icon font's Bitwarden shield glyph (${shieldClass[0]})`);
      // Every data: URL, classified once: a picture's decoded bytes must be reviewed under <file>#embedded; a base64
      // payload that does not decode is refused (review round 48 PR-MED-041) — except in a percent-decoded reading,
      // where a payload may have been percent-decoded twice.
      const seen = new Set();
      for (const { text: reading, percent } of all) {
        for (const url of dataUrls(reading)) {
          if (url.undecodable && percent) continue;
          if (url.undecodable) {
            const key = `undecodable ${url.head}`;
            if (!seen.has(key)) p(`${e.name} holds a base64 data: URL whose payload does not decode (${url.head.slice(0, 60)}…)`);
            seen.add(key);
            continue;
          }
          if (!url.picture || url.bytes === null || !reviewed) continue;
          const h = sha256(url.bytes);
          if (seen.has(h)) continue;
          seen.add(h);
          if (!reviewed.get(`${e.name}#embedded`)?.has(h)) {
            p(`${e.name} embeds a ${looksLikePicture(url.bytes) && !/^(image|font)\//.test(url.type) ? `picture (by its bytes; declared ${url.type})` : url.type} (${h.slice(0, 12)}…) build/reviewed-images.tsv does not name under ${e.name}#embedded: look at it, then add its line`);
          }
        }
      }
      const definitions = e.name.endsWith(".css") ? shieldCodePoints([e]) : new Map();
      const classUses = Math.max(...all.map((r) => (r.text.match(SHIELD_GLYPH_IN_CSS) ?? []).length));
      if (e.name.endsWith(".css") && classUses > [...definitions.values()].reduce((a, b) => a + b, 0)) {
        p(`${e.name} names a shield glyph class in a shape the checker cannot read its code point from`);
      }
      // Pictures and fonts are held by their reviewed hash; the font defines the glyph itself.
      const views = all.slice(1).map((r) => r.text);
      for (const point of IMAGE.test(e.name) ? [] : glyphPoints) {
        // A stylesheet may name a code point once per definition of THAT code point it holds; nothing else may name it.
        if (codePointUses(text, point, views) > (definitions.get(point) ?? 0)) {
          p(`${e.name} names the shield glyph's code point U+${point.toString(16).toUpperCase()} outside its definitions`);
        }
      }
      // Two notice files name Bitwarden, Inc. and bitwarden_license/ by necessity; noticeProblems holds them instead.
      if (NAME_SCAN_EXEMPT.includes(e.name)) continue;
      if (holds("bitwarden_license")) p(`${e.name} names bitwarden_license`);
      // The name through an escape (review round 49 PR-MED-045): every allowed class is a spelling in the file as
      // written, so a reading holding more capitalised "Bitwarden" than the file itself is refused.
      const named = (t) => t.split("Bitwarden").length - 1;
      const escapedName = all.find((r) => named(r.text) > named(text));
      if (escapedName) p(`${e.name} spells the product name through an escape or encoding (a decoded reading holds ${named(escapedName.text)} "Bitwarden", the file ${named(text)})`);
      for (const m of text.matchAll(/Bitwarden/g)) {
        hits++;
        const cls = allowedClass(e.name, text, m.index);
        if (cls) classes.set(cls, (classes.get(cls) ?? 0) + 1);
        else p(`the product name, not allowed: ${e.name}: …${text.slice(Math.max(0, m.index - 50), m.index + 60).replace(/\s+/g, " ")}…`);
      }
    }
    if (mode === "release") {
      // Exactly one copy, written as is (not only through an escape), and only in the About output: none is deletion,
      // alteration or a wording added inside the literal; two is a second copy.
      const total = attribution.reduce((n, a) => n + a.most, 0);
      const about = attribution.find((a) => a.name === ABOUT_OUTPUT);
      if (total !== 1 || !about || about.written !== 1) {
        const found = attribution.map((a) => `${a.name} ×${a.most}${a.written === a.most ? "" : ` (${a.written} as written)`}`).join(", ") || "none";
        p(`the approved attribution line must be in ${ABOUT_OUTPUT} exactly once, as written: ${ATTRIBUTION_LITERAL}; found ${found} (T3.1, T3.6)`);
      }
    }
    if (wasm === 0) p("no .wasm module (the SDK): the commercial check had nothing to hold");
    notes.push(`${name}: ${entries.length} entries, ${wasm} wasm, ${hits} product-name hits in ${classes.size} allowed classes`);
  }
  if (packages === 0) problem("no package to check");
  return { problems, packages, notes };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let mode = "store";
  let appDir;
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--release") mode = "release";
    else if (args[i] === "--proofs") mode = "proofs";
    else if (args[i] === "--app-dir") appDir = args[++i];
    else rest.push(args[i]);
  }
  if (rest.length !== 1 || (args.includes("--release") && args.includes("--proofs"))) {
    console.error("usage: check-artefacts.sh [--release | --proofs] <dir>");
    process.exit(2);
  }
  let dir;
  try {
    if (!statSync(rest[0]).isDirectory()) throw new Error();
    dir = rest[0];
  } catch {
    console.error(`check-artefacts.sh: no directory at ${rest[0]}`);
    process.exit(2);
  }
  const { problems, packages, notes } = checkArtefacts(dir, { mode, ...(appDir ? { appDir } : {}) });
  for (const n of notes) console.log(`ARTEFACT_NOTE ${n}`);
  for (const what of problems) console.log(`ARTEFACT_PROBLEM ${what}`);
  console.log(`Artefacts (${mode}, ${basename(dir)}): ${packages} packages checked, ${problems.length} problems.`);
  process.exit(problems.length === 0 ? 0 : 1);
}
