/**
 * LOBLY design tokens. Single source of truth for the whole client UI —
 * both hosts render the same components, so nothing here may reference
 * Overwolf or Electron APIs.
 */
export const c = {
  // Hextech Noir surfaces — blue-black, never flat black.
  bg: "#05070d",
  bgDeep: "#03050a",
  surface: "#0b111c",
  surfaceAlt: "#101927",
  surfaceHover: "#162235",
  raised: "#172438",
  glass: "rgba(12, 20, 33, 0.78)",
  border: "rgba(126, 164, 201, 0.13)",
  borderStrong: "rgba(109, 210, 255, 0.3)",

  // Text
  text: "#eef7ff",
  textDim: "#9bb0c7",
  textFaint: "#60758d",

  // Brand — electric cyan, astral violet, prestige gold.
  primary: "#42d7ff",
  primaryDim: "#188bb8",
  primarySoft: "rgba(66, 215, 255, 0.12)",
  accent: "#9b7bff",
  accentSoft: "rgba(155, 123, 255, 0.14)",

  // Semantic
  win: "#45e6ae",
  winSoft: "rgba(69, 230, 174, 0.11)",
  loss: "#ff6174",
  lossSoft: "rgba(255, 97, 116, 0.11)",
  warn: "#ffbd66",
  gold: "#e8c56b",
  goldSoft: "rgba(232, 197, 107, 0.12)",
} as const;

/** Riot rank tier colors, used for rank badges and rank text. */
export const TIER_COLORS: Record<string, string> = {
  IRON: "#6b6b6b",
  BRONZE: "#a86b4a",
  SILVER: "#9aa9b8",
  GOLD: "#e2b64b",
  PLATINUM: "#4fc2b3",
  EMERALD: "#2fbd6d",
  DIAMOND: "#5b9cf8",
  MASTER: "#b45cf0",
  GRANDMASTER: "#e5544b",
  CHALLENGER: "#f0c14b",
  UNRANKED: "#65728a",
};

export function tierColor(tier?: string | null): string {
  return TIER_COLORS[(tier ?? "UNRANKED").toUpperCase()] ?? TIER_COLORS.UNRANKED;
}

export const ROLE_LABEL: Record<string, string> = {
  TOP: "Top",
  JUNGLE: "Jungle",
  MIDDLE: "Mid",
  BOTTOM: "Bot",
  UTILITY: "Support",
};

/** Compact inline SVG role glyphs — avoids shipping icon assets. */
export const ROLE_ICON: Record<string, string> = {
  TOP: "M4 20V4h16v4h-2V6H6v12h4v2H4zm6-6h10v6H10v-6zm2 2v2h6v-2h-6z",
  JUNGLE:
    "M12 2c1.5 3 1 5-1 7 3-1 4-3 4-3s1 4-2 7c-1.6 1.6-3 2-3 2v5h-2v-5s-2-.6-3.4-2C4 12 5 8 5 8s1 2 4 3c-2-2-2.5-4-1-7 1 2 2.5 3 4 4 0-2-.5-4 0-6z",
  MIDDLE: "M4 20L20 4h-6V2h8v8h-2V6L4 22v-2z",
  BOTTOM: "M20 4v16H4v-4h2v2h12V6h-2V4h4zM4 4h10v10H4V4zm2 2v6h6V6H6z",
  UTILITY:
    "M12 21s-8-4.5-8-10a5 5 0 019-3 5 5 0 019 3c0 5.5-8 10-8 10z",
};

export const font = {
  sans: '"Segoe UI Variable Display", "Inter", "Segoe UI", system-ui, -apple-system, sans-serif',
  mono: '"Cascadia Code", "JetBrains Mono", ui-monospace, Consolas, monospace',
} as const;

export const radius = { sm: 6, md: 10, lg: 14, xl: 20, xxl: 28, pill: 999 } as const;

export const shadow = {
  sm: "0 4px 12px rgba(0,0,0,0.22)",
  md: "0 14px 38px rgba(0,0,0,0.34)",
  lg: "0 28px 80px rgba(0,0,0,0.5)",
  glow: "0 0 38px rgba(66,215,255,0.12)",
} as const;

export const gradient = {
  brand: `linear-gradient(135deg, ${c.primary} 0%, ${c.accent} 58%, ${c.gold} 130%)`,
  surface: `linear-gradient(145deg, rgba(19,31,50,.96), rgba(8,14,24,.96))`,
  hero: `radial-gradient(circle at 15% 0%, rgba(66,215,255,.18), transparent 36%), radial-gradient(circle at 82% 10%, rgba(155,123,255,.16), transparent 34%), linear-gradient(135deg, #0e1929, #080d17 64%)`,
  gold: `linear-gradient(135deg, #fff0a8, ${c.gold} 52%, #9d6f28)`,
} as const;

/** Global stylesheet — injected once by App. */
export const GLOBAL_CSS = `
  * { box-sizing: border-box; }
  html, body, #root { margin: 0; height: 100%; }
  body {
    background: ${c.bg};
    color: ${c.text};
    font-family: ${font.sans};
    font-size: 13px;
    -webkit-font-smoothing: antialiased;
    text-rendering: geometricPrecision;
    overflow: hidden;
  }
  ::selection { color: #fff; background: rgba(66,215,255,.28); }
  ::-webkit-scrollbar { width: 8px; height: 8px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb {
    background: rgba(96,117,141,.38);
    border-radius: 999px;
    border: 2px solid transparent;
    background-clip: padding-box;
  }
  ::-webkit-scrollbar-thumb:hover { background: rgba(66,215,255,.42); background-clip: padding-box; }
  button { font-family: inherit; cursor: pointer; }
  button:disabled { cursor: not-allowed; opacity: 0.5; }
  input, select, textarea { font-family: inherit; }
  input:focus-visible, button:focus-visible, select:focus-visible {
    outline: 2px solid rgba(66,215,255,.78);
    outline-offset: 2px;
  }
  input::placeholder, textarea::placeholder { color: ${c.textFaint}; }
  select option { background: ${c.surfaceAlt}; color: ${c.text}; }
  @keyframes lobly-spin { to { transform: rotate(360deg); } }
  @keyframes lobly-fade { from { opacity: 0; transform: translateY(7px) scale(.995); } to { opacity: 1; transform: none; } }
  @keyframes lobly-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.45; } }
  @keyframes lobly-glow { 0%,100% { filter: drop-shadow(0 0 8px rgba(66,215,255,.18)); } 50% { filter: drop-shadow(0 0 15px rgba(66,215,255,.44)); } }
  @keyframes lobly-shimmer { from { background-position: 180% 0; } to { background-position: -180% 0; } }
  .lobly-fade { animation: lobly-fade .28s cubic-bezier(.2,.8,.2,1); }
  .lobly-row { transition: background .16s ease, border-color .16s ease, transform .16s ease; }
  .lobly-row:hover { background: ${c.surfaceHover} !important; }
  .lobly-lift { transition: transform .18s ease, border-color .18s ease, box-shadow .18s ease; }
  .lobly-lift:hover { transform: translateY(-2px); border-color: ${c.borderStrong} !important; box-shadow: ${shadow.md}; }
  .lobly-nav-button:hover { color: ${c.text} !important; background: rgba(255,255,255,.035) !important; }
  .lobly-icon-button:hover { color: ${c.text} !important; background: rgba(255,255,255,.075) !important; }
  .lobly-drag { -webkit-app-region: drag; }
  .lobly-no-drag, .lobly-no-drag * { -webkit-app-region: no-drag; }
  .lobly-page-grid {
    background-image:
      linear-gradient(rgba(105,165,213,.022) 1px, transparent 1px),
      linear-gradient(90deg, rgba(105,165,213,.022) 1px, transparent 1px);
    background-size: 36px 36px;
  }
  .lobly-truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  @media (max-width: 1060px) {
    .lobly-page { padding: 18px !important; }
    .lobly-page-header { padding-left: 18px !important; padding-right: 18px !important; }
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; }
  }
`;
