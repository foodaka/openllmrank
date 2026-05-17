// Editorial design tokens. Mirrors the inline CSS variables in
// packages/cli/src/core/render-html.ts so the report email, the marketing
// page, and the wizard all use the same palette and typography. If you
// change a value here, update render-html.ts (and DESIGN.md when that
// lands).

export const colors = {
  paper: "#fbf8f0",   // warm off-white page background
  ink: "#241f19",     // body text (deep coffee, not pure black)
  muted: "#756c60",   // secondary text, meta info
  line: "#e3d8c6",    // hairline dividers, table borders
  soft: "#f2eadc",    // form-field bg, sample-data panels
  accent: "#376b5b",  // moss green — CTAs, links, kicker labels
  accent2: "#b86b2b", // terra cotta — emphasis, competitor highlights
  win: "#476f53",     // success states
  loss: "#9f3a21",    // error states, refund states
} as const;

export const fonts = {
  display: 'Georgia, "Times New Roman", serif',
  body: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
} as const;

export const radii = {
  none: "0",
  sm: "3px",
  md: "7px",
  pill: "999px",
} as const;

export const spacing = {
  // Editorial pacing — generous whitespace, integer-multiples of 4
  xs: "4px",
  sm: "8px",
  md: "16px",
  lg: "28px",
  xl: "48px",
  xxl: "96px",
} as const;

export const breakpoints = {
  mobile: "375px",
  tablet: "768px",
  desktop: "1024px",
} as const;

export type ColorToken = keyof typeof colors;
export type FontToken = keyof typeof fonts;
