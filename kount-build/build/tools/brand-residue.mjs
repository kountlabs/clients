// The brand residue (plan Decision 5, T1.1): the "must go" list of the spike's name scan (docs/spike-2026-11.md
// § T0.3) and what the T1.1 scan of a whole package found beside it, edited in the applied tree (.build/clients) in
// place; then diff-patch.mjs writes patches/0010-brand-residue.patch. Re-run at a rebase:
//
//   bash apps/kount-extension/build/apply.sh            (a tree that already holds an edit counts it as `already`)
//   node apps/kount-extension/build/tools/brand-residue.mjs
//   node apps/kount-extension/build/tools/diff-patch.mjs 0010-brand-residue <each path it lists>
//
// Each rule names one upstream file, the exact text it expects and how many times; a count that differs (upstream moved
// the text) stops the run naming the rule, so a rebase sees it rather than shipping a half-branded build. Text only: the
// file is edited as text so the patch stays minimal. Reads and writes the tree as data; executes nothing from it.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TREE = join(APP, ".build", "clients");

/**
 * The placeholder T1.1 put after the attribution line until the legal check (T3.1). T3.6 removed it: the line is the
 * approved wording. Kept as a constant because the release checker still refuses any package that holds it.
 */
export const ATTRIBUTION_MARKER = "[attribution wording pending the legal check]";

/**
 * The attribution line the legal check approved (T3.1, recorded 2026-11-12; docs/licence-facts.md § Outcome of the legal
 * check), as a person reads it. The one value the About rule below writes, store/check-kit.mjs holds the listing to and
 * check-artefacts.mjs --release requires in each package's About output (review round 54 PR-MED-049).
 */
export const APPROVED_ATTRIBUTION = "Kount Protect was developed using Bitwarden® open source software.";

/**
 * Attribution wording. Outside the approved line (and, in the store texts, the factual sentences below), any of it is a
 * second, altered or appended attribution. One definition for both gates (review round 55 PR-MED-051): the release
 * checker (check-artefacts.mjs, over every reading of every package file but the notices) and the listing kit's check
 * (store/check-kit.mjs, over every fenced text block — the text pasted into a store).
 */
export const ATTRIBUTION_WORDING =
  /developed (?:using|with|from|on)|open[- ]source software|free software|(?:built|derived|based) (?:on|from|with|using) (?:the )?(?:bitwarden|open|free)/i;

/**
 * The store texts' two factual sentences about where the software comes from — not attributions — each allowed exactly
 * once, as written, in its own fenced block, and nowhere else (review round 55 PR-MED-051). Kept as the kit carries them
 * since T3.6; the T3.1 outcome asked for no change to the store texts.
 */
export const FACTUAL_PROVENANCE = [
  {
    file: "listing-text.md",
    heading: "Long description",
    text: "Kount Protect is a modified build of the open-source browser extension published by Bitwarden, Inc., licensed under the GNU General Public License v3.0.",
  },
  {
    file: "privacy-statement.md",
    heading: "Privacy statement — draft",
    text: "While it uses Kount's vault, it sends nothing to Bitwarden, Inc., which publishes the open-source software it is built from.",
  },
];

const B = "apps/browser/src";
/** [path, from, to, times] — `from` must occur exactly `times` times; `to` is never empty (a removal leaves a comment). */
export const RULES = [
  // The seven HTML titles a person can read (the tab, the window, the screen reader).
  [`${B}/popup/index.ejs`, "<title>Bitwarden</title>", "<title>Kount Protect</title>", 1],
  [`${B}/autofill/notification/bar.html`, "<title>Bitwarden</title>", "<title>Kount Protect</title>", 1],
  [`${B}/sidepanel-disabled.html`, "<title>Bitwarden</title>", "<title>Kount Protect</title>", 1],
  [`${B}/platform/offscreen-document/index.html`, "<title>Bitwarden Offscreen Document</title>", "<title>Kount Protect Offscreen Document</title>", 1],
  [`${B}/autofill/overlay/inline-menu/pages/list/list.html`, "<title>Bitwarden vault</title>", "<title>Kount Protect vault</title>", 1],
  [`${B}/autofill/overlay/inline-menu/pages/menu-container/menu-container.html`, "<title>Bitwarden inline menu</title>", "<title>Kount Protect inline menu</title>", 1],
  [`${B}/autofill/overlay/inline-menu/pages/button/button.html`, "<title>Bitwarden inline menu button</title>", "<title>Kount Protect inline menu button</title>", 1],
  // The diagnostic report's file name (its doc comment and its code).
  ["libs/logging/src/flight-recorder-export.ts", "Bitwarden-diagnostic-report-", "Kount-Protect-diagnostic-report-", 2],
  // The right-click menu's parent item, and Firefox's sidebar title.
  [`${B}/autofill/browser/main-context-menu-handler.ts`, 'title: "Bitwarden",', 'title: "Kount Protect",', 1],
  [`${B}/platform/badge/badge-browser-api.ts`, "const title = `Bitwarden${", "const title = `Kount Protect${", 1],
  // The phishing blocker's "Protected by …" label.
  [`${B}/dirt/phishing-detection/popup/protected-by-component.html`, '"Bitwarden phishing blocker"', '"Kount Protect phishing blocker"', 1],
  // Settings: "Download Kount Protect apps" (Bitwarden's own mobile and desktop apps, from bitwarden.com) and "More from
  // Kount Protect" (Bitwarden's other products and bitwarden.com) are hidden; their pages stay unlinked.
  [
    `${B}/tools/popup/settings/settings-v2.component.html`,
    `    <bit-item>
      <a bit-item-content routerLink="/download-bitwarden" [truncate]="false">
        <i slot="start" class="bwi bwi-mobile" aria-hidden="true"></i>
        <div class="tw-flex tw-items-center">
          <p class="tw-pr-2">{{ "downloadBitwardenApps" | i18n }}</p>
          @if (showDownloadBitwardenNudge$ | async) {
            <bit-berry
              variant="danger"
              [value]="1"
              [attr.aria-label]="'nudgeBadgeAria' | i18n"
            ></bit-berry>
          }
        </div>
        <i slot="end" class="bwi bwi-angle-right" aria-hidden="true"></i>
      </a>
    </bit-item>
    <bit-item>
      <a bit-item-content routerLink="/more-from-bitwarden" [truncate]="false">
        <i slot="start" class="bwi bwi-grid" aria-hidden="true"></i>
        {{ "moreFromBitwarden" | i18n }}
        <i slot="end" class="bwi bwi-angle-right" aria-hidden="true"></i>
      </a>
    </bit-item>
`,
    "    <!-- Kount: no \"Download … apps\" or \"More from …\" items (they offer Bitwarden's products and bitwarden.com). -->\n",
    1,
  ],
  // About: the help centre and "Rate the extension" lead to Bitwarden's pages — hidden. "About Kount Protect" (the
  // dialog: version, server, the legal notice) and the web vault (the Kount vault) stay.
  [
    `${B}/tools/popup/settings/about-page/about-page-v2.component.html`,
    `    <bit-item>
      <button type="button" bit-item-content (click)="launchHelp()">
        {{ "helpCenter" | i18n }}
        <i slot="end" class="bwi bwi-external-link" aria-hidden="true"></i>
      </button>
    </bit-item>
`,
    "    <!-- Kount: no help-centre link (it leads to Bitwarden's pages). -->\n",
    1,
  ],
  [
    `${B}/tools/popup/settings/about-page/about-page-v2.component.html`,
    `    <bit-item>
      <button type="button" bit-item-content (click)="rate()">
        {{ "rateExtension" | i18n }}
        <i slot="end" class="bwi bwi-external-link" aria-hidden="true"></i>
      </button>
    </bit-item>
`,
    "    <!-- Kount: no \"Rate the extension\" link (it leads to Bitwarden's store pages). -->\n",
    1,
  ],
  // The About dialog: the product's name; the copyright notice stays (a legal notice); the attribution line, the wording
  // the legal check approved (APPROVED_ATTRIBUTION above, its ® written as the template's &reg;).
  [
    `${B}/tools/popup/settings/about-dialog/about-dialog.component.html`,
    `  <div bitDialogTitle>Bitwarden</div>
  <div bitDialogContent>
    <p>&copy; Bitwarden Inc. 2015-{{ year }}</p>
`,
    `  <div bitDialogTitle>Kount Protect</div>
  <div bitDialogContent>
    <p>&copy; Bitwarden Inc. 2015-{{ year }}</p>
    <p>${APPROVED_ATTRIBUTION.replace("®", "&reg;")}</p>
`,
    1,
  ],
  // The About dialog's picture: Kount Protect's mark in place of the icon font's Bitwarden shield glyph (plan T3.8;
  // the glyph stays in upstream's font, which nothing else draws — check-artefacts.mjs refuses any page that does).
  [
    `${B}/tools/popup/settings/about-dialog/about-dialog.component.html`,
    `    <i class="bwi bwi-shield bwi-3x" aria-hidden="true"></i>\n`,
    `    <img src="/images/icon48.png" width="48" height="48" alt="" /><!-- Kount: the mark, not the shield glyph -->\n`,
    1,
  ],
];

const count = (text, needle) => text.split(needle).length - 1;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = new Map();
  const read = (path) => {
    if (!files.has(path)) files.set(path, readFileSync(join(TREE, path), "utf8"));
    return files.get(path);
  };
  let failed = 0;
  let edited = 0;
  let already = 0;
  for (const [path, from, to, times] of RULES) {
    const text = read(path);
    const found = count(text, from);
    if (found === times) {
      files.set(path, text.split(from).join(to));
      edited++;
    } else if (found === 0 && count(text, to) === times) {
      // A tree that already holds this edit (0010 applied). Every rule's replacement is non-empty — a removal leaves a
      // Kount comment — so "already done" is seen, never inferred from the old text's absence (review round 9).
      already++;
    } else {
      console.error(`BRAND_RESIDUE_FAIL ${path}: expected ${times} of ${JSON.stringify(from.slice(0, 60))}, found ${found}`);
      failed++;
    }
  }
  if (failed) process.exit(1);
  for (const [path, text] of files) writeFileSync(join(TREE, path), text);
  console.log(`BRAND_RESIDUE_OK rules=${RULES.length} edited=${edited} already=${already}`);
  console.log(`PATHS ${[...new Set(RULES.map((r) => r[0]))].join(" ")}`);
}
