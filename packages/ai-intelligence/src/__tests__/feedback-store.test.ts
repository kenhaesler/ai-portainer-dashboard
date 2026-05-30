import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  checkFeedbackRateLimit,
  isValidFeature,
  getValidFeatures,
} from '../services/feedback-store.js';

// We only test pure utility functions here; DB-dependent functions
// are tested via the route-level integration tests.

describe('feedback-store utilities', () => {
  describe('checkFeedbackRateLimit', () => {
    beforeEach(() => {
      // Reset the internal state by using a unique user for each test
    });

    it('allows submissions under the rate limit', () => {
      const userId = `rate-test-${Date.now()}-1`;
      for (let i = 0; i < 10; i++) {
        expect(checkFeedbackRateLimit(userId)).toBe(true);
      }
    });

    it('blocks submissions over the rate limit', () => {
      const userId = `rate-test-${Date.now()}-2`;
      // First 10 should succeed
      for (let i = 0; i < 10; i++) {
        checkFeedbackRateLimit(userId);
      }
      // 11th should be blocked
      expect(checkFeedbackRateLimit(userId)).toBe(false);
    });

    it('allows different users independently', () => {
      const userId1 = `rate-test-${Date.now()}-3`;
      const userId2 = `rate-test-${Date.now()}-4`;

      // Fill up user1's limit
      for (let i = 0; i < 10; i++) {
        checkFeedbackRateLimit(userId1);
      }
      expect(checkFeedbackRateLimit(userId1)).toBe(false);

      // User2 should still be allowed
      expect(checkFeedbackRateLimit(userId2)).toBe(true);
    });
  });

  describe('isValidFeature', () => {
    it('returns true for valid features', () => {
      expect(isValidFeature('chat_assistant')).toBe(true);
      expect(isValidFeature('anomaly_explainer')).toBe(true);
      expect(isValidFeature('root_cause')).toBe(true);
      expect(isValidFeature('pcap_analyzer')).toBe(true);
    });

    it('returns false for invalid features', () => {
      expect(isValidFeature('invalid_feature')).toBe(false);
      expect(isValidFeature('')).toBe(false);
      expect(isValidFeature('CHAT_ASSISTANT')).toBe(false);
    });
  });

  describe('getValidFeatures', () => {
    it('returns an array of feature keys', () => {
      const features = getValidFeatures();
      expect(features.length).toBeGreaterThan(0);
      expect(features).toContain('chat_assistant');
      expect(features).toContain('anomaly_explainer');
      expect(features).toContain('correlation_insights');
    });
  });
});
