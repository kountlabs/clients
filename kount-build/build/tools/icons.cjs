// Draw every image assets/ replaces (assets/MANIFEST names each one, with why): the extension's icons from Kount
// Protect's mark (kount-mark.cjs) at every size the manifests and the app name, with the grey (signed out), locked and
// alert variants; and the illustrations and store badges upstream drew with Bitwarden's shield or wordmark (plan T3.8;
// Safari's toolbar icons and two wordmark pictures are left out of the build by patch 0003 instead — a path with `@` is
// not one apply.sh accepts). Run inside the digest-pinned Playwright container (Chromium rasterises):
//
//   docker run --rm --name kext-icons --user 1000:1000 -e HOME=/tmp \
//     -v <app>/.build/pw:/pw:ro -v <app>/build/tools:/tools:ro -v <app>/assets:/assets \
//     mcr.microsoft.com/playwright@sha256:2f05… node /tools/icons.cjs
//
// Writes PNGs under /assets/apps/browser/src/images/.
"use strict";

const { mkdirSync } = require("node:fs");
const { dirname, join } = require("node:path");

const { chromium } = require("/pw/node_modules/playwright");
const { COLOURS, drawing } = require("./kount-mark.cjs");

const icon = (name, size, colours, badge) => ({ name, width: size, height: size, html: markPage(drawing(COLOURS[colours], badge), size) });

function markPage(svg, size) {
  return `<html><body style="margin:0;background:transparent"><img width="${size}" height="${size}" src="data:image/svg+xml,${encodeURIComponent(svg)}"></body></html>`;
}

const mark = (size) =>
  `<img width="${size}" height="${size}" src="data:image/svg+xml,${encodeURIComponent(drawing(COLOURS.normal, "shield"))}">`;

// The two themes of the illustrations, from upstream's light and dark pictures.
const THEMES = {
  light: { page: "#f1f4f9", card: "#ffffff", line: "#cdd3dc", bar: "#5b6b8c", text: "#1b2845", accent: "#175ddc", pill: "#dbe5f6", glow: "linear-gradient(135deg,#1b4fbf,#0b2a73)" },
  dark: { page: "#1b2433", card: "#273246", line: "#3d4a60", bar: "#8d9ab3", text: "#eef1f6", accent: "#6ea2ff", pill: "#2b3f63", glow: "linear-gradient(135deg,#13254a,#060d1f)" },
};

const SANS = "font-family:'DejaVu Sans','Liberation Sans',Arial,sans-serif";

// "Use generated password": a field with the Kount mark where upstream drew the shield, and the suggestion beneath.
function generatePassword(t) {
  return `<body style="margin:0;width:864px;height:573px;${SANS}"><div style="position:absolute;inset:0;background:${t.page};border-radius:28px">
<div style="position:absolute;left:48px;top:48px;width:525px;height:24px;border-radius:12px;background:${t.bar}"></div>
<div style="position:absolute;left:48px;top:145px;width:750px;height:80px;border:3px solid ${t.accent};border-radius:10px;background:${t.card}">
<div style="position:absolute;left:18px;top:18px;width:3px;height:44px;background:${t.text}"></div>
<div style="position:absolute;right:16px;top:14px">${mark(52)}</div></div>
<div style="position:absolute;left:48px;top:236px;width:756px;height:176px;border:2px solid ${t.line};border-radius:12px;background:${t.card}">
<svg style="position:absolute;left:34px;top:52px" width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="${t.accent}" stroke-width="2" stroke-linecap="round"><circle cx="16" cy="8" r="5"/><path d="M12.5 11.5 3 21m3-3 2 2m1-5 2 2"/></svg>
<div style="position:absolute;left:138px;top:42px;font-size:40px;color:${t.text}">Use generated password</div>
<div style="position:absolute;left:138px;top:100px;font-size:34px;color:${t.text};font-family:'DejaVu Sans Mono',monospace">f9#WxF4HjsC&amp;*6</div>
</div></div></body>`;
}

// "Update existing login?": the browser's bar with the Kount mark as the extension's button, and the save prompt.
function updateLogin(t) {
  return `<body style="margin:0;width:864px;height:573px;${SANS}"><div style="position:absolute;inset:0;background:${t.page};border-radius:28px;overflow:hidden">
<div style="position:absolute;left:0;top:0;width:864px;height:140px;background:${t.card}"></div>
<div style="position:absolute;left:0;top:42px;width:640px;height:80px;border-radius:0 40px 40px 0;background:${t.line}"></div>
<div style="position:absolute;left:668px;top:46px">${mark(72)}</div>
<div style="position:absolute;left:768px;top:46px;width:68px;height:68px;border-radius:50%;border:4px solid ${t.bar}"></div>
<div style="position:absolute;left:180px;top:180px;width:640px;height:330px;border:2px solid ${t.line};border-radius:14px;background:${t.card}">
<div style="position:absolute;left:30px;top:26px">${mark(48)}</div>
<div style="position:absolute;left:96px;top:28px;font-size:36px;font-weight:700;color:${t.text}">Update existing login?</div>
<div style="position:absolute;left:0;top:100px;width:640px;height:2px;background:${t.line}"></div>
<div style="position:absolute;left:28px;top:124px;width:584px;height:90px;border-radius:12px;background:${t.page}">
<div style="position:absolute;left:22px;top:22px;width:46px;height:46px;border-radius:50%;background:${t.bar}"></div>
<div style="position:absolute;left:92px;top:26px;width:92px;height:16px;border-radius:8px;background:${t.line}"></div>
<div style="position:absolute;left:92px;top:54px;width:186px;height:12px;border-radius:6px;background:${t.line}"></div>
<div style="position:absolute;right:20px;top:20px;padding:10px 22px;border:2px solid ${t.accent};border-radius:26px;background:${t.pill};font-size:24px;color:${t.accent}">Update login</div></div>
<div style="position:absolute;left:28px;top:234px;width:584px;height:70px;border-radius:12px;background:${t.page}">
<div style="position:absolute;left:24px;top:18px;font-size:28px;font-weight:700;color:${t.accent}">Save as new login</div></div>
</div></div></body>`;
}

// What changed in the extension: Kount Protect's mark and name on the brand's colours, in place of upstream's
// screenshots of Bitwarden's interface.
function newExperience(t) {
  return `<body style="margin:0;width:864px;height:488px;${SANS}"><div style="position:absolute;inset:0;background:${t.glow}">
<div style="position:absolute;left:192px;top:94px;width:480px;height:300px;border-radius:24px;background:${t.card};box-shadow:0 12px 40px rgba(0,0,0,.25)">
<div style="position:absolute;left:180px;top:40px">${mark(120)}</div>
<div style="position:absolute;left:0;top:184px;width:480px;text-align:center;font-size:40px;font-weight:700;color:${t.text}">Kount Protect</div>
<div style="position:absolute;left:0;top:240px;width:480px;text-align:center;font-size:22px;color:${t.bar}">Your logins, filled for you</div>
</div></div></body>`;
}

// A transparent picture of the original's size: the "Download … apps" page that showed these is unlinked (patch 0010),
// and its pictures were Apple's and Google's store badges and a code that led to Bitwarden's apps.
const blank = (name, width, height) => ({ name, width, height, html: `<html><body style="margin:0;background:transparent"></body></html>` });

const page = (name, width, height, html) => ({ name, width, height, html });

const IMAGES = [
  ...[16, 19, 32, 38, 48, 96, 128].map((s) => icon(`icon${s}.png`, s, "normal", "shield")),
  ...[16, 19, 32, 38, 48, 96, 128].map((s) => icon(`icon${s}_gray.png`, s, "gray", "shield")),
  ...[19, 38].map((s) => icon(`icon${s}_locked.png`, s, "normal", "locked")),
  // The at-risk badge (upstream's "berry": the shield with a dot) — the mark with an alert badge.
  icon("berry19.png", 19, "normal", "alert"),
  icon("berry38.png", 38, "normal", "alert"),
  blank("app-store.png", 200, 60),
  blank("google-play.png", 200, 59),
  blank("download-qr.png", 200, 200),
  page("new-experience/new-experience.light.png", 864, 488, newExperience(THEMES.light)),
  page("new-experience/new-experience.dark.png", 864, 488, newExperience(THEMES.dark)),
  page("at-risk-password-carousel/generate_password.light.png", 864, 573, generatePassword(THEMES.light)),
  page("at-risk-password-carousel/generate_password.dark.png", 864, 573, generatePassword(THEMES.dark)),
  page("at-risk-password-carousel/update_login.light.png", 864, 573, updateLogin(THEMES.light)),
  page("at-risk-password-carousel/update_login.dark.png", 864, 573, updateLogin(THEMES.dark)),
];

(async () => {
  const out = "/assets/apps/browser/src/images";
  const browser = await chromium.launch({ headless: true });
  const tab = await browser.newPage();
  for (const img of IMAGES) {
    mkdirSync(dirname(join(out, img.name)), { recursive: true });
    await tab.setViewportSize({ width: img.width, height: img.height });
    await tab.setContent(img.html);
    await tab.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
    await tab.screenshot({ path: join(out, img.name), omitBackground: true, clip: { x: 0, y: 0, width: img.width, height: img.height } });
    console.log(`IMAGE apps/browser/src/images/${img.name} ${img.width}x${img.height}`);
  }
  await browser.close();
  console.log(`ICONS_OK ${IMAGES.length}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
