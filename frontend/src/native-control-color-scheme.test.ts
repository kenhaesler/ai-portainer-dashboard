import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Smoke tests for native form-control theming declared in `index.css`.
 *
 * Native controls — a checked `<input type="checkbox">` and the option popup
 * of a native `<select>` — are painted by the browser, not by our CSS tokens.
 * Without a `color-scheme` matching the active theme, a checked checkbox renders
 * as a near-black square (invisible on a dark page) and `<select>` dropdowns show
 * light-scheme popups (white background) under inherited light text → unreadable.
 *
 * jsdom does not run the native-control paint pipeline, so `getComputedStyle`
 * cannot observe `color-scheme` / `accent-color`. Mirroring `themed-scrollbar.test.ts`,
 * we read `index.css` from disk and assert the precise rules: if someone drops a
 * theme class from the scheme lists or removes the accent-color rule, these fail loudly.
 */

const indexCssPath = path.resolve(process.cwd(), 'src/index.css');
const css = fs.readFileSync(indexCssPath, 'utf8');
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');

// Authoritative light/dark split mirrors `resolvedTheme()` in stores/theme-store.ts.
// `light` / `dark` are the classes applied for the System theme.
const DARK_THEME_CLASSES = [
  '.dark',
  '.apple-dark',
  '.obsidian-ink',
  '.forest-night',
  '.hyperpop-chaos',
  '.retro-arcade',
  '.retro-terminal',
  '.retro-vaporwave',
  '.catppuccin-frappe',
  '.catppuccin-macchiato',
  '.catppuccin-mocha',
];

const LIGHT_THEME_CLASSES = [
  '.light',
  '.apple-light',
  '.nordic-frost',
  '.sandstone-dusk',
  '.retro-70s',
  '.catppuccin-latte',
];

// Hardcoded (not built from a variable) to avoid dynamic-RegExp ReDoS lint.
const COLOR_SCHEME_RULE = {
  dark: /([^{}]+)\{\s*color-scheme:\s*dark\s*;\s*\}/,
  light: /([^{}]+)\{\s*color-scheme:\s*light\s*;\s*\}/,
} as const;

/** Capture the selector list of the rule whose body is exactly `color-scheme: <scheme>;`. */
function selectorsForColorScheme(scheme: 'dark' | 'light'): string {
  const rule = cssNoComments.match(COLOR_SCHEME_RULE[scheme]);
  expect(rule, `expected a \`color-scheme: ${scheme}\` rule in index.css`).not.toBeNull();
  return rule![1];
}

describe('native control color-scheme (frontend/src/index.css)', () => {
  it('puts every dark theme class in a `color-scheme: dark` rule', () => {
    const selectors = selectorsForColorScheme('dark');
    for (const cls of DARK_THEME_CLASSES) {
      expect(selectors, `${cls} must opt into color-scheme: dark`).toContain(cls);
    }
  });

  it('puts every light theme class in a `color-scheme: light` rule', () => {
    const selectors = selectorsForColorScheme('light');
    for (const cls of LIGHT_THEME_CLASSES) {
      expect(selectors, `${cls} must opt into color-scheme: light`).toContain(cls);
    }
  });

  it('does not place any dark theme class in the light scheme rule (and vice versa)', () => {
    const darkSelectors = selectorsForColorScheme('dark');
    const lightSelectors = selectorsForColorScheme('light');
    for (const cls of LIGHT_THEME_CLASSES) {
      expect(darkSelectors).not.toContain(`${cls},`);
    }
    for (const cls of DARK_THEME_CLASSES) {
      expect(lightSelectors).not.toContain(`${cls},`);
    }
  });

  it('themes native checkbox & radio fills with the primary token via accent-color', () => {
    const rule =
      /input\[type=['"]checkbox['"]\]\s*,\s*input\[type=['"]radio['"]\]\s*\{[^}]*accent-color:\s*var\(--color-primary\)\s*;[^}]*\}/;
    expect(cssNoComments).toMatch(rule);
  });
});
