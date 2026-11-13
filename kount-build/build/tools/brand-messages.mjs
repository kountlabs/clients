// The brand rule for the English messages (plan Decision 5), applied to the applied tree's
// apps/browser/src/_locales/en/messages.json in place; then diff-patch.mjs writes the patch. Re-run at a rebase.
//
//   node apps/kount-extension/build/tools/brand-messages.mjs
//
// Every "Bitwarden" in a message or its translator note becomes "Kount Protect", except where it names another
// Bitwarden product or Bitwarden's own site (KEEP below) — those are listed for the T0.3 sort, never silently kept.
// Text only: the file is edited as text so upstream's formatting (and so the patch) stays minimal.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FILE = join(APP, ".build", "clients", "apps", "browser", "src", "_locales", "en", "messages.json");

// Other Bitwarden products and the vendor's own site: the name is the product's, not this extension's.
const KEEP = [/Bitwarden Authenticator/g, /Bitwarden Secrets Manager/g, /Bitwarden Families/g, /Bitwarden for Business/g];
const PLACEHOLDER = (i) => `\u0000KEEP${i}\u0000`;

// Text that offers bitwarden.com for something the person does in their own (the Kount) web vault — the two-step login
// and membership prompts, which open the environment's web vault (T1.1) — and the e-mail placeholder and the self-hosted
// address example on Bitwarden's domain.
const SITE = [
  [/ on the bitwarden\.com web vault\./g, " in the web vault."],
  [/user@bitwarden\.com/g, "user@example.com"],
  [/https:\/\/bitwarden\.company\.com/g, "https://vault.example.com"],
];

const text = readFileSync(FILE, "utf8");
const kept = [];
let changed = 0;
let site = 0;
const out = text
  .split("\n")
  .map((line) => {
    if (/^\s*"message": "/.test(line)) {
      for (const [re, to] of SITE) {
        const next = line.replace(re, to);
        if (next !== line) site++;
        line = next;
      }
    }
    if (!/^\s*"(message|description)": "/.test(line) || !line.includes("Bitwarden")) return line;
    let l = line;
    const held = [];
    KEEP.forEach((re) => {
      l = l.replace(re, (m) => {
        held.push(m);
        return PLACEHOLDER(held.length - 1);
      });
    });
    const before = l;
    l = l.replace(/Bitwarden’s/g, "Kount Protect’s").replace(/Bitwarden/g, "Kount Protect");
    if (l !== before) changed++;
    l = l.replace(/\u0000KEEP(\d+)\u0000/g, (_, i) => held[Number(i)]);
    if (held.length) kept.push(line.trim());
    return l;
  })
  .join("\n");
writeFileSync(FILE, out);
console.log(`BRAND_MESSAGES_OK lines_changed=${changed} site_rewrites=${site} lines_keeping_a_product_name=${kept.length}`);
for (const k of kept) console.log(`KEEP ${k}`);
