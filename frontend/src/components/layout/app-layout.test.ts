import { describe, expect, it } from 'vitest';
import { getDesktopMainPaddingClass } from './app-layout';

describe('getDesktopMainPaddingClass', () => {
  it('returns compact desktop padding when activity feed is collapsed', () => {
    expect(getDesktopMainPaddingClass(true)).toBe('md:pb-20');
  });

  it('returns expanded desktop padding when activity feed is open', () => {
    expect(getDesktopMainPaddingClass(false)).toBe('md:pb-96');
  });
});
