import { describe, expect, it } from 'vitest';
import { getDesktopMainPaddingClass } from './app-layout';

describe('getDesktopMainPaddingClass', () => {
  it('uses collapsed-feed spacing for desktop main content', () => {
    expect(getDesktopMainPaddingClass()).toBe('md:pb-12');
  });
});
