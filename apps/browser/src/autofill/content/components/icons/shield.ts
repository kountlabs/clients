import { css } from "@emotion/css";
import { html } from "lit";

import { IconProps } from "../common-types";
import { buildIconColorRule, ruleNames, themes } from "../constants/styles";

// Kount: Kount Protect's mark (build/tools/kount-mark.cjs) in place of upstream's shield.
export function Shield({ ariaHidden = true, color, theme }: IconProps) {
  const shapeColor = color || themes[theme].brandLogo;

  return html`
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 1024 1024"
      fill="none"
      aria-hidden="${ariaHidden}"
    >
      <rect width="1024" height="1024" rx="178" class=${css(buildIconColorRule(shapeColor, ruleNames.fill))}/><rect x="256" y="179" width="140" height="665" rx="28" fill="#fafaf7"/><g stroke="#fafaf7" stroke-width="140" fill="none"><path d="M740 168 330 578"/><path d="M740 855 330 445"/></g><g stroke="#0e9287" stroke-width="19" stroke-linecap="round" fill="none"><path d="M815.5 60v96"/><path d="M854 60v96"/><path d="M892 60v96"/><path d="M931 60v96"/><path d="M790 158 947 57"/></g><circle cx="790" cy="790" r="260" fill="#0e9287" stroke="#1b2845" stroke-width="44"/><g transform="translate(620 620) scale(1.7)"><path d="M100 28 160 52v52c0 42-26 70-60 86-34-16-60-44-60-86V52z" fill="#fff"/><path d="M100 52 140 68v36c0 28-17 48-40 60-23-12-40-32-40-60V68z" fill="#0e9287"/></g>
    </svg>
  `;
}
