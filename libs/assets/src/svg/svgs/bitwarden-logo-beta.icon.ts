import { svg } from "../svg";

/**
 * Exception: SVGs should not reference color variables directly, but the beta
 * badge is an intentional exception because its gradient colors do not map to existing
 * defined values. Do not follow this pattern for other SVGs.
 */
// Kount: the Kount Protect logo, as in bitwarden-logo.icon.ts, in place of upstream's beta wordmark.
export const BitwardenLogoBeta = svg`
  <svg viewBox="0 0 290 45" xmlns="http://www.w3.org/2000/svg">
    <title>Kount Protect</title>
    <g transform="scale(0.0439)">
      <rect width="1024" height="1024" rx="178" fill="#1b2845"/>
      <rect x="256" y="179" width="140" height="665" rx="28" fill="#fafaf7"/>
      <g stroke="#fafaf7" stroke-width="140" fill="none"><path d="M740 168 330 578"/><path d="M740 855 330 445"/></g>
      <g stroke="#0e9287" stroke-width="19" stroke-linecap="round" fill="none"><path d="M815.5 60v96"/><path d="M854 60v96"/><path d="M892 60v96"/><path d="M931 60v96"/><path d="M790 158 947 57"/></g>
      <circle cx="790" cy="790" r="260" fill="#0e9287" stroke="#1b2845" stroke-width="44"/>
      <g transform="translate(620 620) scale(1.7)"><path d="M100 28 160 52v52c0 42-26 70-60 86-34-16-60-44-60-86V52z" fill="#fff"/><path d="M100 52 140 68v36c0 28-17 48-40 60-23-12-40-32-40-60V68z" fill="#0e9287"/></g>
    </g>
    <text class="tw-fill-marketing-logo" x="56" y="33" font-size="30" font-weight="700" font-family="Inter, Arial, sans-serif">Kount Protect</text>
  </svg>
`;
