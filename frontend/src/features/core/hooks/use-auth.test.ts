import { describe, it, expect } from 'vitest';
import { useAuth as featureUseAuth } from './use-auth';
import { useAuth as providerUseAuth } from '@/providers/auth-provider';

describe('useAuth (feature re-export)', () => {
  it('re-exports the same hook from auth-provider', () => {
    // The feature-level hook is documented as a duplicate of the provider hook;
    // assert it is a literal re-export so behaviour cannot drift.
    expect(featureUseAuth).toBe(providerUseAuth);
  });

  it('throws when used outside AuthProvider', () => {
    // The provider hook throws if no AuthContext is available; calling the
    // re-exported hook outside React renders surfaces that contract directly.
    expect(() => featureUseAuth()).toThrow();
  });
});
