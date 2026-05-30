import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Smoke tests for the global themed scrollbar declared in `index.css`.
 *
 * jsdom does not honor the CSS-paint pipeline for `scrollbar-width` /
 * `scrollbar-color` / `::-webkit-scrollbar*`, so `getComputedStyle` on a
 * jsdom <body> returns an empty string regardless of what the stylesheet
 * declares. To keep these assertions honest (not just "contains substring"),
 * we read `index.css` from disk and match the precise selector blocks and
 * property values we expect — i.e. if someone renames `.scrollbar-themed`,
 * drops `html`/`body` from the selector list, or changes the foreground-mix
 * percentages, the regex assertions fail loudly.
 */

const indexCssPath = path.resolve(process.cwd(), 'src/index.css');
const css = fs.readFileSync(indexCssPath, 'utf8');

// Strip CSS comments so block-level regexes ignore explanatory prose
// (e.g. comments inside the GLOBAL THEMED SCROLLBAR header that mention
// "scrollbar-width" should not satisfy a structural assertion).
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('global themed scrollbar (frontend/src/index.css)', () => {
  it('declares the GLOBAL THEMED SCROLLBAR comment block as a stable anchor', () => {
    expect(css).toMatch(/GLOBAL THEMED SCROLLBAR/);
  });

  it('applies `scrollbar-width: thin` to html, body, and .scrollbar-themed (Firefox path)', () => {
    // Match the exact selector list followed by an open brace and a
    // scrollbar-width: thin declaration inside the same block.
    const block =
      /html,\s*body,\s*\.scrollbar-themed\s*\{[^}]*scrollbar-width:\s*thin\s*;[^}]*\}/;
    expect(cssNoComments).toMatch(block);
  });

  it('sets scrollbar-color via color-mix on --color-foreground (theme-token driven)', () => {
    const block =
      /html,\s*body,\s*\.scrollbar-themed\s*\{[^}]*scrollbar-color:\s*color-mix\(\s*in\s+srgb\s*,\s*var\(--color-foreground\)\s*25%\s*,\s*transparent\s*\)\s*transparent\s*;[^}]*\}/;
    expect(cssNoComments).toMatch(block);
  });

  it('declares a 10px WebKit scrollbar on html, body, and .scrollbar-themed', () => {
    const block =
      /html::-webkit-scrollbar,\s*body::-webkit-scrollbar,\s*\.scrollbar-themed::-webkit-scrollbar\s*\{[^}]*width:\s*10px\s*;[^}]*height:\s*10px\s*;[^}]*\}/;
    expect(cssNoComments).toMatch(block);
  });

  it('uses pill-shaped thumb (border-radius 9999px) reading --color-foreground at 25%', () => {
    const block =
      /html::-webkit-scrollbar-thumb,\s*body::-webkit-scrollbar-thumb,\s*\.scrollbar-themed::-webkit-scrollbar-thumb\s*\{[^}]*background:\s*color-mix\(\s*in\s+srgb\s*,\s*var\(--color-foreground\)\s*25%\s*,\s*transparent\s*\)\s*;[^}]*border-radius:\s*9999px\s*;[^}]*\}/;
    expect(cssNoComments).toMatch(block);
  });

  it('hover state lifts thumb opacity to 40% foreground-mix', () => {
    const block =
      /html::-webkit-scrollbar-thumb:hover,\s*body::-webkit-scrollbar-thumb:hover,\s*\.scrollbar-themed::-webkit-scrollbar-thumb:hover\s*\{[^}]*background:\s*color-mix\(\s*in\s+srgb\s*,\s*var\(--color-foreground\)\s*40%\s*,\s*transparent\s*\)\s*;[^}]*\}/;
    expect(cssNoComments).toMatch(block);
  });

  it('keeps the `aside nav` hover-reveal block AFTER the global rule (cascade order)', () => {
    const globalIdx = css.indexOf('GLOBAL THEMED SCROLLBAR');
    const asideIdx = css.indexOf('aside nav {');
    expect(globalIdx).toBeGreaterThan(-1);
    expect(asideIdx).toBeGreaterThan(-1);
    // Sidebar block must come later so its same-specificity rule wins.
    expect(asideIdx).toBeGreaterThan(globalIdx);
  });

  it('does not reintroduce the per-theme Apple Light/Dark scrollbar overrides', () => {
    // The per-theme blocks were removed in favor of the global rule. If they
    // come back, the global rule may stop being the single source of truth.
    // Constrain the match to a single CSS block (no `}` between the selector
    // and the nested ::-webkit-scrollbar) so unrelated `.apple-light .X` rules
    // elsewhere in the file don't trigger a false positive.
    expect(cssNoComments).not.toMatch(/\.apple-light\s*\{[^}]*::-webkit-scrollbar/);
    expect(cssNoComments).not.toMatch(/\.apple-dark\s*\{[^}]*::-webkit-scrollbar/);
  });
});
