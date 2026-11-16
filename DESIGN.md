---
name: InvestAtlas
description: Existing investment workspace visual system, extracted from the implementation.
colors:
  accent-blue: "#9dc6ff"
  accent-teal: "#2dd4bf"
  bg-primary: "#0a111a"
  bg-secondary: "#0f1a29"
  text-primary: "#f0f4ff"
  text-secondary: "#cad5e8"
  text-muted: "#94a7c6"
  stock: "#4f8cff"
  etf: "#22c55e"
  crypto: "#f7931a"
  metal: "#facc15"
typography:
  title:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "30px"
    fontWeight: 700
    lineHeight: 1.1
  body:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "16px"
    lineHeight: 1.6
  metadata:
    fontSize: "13px"
    lineHeight: 1.5
  numeric-input:
    fontSize: "16px"
    fontWeight: 700
  mobile-asset:
    fontSize: "20px"
    fontWeight: 700
    lineHeight: 1.25
  mobile-quote:
    fontSize: "32px"
    fontWeight: 800
    lineHeight: 1.15
  label:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "11px"
    fontWeight: 700
    letterSpacing: "0.14em"
rounded:
  sm: "8px"
  md: "12px"
  lg: "18px"
  xl: "26px"
components:
  button-secondary:
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "10px 18px"
---

# Design System: InvestAtlas

## Overview

This captures the existing interface, rather than proposing a new brand. The
authority is `src/app/globals.css` and the rendered application. No new creative
metaphor or brand position has been approved. The current refinement concerns
task completion, chart readability and reliable behavior on narrow screens.

**Key Characteristics:**
- A navy workspace with a separate light theme and blue actions.
- Persistent navigation, compact financial controls and tabular numeric values.
- Explicit asset identity, currency, unit, provider and observation time.

## Colors

The frontmatter records the dark-theme primitives. Theme-aware components use
the matching CSS custom properties, never a second hard-coded palette.
`[data-theme='light']` changes the canvas to `#f8fafc`, primary text to `#0f172a`,
secondary text to `#475569`, muted/faint text to `#526580` and blue to `#3b82f6`.
Stock, ETF, crypto and metal colors identify asset classes. Light-theme status text uses dark green `#08714f`, red `#b4233a` and ochre
`#855a00` so small labels remain readable on tinted surfaces. Positive/negative
values also need signs or words; color alone does not communicate the result.

## Typography

Inter is the primary face with system fallbacks; JetBrains Mono / Fira Code is
available for data and code. Existing page titles are 30px/700 with 1.1 line
height; card labels are 11px/700, uppercase with 0.14em tracking. Financial
values use tabular numerals. Mobile Charts uses explicit 24px page / 20px asset / 32px quote roles, 12–13px metadata and 16px numeric input text; tap targets remain 44px. Actual Chrome/macOS inspection found Inter for Latin and Geeza Pro for Arabic glyphs, so Arabic fallback metrics must be checked separately. Chart prices use locale-aware formatting and
enough precision for small values. Arabic UI follows RTL; market chronology
and isolated numeric axes remain unambiguous. Market dates use Gregorian UTC.

## Layout

The desktop sidebar is 260px (72px collapsed), the header token is 76px and the
content maximum is 1400px. Flex/grid children need `min-width: 0`. Existing
controls wrap on narrow screens. The main asset chart is 500px tall on desktop
and 340px on narrow layouts. Preserve chart space while allowing labels,
range controls and provenance to wrap. Test at 320px, 390px and desktop widths,
including long German labels and Arabic RTL.

## Elevation & Depth

The implementation combines tonal surfaces, subtle borders and soft shadows.
The shadow scale is `0 10px 24px rgba(3,8,20,.24)`,
`0 18px 40px rgba(2,7,18,.32)` and `0 28px 72px rgba(2,7,18,.42)`.
These are observed tokens, not a requirement to elevate every container.
Data panels should remain steady while the user reads or interacts with them.

## Shapes

Use the existing 8/12/18/26px radius scale. Buttons and inputs use 12px;
badges use pills. Dialogs use the shared focus-trapping component. Preserve
recognizable native keyboard and form behavior.

## Components

- Buttons: primary gradient, secondary surface, outline and ghost variants;
  visible keyboard focus and distinct disabled state.
- Inputs/selects: 10px 14px padding, 12px radius, token-based foreground,
  background and borders; labels must remain programmatically associated.
- Sidebar: text plus consistent Lucide icons; active and focus states must be
  distinct. Local Personal mode must describe local usage accurately.
- Asset charts: responsive geometry, finite paths, adaptive price precision,
  range selection, keyboard window controls and honest coverage metadata.
- Quote status: distinguish an available current quote from unavailable
  historical data. Never substitute a synthetic curve for missing history.

## Do's and Don'ts

**Do:**
- Preserve the implemented identity while fixing measured usability defects.
- Verify light/dark, EN/DE/AR, keyboard use and narrow layouts in the browser.
- Keep prices, daily closes and indicative observations visibly distinguishable.

**Don't:**
- Invent provider availability, historical prices, returns or screening results.
- Hide required legal consent, provenance or limitations to simplify a screen.
- Treat a successful build or a clean design detector as a complete UI audit.
