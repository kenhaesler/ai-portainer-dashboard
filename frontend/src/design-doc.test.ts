import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { PRODUCT_NAME } from '@/shared/lib/product';

/**
 * DESIGN.md must describe the app that ships (#1647).
 *
 * Four source files defer to DESIGN.md for design decisions, and two critique
 * reports treat it as the design system of record — so a claim in it is read
 * as settled, and a wrong one produces wrong code rather than a puzzled
 * reader. It had never been committed, and the copies floating on individual
 * machines asserted a product name, a hover colour, a font stack, a badge
 * palette and a radius scale that the app does not use.
 *
 * Committing it fixes today's copy. This keeps it fixed. The repo's rule is
 * to record an honesty rule as a test rather than a comment (CLAUDE.md,
 * design-critique invariant 8) — `insight-card.tsx` had twelve lines
 * explaining why its badge must not say "ML" and the rule was lost anyway.
 *
 * Only the CHECKABLE claims are asserted: ones with a single machine-readable
 * source of truth. Prose about visual hierarchy or the 10% accent rule is not
 * testable and is not tested. What is checkable:
 *
 *   • the product name — `PRODUCT_NAME` exists precisely because the product
 *     answered to four names at once, and DESIGN.md was a fifth.
 *   • the radius scale — the app overrides Tailwind's, so quoting Tailwind's
 *     defaults reads as authoritative and is wrong by 12px on every button.
 *   • the font stack — the doc claimed Inter while the app ships no webfont
 *     at all, which is the failure mode a reader cannot detect from the page.
 *
 * Deliberately NOT asserted:
 *   • that DESIGN.md never mentions Inter. It should — under "Considered and
 *     not adopted", which is the honest place for it. Only the frontmatter,
 *     where a value is stated as fact, is held to what ships.
 *   • the contents of the status-colour or elevation tables. They are
 *     calibration, and pinning approximate usage counts to exact numbers
 *     would fail on every unrelated UI change.
 */

const ROOT = resolve(__dirname, '../..');
const DESIGN_MD = readFileSync(resolve(ROOT, 'DESIGN.md'), 'utf-8');
const INDEX_CSS = readFileSync(resolve(__dirname, './index.css'), 'utf-8');

/**
 * The frontmatter block only. The body may legitimately discuss a direction
 * the app has not taken; the frontmatter is a token table, and everything in
 * it reads as shipped.
 */
const frontmatter = /^---\n([\s\S]*?)\n---/.exec(DESIGN_MD)?.[1] ?? '';

describe('DESIGN.md is present and parseable (#1647)', () => {
  it('has frontmatter, so the assertions below are not vacuous', () => {
    // Every check here reads the frontmatter. If the delimiters were dropped
    // or renamed, an empty string would satisfy the "does not claim" checks
    // silently — the same shape as a glob that matches nothing.
    expect(frontmatter.length).toBeGreaterThan(100);
    expect(frontmatter).toMatch(/^name:/m);
  });

  it('is still the file the source comments point at', () => {
    // The original bug was not a wrong claim but a missing file: four sites
    // cited a document that was never committed. If those citations move or
    // the file is renamed, this should be a deliberate edit, not a discovery
    // made by someone following a dead reference.
    const citing = ['features', 'shared']
      .flatMap((dir) => walk(resolve(__dirname, dir)))
      .filter((file) => readFileSync(file, 'utf-8').includes('DESIGN.md'));

    expect(citing.length, 'no source file cites DESIGN.md any more').toBeGreaterThan(0);
  });
});

describe('DESIGN.md names the product the way the code does (#1647)', () => {
  it('uses PRODUCT_NAME verbatim in the frontmatter', () => {
    expect(/^name:\s*(.+)$/m.exec(frontmatter)?.[1]?.trim()).toBe(PRODUCT_NAME);
  });

  it('does not reintroduce a fifth name', () => {
    // What it said before: "Container Insights Dashboard". Any suffix on the
    // real name is the same drift — product.ts's docblock lists the four
    // names that constant was created to collapse.
    const suffixed = new RegExp(`${PRODUCT_NAME} (Dashboard|Platform|App|UI)\\b`);
    expect(
      suffixed.exec(DESIGN_MD)?.[0],
      `DESIGN.md extends the product name; it is exactly "${PRODUCT_NAME}" (see product.ts)`,
    ).toBeUndefined();
  });
});

describe('DESIGN.md quotes this app\'s radius scale, not Tailwind\'s (#1647)', () => {
  // index.css overrides sm/md/lg/xl and leaves 2xl/3xl at Tailwind's defaults,
  // so `rounded-2xl` (16px) is SMALLER than `rounded-lg` (20px). The doc used
  // to say "Buttons: rounded-xl (12px radius)" — Tailwind's default, 12px off
  // what this app renders.
  const OVERRIDDEN = ['sm', 'md', 'lg', 'xl'] as const;

  it.each(OVERRIDDEN)('rounded.%s matches its --radius token in index.css', (key) => {
    const css = new RegExp(`--radius-${key}:\\s*([^;]+);`).exec(INDEX_CSS)?.[1]?.trim();
    const doc = new RegExp(`^\\s+${key}:\\s*"([^"]+)"`, 'm').exec(frontmatter)?.[1]?.trim();

    expect(css, `index.css no longer declares --radius-${key}`).toBeDefined();
    expect(
      doc,
      `DESIGN.md's rounded.${key} is ${doc}, but index.css sets --radius-${key} to ${css}`,
    ).toBe(css);
  });

  it('still warns that the scale is non-monotonic', () => {
    // The trap survives as long as only four of the six steps are overridden.
    // If someone overrides 2xl/3xl too, this can go — but silently dropping
    // the warning while the trap remains is the failure worth catching.
    const overridesAll = ['2xl', '3xl'].every((key) =>
      new RegExp(`--radius-${key}:`).test(INDEX_CSS),
    );
    if (overridesAll) return;

    expect(
      DESIGN_MD,
      'index.css leaves rounded-2xl/3xl at Tailwind defaults, so the scale is not ' +
        'monotonic — DESIGN.md must keep saying so',
    ).toMatch(/not monotonic|non-monotonic/i);
  });
});

describe('DESIGN.md does not claim a webfont the app never loads (#1647)', () => {
  const WEBFONTS = ['Inter', 'JetBrains Mono', 'Fira Code', 'Roboto Mono', 'Source Sans'];

  /** Every way this app could actually ship a face. */
  const shipsAWebfont =
    /@font-face/.test(INDEX_CSS) ||
    /--font-(sans|mono|serif)\s*:/.test(INDEX_CSS) ||
    /fonts\.(googleapis|gstatic)|\.woff2?|<link[^>]+font/i.test(
      readFileSync(resolve(ROOT, 'frontend/index.html'), 'utf-8'),
    );

  it.each(WEBFONTS)('frontmatter does not assert %s while none is loaded', (face) => {
    if (shipsAWebfont) return; // The doc may name whatever the app now ships.

    const fontFamilies = [...frontmatter.matchAll(/fontFamily:\s*"([^"]*)"/g)].map((m) => m[1]);
    expect(fontFamilies.length, 'no fontFamily entries found in frontmatter').toBeGreaterThan(0);

    for (const declared of fontFamilies) {
      expect(
        declared.includes(face),
        `DESIGN.md's frontmatter declares ${face}, but the app loads no webfont: ` +
          'no @font-face, no --font-* token, no font asset or <link>. Either ship it ' +
          '(self-hosted, font-display: swap) or keep the claim under "Considered and ' +
          'not adopted".',
      ).toBe(false);
    }
  });
});

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}
