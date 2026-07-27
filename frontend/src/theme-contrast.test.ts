import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Every theme's body text must clear WCAG AA against its own background.
 *
 * `--color-muted-foreground` is the most-used text colour in the app — on
 * /health it lands on 325 elements, more than the primary foreground — and on
 * three of the sixteen themes it sat under the 4.5:1 floor: apple-light
 * (#64748b on #f0f4f8, 4.31:1), catppuccin-latte (4.37:1) and retro-70s
 * (4.26:1). It is also the colour of the 11px/600 sidebar section labels,
 * where AA applies in full.
 *
 * A browser-based scan found only the active theme. This reads the shipped
 * stylesheet and checks all of them, so adding a seventeenth theme with
 * unreadable body text fails here rather than in someone's eyes.
 *
 * Note this is a floor, not a ceiling: it does not claim the palette is
 * accessible overall, only that these two tokens are legible together.
 */

const CSS_PATH = resolve(__dirname, './index.css');
const AA_NORMAL_TEXT = 4.5;

type Rgb = [number, number, number];

function hslToRgb(h: number, s: number, l: number): Rgb {
  const sN = s / 100;
  const lN = l / 100;
  const c = (1 - Math.abs(2 * lN - 1)) * sN;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lN - c / 2;
  const sextant = Math.floor(h / 60) % 6;
  const [r, g, b] = [
    [c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x],
  ][sextant] as Rgb;
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

export function parseColor(raw: string): Rgb | null {
  const value = raw.split('/*')[0].trim().replace(/;$/, '');

  if (value.startsWith('#')) {
    let hex = value.slice(1);
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    if (hex.length !== 6) return null;
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ];
  }

  const hsl = /^hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)$/.exec(value);
  if (hsl) return hslToRgb(Number(hsl[1]), Number(hsl[2]), Number(hsl[3]));

  return null;
}

function relativeLuminance([r, g, b]: Rgb): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

interface ThemeTokens {
  selector: string;
  background: Rgb;
  mutedForeground: Rgb;
}

/** Every block in index.css that declares both a background and a muted foreground. */
function readThemeTokens(): ThemeTokens[] {
  const css = readFileSync(CSS_PATH, 'utf8');
  const blocks = css.split(/\n(?=\s*(?:\.|:root))/);
  const themes: ThemeTokens[] = [];

  for (const block of blocks) {
    const selector = block.trim().split('{')[0].trim();
    const bg = /--color-background:\s*([^;]+);/.exec(block);
    const mf = /--color-muted-foreground:\s*([^;]+);/.exec(block);
    if (!bg || !mf) continue;

    const background = parseColor(bg[1]);
    const mutedForeground = parseColor(mf[1]);
    if (!background || !mutedForeground) continue;

    themes.push({ selector, background, mutedForeground });
  }

  return themes;
}

describe('theme contrast', () => {
  const themes = readThemeTokens();

  it('finds every theme in the stylesheet', () => {
    // Guards the parser itself: a regex that silently matched nothing would
    // make every assertion below vacuous, which is the failure mode this whole
    // file exists to avoid elsewhere.
    expect(themes.length).toBeGreaterThanOrEqual(16);
  });

  it.each(themes.map((t) => [t.selector, t] as const))(
    '%s: muted foreground clears AA against its background',
    (selector, theme) => {
      const ratio = contrastRatio(theme.mutedForeground, theme.background);
      expect(
        Number(ratio.toFixed(2)),
        `${selector} muted-foreground vs background is ${ratio.toFixed(2)}:1, below the ${AA_NORMAL_TEXT}:1 AA floor`,
      ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    },
  );
});

describe('contrast helpers', () => {
  it('computes the canonical black-on-white ratio', () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
  });

  it('computes 1:1 for identical colours', () => {
    expect(contrastRatio([100, 116, 139], [100, 116, 139])).toBeCloseTo(1, 5);
  });

  it('parses hex and hsl to the same rgb', () => {
    expect(parseColor('#ffffff')).toEqual([255, 255, 255]);
    expect(parseColor('hsl(0 0% 100%)')).toEqual([255, 255, 255]);
    expect(parseColor('#fff')).toEqual([255, 255, 255]);
    expect(parseColor('#64748b /* slate-500 */')).toEqual([100, 116, 139]);
  });

  it('rejects colours it cannot parse rather than guessing', () => {
    expect(parseColor('var(--something)')).toBeNull();
    expect(parseColor('oklch(0.5 0.1 200)')).toBeNull();
  });
});
