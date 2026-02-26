import { describe, it, expect } from 'vitest';
import {
  ICON_SETS,
  ICON_SET_MAP,
  iconSetOptions,
  buildFaviconSvg,
  type AppIconId,
} from './icon-sets';

describe('ICON_SETS registry', () => {
  it('contains exactly 10 icons', () => {
    expect(ICON_SETS).toHaveLength(10);
  });

  it('each icon has required fields', () => {
    for (const icon of ICON_SETS) {
      expect(icon.id).toBeTruthy();
      expect(icon.label).toBeTruthy();
      expect(icon.description).toBeTruthy();
      expect(icon.viewBox).toBe('0 0 64 64');
      expect(icon.paths.length).toBeGreaterThan(0);
    }
  });

  it('has unique IDs', () => {
    const ids = ICON_SETS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('each path has a valid d attribute', () => {
    for (const icon of ICON_SETS) {
      for (const path of icon.paths) {
        expect(path.d).toBeTruthy();
        expect(typeof path.d).toBe('string');
      }
    }
  });
});

describe('ICON_SET_MAP', () => {
  it('maps all icon IDs', () => {
    for (const icon of ICON_SETS) {
      expect(ICON_SET_MAP[icon.id]).toBe(icon);
    }
  });

  it('returns undefined for unknown ID', () => {
    expect(ICON_SET_MAP['nonexistent' as AppIconId]).toBeUndefined();
  });
});

describe('iconSetOptions', () => {
  it('has same length as ICON_SETS', () => {
    expect(iconSetOptions).toHaveLength(ICON_SETS.length);
  });

  it('each option has value, label, description', () => {
    for (const opt of iconSetOptions) {
      expect(opt.value).toBeTruthy();
      expect(opt.label).toBeTruthy();
      expect(opt.description).toBeTruthy();
    }
  });
});

describe('buildFaviconSvg', () => {
  it('returns valid SVG string for brain icon', () => {
    const svg = buildFaviconSvg('brain');
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
    expect(svg).toContain('viewBox="0 0 64 64"');
    expect(svg).toContain('<rect');
    expect(svg).toContain('fill="url(#bg)"');
  });

  it('replaces currentColor with #fff', () => {
    const svg = buildFaviconSvg('brain');
    expect(svg).not.toContain('currentColor');
    expect(svg).toContain('#fff');
  });

  it('includes gradient background', () => {
    const svg = buildFaviconSvg('neural-net');
    expect(svg).toContain('linearGradient');
    expect(svg).toContain('#3b82f6');
    expect(svg).toContain('#22c55e');
  });

  it('returns empty string for unknown icon', () => {
    expect(buildFaviconSvg('nonexistent' as AppIconId)).toBe('');
  });

  it('generates valid SVG for all 10 icons', () => {
    for (const icon of ICON_SETS) {
      const svg = buildFaviconSvg(icon.id);
      expect(svg).toContain('<svg');
      expect(svg).toContain('</svg>');
      expect(svg).not.toContain('currentColor');
    }
  });
});
