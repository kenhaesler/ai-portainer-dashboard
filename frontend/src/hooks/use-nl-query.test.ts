import { describe, it, expect } from 'vitest';

// Test the isNaturalLanguageQuery heuristic directly
// Since it's not exported, we replicate it here for unit testing
function isNaturalLanguageQuery(input: string): boolean {
  const trimmed = input.trim().toLowerCase();
  if (trimmed.length < 5) return false;
  if (/^(what|which|how|show|list|find|are|is|why|where|who|when|compare|help|tell)\b/.test(trimmed)) return true;
  if (trimmed.endsWith('?')) return true;
  if (/\b(using more than|greater than|less than|running|stopped|restarted|unhealthy|memory|cpu)\b/.test(trimmed)) return true;
  return false;
}

describe('isNaturalLanguageQuery', () => {
  it('detects question words', () => {
    expect(isNaturalLanguageQuery('what containers are running')).toBe(true);
    expect(isNaturalLanguageQuery('which services are unhealthy')).toBe(true);
    expect(isNaturalLanguageQuery('how many containers are there')).toBe(true);
    expect(isNaturalLanguageQuery('show me running containers')).toBe(true);
    expect(isNaturalLanguageQuery('list all stacks')).toBe(true);
    expect(isNaturalLanguageQuery('find nginx containers')).toBe(true);
    expect(isNaturalLanguageQuery('compare nginx and redis')).toBe(true);
  });

  it('detects question marks', () => {
    expect(isNaturalLanguageQuery('containers running?')).toBe(true);
    expect(isNaturalLanguageQuery('is nginx healthy?')).toBe(true);
  });

  it('detects infrastructure keywords', () => {
    expect(isNaturalLanguageQuery('containers using more than 80% memory')).toBe(true);
    expect(isNaturalLanguageQuery('containers that restarted')).toBe(true);
    expect(isNaturalLanguageQuery('show unhealthy services')).toBe(true);
  });

  it('returns false for short inputs', () => {
    expect(isNaturalLanguageQuery('ng')).toBe(false);
    expect(isNaturalLanguageQuery('web')).toBe(false);
  });

  it('returns false for simple name searches', () => {
    expect(isNaturalLanguageQuery('nginx')).toBe(false);
    expect(isNaturalLanguageQuery('redis-cache')).toBe(false);
    expect(isNaturalLanguageQuery('my-stack-prod')).toBe(false);
  });
});
