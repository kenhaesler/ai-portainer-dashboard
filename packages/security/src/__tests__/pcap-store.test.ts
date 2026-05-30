import { describe, it, expect } from 'vitest';
import { escapeLikePattern } from '../services/pcap-store.js';

describe('escapeLikePattern', () => {
  it('leaves a plain term unchanged', () => {
    expect(escapeLikePattern('web')).toBe('web');
  });

  it('escapes percent so it matches literally', () => {
    expect(escapeLikePattern('100%')).toBe('100\\%');
  });

  it('escapes underscore so it matches literally', () => {
    expect(escapeLikePattern('a_b')).toBe('a\\_b');
  });

  it('escapes backslash itself', () => {
    expect(escapeLikePattern('a\\b')).toBe('a\\\\b');
  });

  it('escapes a combination of metacharacters', () => {
    expect(escapeLikePattern('%_\\')).toBe('\\%\\_\\\\');
  });
});
