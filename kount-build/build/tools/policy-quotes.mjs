// Pull quotable sentences out of a saved store-policy page (plan T0.8): the page's text, split into sentences, those
// matching any of the given patterns (case-insensitive), at most 4 per pattern. The page is data: read, never run.
//
//   node apps/kount-extension/build/tools/policy-quotes.mjs <saved page> <pattern>...
import { readFileSync } from "node:fs";

const [file, ...patterns] = process.argv.slice(2);
const html = readFileSync(file, "utf8");
const text = html
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<(br|\/p|\/li|\/h\d|\/td|\/tr|\/div)[^>]*>/gi, ". ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ")
  .replace(/&amp;/g, "&")
  .replace(/&#39;|&rsquo;|&#x27;/g, "'")
  .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
  .replace(/\s+/g, " ");
const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z0-9"(])/).map((s) => s.trim()).filter((s) => s.length > 20 && s.length < 600);
for (const p of patterns) {
  const re = new RegExp(p, "i");
  const hits = [...new Set(sentences.filter((s) => re.test(s)))].slice(0, 4);
  console.log(`== /${p}/ ${hits.length ? "" : "(no match)"}`);
  for (const h of hits) console.log(`  "${h.replace(/^\.\s*/, "")}"`);
}
