// Kount Protect's mark as SVG — the ONE drawing the extension's Kount images come from (plan Decision 5): icons.cjs
// rasterises it into assets/, and brand-residue.mjs writes it into the upstream scripts that drew Bitwarden's shield
// (patch 0010). Copied from apps/kount-protect/src/render/brand.ts (TypeScript in another app). Pure strings: no I/O.
"use strict";

const COLOURS = {
  normal: { navy: "#1b2845", teal: "#0e9287", paper: "#fafaf7" },
  gray: { navy: "#5b6170", teal: "#9aa0a8", paper: "#f2f2f2" },
};

// The badge in the lower right: the shield (signed in), a padlock (locked) or an exclamation mark (an alert — the
// at-risk badge that replaces upstream's "berry").
function badgeOf(badge, teal) {
  if (badge === "locked")
    return (
      '<path d="M710 760v-60a80 80 0 0 1 160 0v60" stroke="#fff" stroke-width="44" fill="none"/>' +
      '<rect x="676" y="750" width="228" height="170" rx="26" fill="#fff"/>' +
      `<circle cx="790" cy="825" r="24" fill="${teal}"/>`
    );
  if (badge === "alert")
    return '<rect x="760" y="640" width="60" height="190" rx="30" fill="#fff"/><circle cx="790" cy="900" r="34" fill="#fff"/>';
  return (
    '<g transform="translate(620 620) scale(1.7)"><path d="M100 28 160 52v52c0 42-26 70-60 86-34-16-60-44-60-86V52z" fill="#fff"/>' +
    `<path d="M100 52 140 68v36c0 28-17 48-40 60-23-12-40-32-40-60V68z" fill="${teal}"/></g>`
  );
}

/** The mark's shapes inside a 1024 x 1024 box. `tile` overrides the tile's attributes (e.g. a themed class). */
function inner({ navy, teal, paper }, badge, tile = `fill="${navy}"`) {
  const badgeFill = badge === "alert" ? "#c8326b" : teal;
  return (
    `<rect width="1024" height="1024" rx="178" ${tile}/>` +
    `<rect x="256" y="179" width="140" height="665" rx="28" fill="${paper}"/>` +
    `<g stroke="${paper}" stroke-width="140" fill="none"><path d="M740 168 330 578"/><path d="M740 855 330 445"/></g>` +
    `<g stroke="${teal}" stroke-width="19" stroke-linecap="round" fill="none"><path d="M815.5 60v96"/><path d="M854 60v96"/><path d="M892 60v96"/><path d="M931 60v96"/><path d="M790 158 947 57"/></g>` +
    `<circle cx="790" cy="790" r="260" fill="${badgeFill}" stroke="${navy}" stroke-width="44"/>` +
    badgeOf(badge, teal)
  );
}

/** The whole mark as one SVG element; `size` adds width and height. */
function drawing(colours, badge, size) {
  const dims = size ? ` width="${size}" height="${size}"` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg"${dims} viewBox="0 0 1024 1024">${inner(colours, badge)}</svg>`;
}

module.exports = { COLOURS, inner, drawing };
