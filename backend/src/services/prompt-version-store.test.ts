import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDbQuery = vi.fn();
const mockDbQueryOne = vi.fn();
const mockDbExecute = vi.fn().mockResolvedValue(undefined);

vi.mock('../db/app-db-router.js', () => ({
  getDbForDomain: () => ({
    query: (...args: unknown[]) => mockDbQuery(...args),
    queryOne: (...args: unknown[]) => mockDbQueryOne(...args),
    execute: (...args: unknown[]) => mockDbExecute(...args),
  }),
}));

const mockGetSetting = vi.fn();
vi.mock('./settings-store.js', () => ({
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
}));

vi.mock('../utils/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  createPromptVersion,
  getPromptHistory,
  getPromptVersionById,
  getPromptVersionCount,
  MAX_VERSIONS_PER_FEATURE,
} from './prompt-version-store.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRow(overrides: Partial<{
  id: number; feature: string; version: number; system_prompt: string;
  model: string | null; temperature: string | null; changed_by: string;
  changed_at: string; change_note: string | null;
}> = {}) {
  return {
    id: 1,
    feature: 'chat_assistant',
    version: 1,
    system_prompt: 'You are a helpful assistant.',
    model: null,
    temperature: null,
    changed_by: 'admin',
    changed_at: '2026-01-01T00:00:00.000Z',
    change_note: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('prompt-version-store', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default: no existing model/temperature overrides
    mockGetSetting.mockResolvedValue(null);
    // Default: insert returns one row
    mockDbQuery.mockResolvedValue([makeRow()]);
    mockDbExecute.mockResolvedValue(undefined);
  });

  // ── createPromptVersion ─────────────────────────────────────────────

  describe('createPromptVersion', () => {
    it('inserts a new version row and returns mapped PromptVersion', async () => {
      mockDbQuery.mockResolvedValueOnce([makeRow({ id: 5, version: 1, system_prompt: 'You are helpful.' })]);

      const result = await createPromptVersion('chat_assistant', 'You are helpful.', 'admin');

      expect(result.id).toBe(5);
      expect(result.version).toBe(1);
      expect(result.systemPrompt).toBe('You are helpful.');
      expect(result.changedBy).toBe('admin');
      expect(result.model).toBeNull();
      expect(result.temperature).toBeNull();
    });

    it('computes version atomically via SQL subquery', async () => {
      mockDbQuery.mockResolvedValueOnce([makeRow({ version: 4 })]);

      const result = await createPromptVersion('chat_assistant', 'Prompt v4', 'admin');

      expect(result.version).toBe(4);
      // Verify the INSERT SQL uses an atomic subquery for the version number
      const insertCall = mockDbQuery.mock.calls[0];
      expect(insertCall[0]).toContain('SELECT COALESCE(MAX(version), 0) + 1');
      // Feature appears twice in params: once for INSERT value, once for subquery WHERE
      expect(insertCall[1][0]).toBe('chat_assistant');
      expect(insertCall[1][1]).toBe('chat_assistant');
    });

    it('reads model/temperature from settings at creation time', async () => {
      mockGetSetting
        .mockResolvedValueOnce({ value: 'llama3.2:8b' })   // model
        .mockResolvedValueOnce({ value: '0.3' });            // temperature
      mockDbQuery.mockResolvedValueOnce([
        makeRow({ model: 'llama3.2:8b', temperature: '0.3' }),
      ]);

      const result = await createPromptVersion('anomaly_explainer', 'Explain this.', 'admin');

      expect(result.model).toBe('llama3.2:8b');
      expect(result.temperature).toBe(0.3);
    });

    it('stores null model/temperature when settings have no overrides', async () => {
      mockDbQuery.mockResolvedValueOnce([makeRow({ model: null, temperature: null })]);

      const result = await createPromptVersion('log_analyzer', 'Analyze logs.', 'admin');

      expect(result.model).toBeNull();
      expect(result.temperature).toBeNull();
    });

    it('stores the optional changeNote', async () => {
      mockDbQuery.mockResolvedValueOnce([makeRow({ change_note: 'Rollback to v2' })]);

      const result = await createPromptVersion('chat_assistant', 'Old prompt.', 'admin', {
        changeNote: 'Rollback to v2',
      });

      expect(result.changeNote).toBe('Rollback to v2');
    });

    it('converts temperature string from DB to number', async () => {
      mockDbQuery.mockResolvedValueOnce([makeRow({ temperature: '0.75' })]);

      const result = await createPromptVersion('chat_assistant', 'Test', 'admin');

      expect(result.temperature).toBe(0.75);
      expect(typeof result.temperature).toBe('number');
    });

    it('triggers pruning after insert (non-blocking)', async () => {
      mockDbQuery.mockResolvedValueOnce([makeRow()]);

      await createPromptVersion('chat_assistant', 'Test', 'admin');

      // pruneOldVersions calls db.execute — verify it was scheduled
      // (it's async fire-and-forget so may not have completed yet,
      // but execute should eventually be called)
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(mockDbExecute).toHaveBeenCalled();
    });
  });

  // ── getPromptHistory ────────────────────────────────────────────────

  describe('getPromptHistory', () => {
    it('returns empty array when no versions exist', async () => {
      mockDbQuery.mockResolvedValueOnce([]);

      const result = await getPromptHistory('chat_assistant');

      expect(result).toEqual([]);
    });

    it('returns versions in descending order (most recent first)', async () => {
      const rows = [
        makeRow({ id: 3, version: 3, changed_by: 'admin', change_note: 'Improved tone' }),
        makeRow({ id: 2, version: 2, changed_by: 'jsmith' }),
        makeRow({ id: 1, version: 1, changed_by: 'system' }),
      ];
      mockDbQuery.mockResolvedValueOnce(rows);

      const result = await getPromptHistory('chat_assistant');

      expect(result).toHaveLength(3);
      expect(result[0].version).toBe(3);
      expect(result[1].version).toBe(2);
      expect(result[2].version).toBe(1);
    });

    it('maps all fields correctly', async () => {
      mockDbQuery.mockResolvedValueOnce([
        makeRow({
          id: 7,
          feature: 'anomaly_explainer',
          version: 2,
          system_prompt: 'Be concise.',
          model: 'llama3.2',
          temperature: '0.5',
          changed_by: 'alice',
          changed_at: '2026-02-01T10:00:00.000Z',
          change_note: 'More concise',
        }),
      ]);

      const [v] = await getPromptHistory('anomaly_explainer');

      expect(v.id).toBe(7);
      expect(v.feature).toBe('anomaly_explainer');
      expect(v.version).toBe(2);
      expect(v.systemPrompt).toBe('Be concise.');
      expect(v.model).toBe('llama3.2');
      expect(v.temperature).toBe(0.5);
      expect(v.changedBy).toBe('alice');
      expect(v.changeNote).toBe('More concise');
    });

    it('uses default limit of 50', async () => {
      mockDbQuery.mockResolvedValueOnce([]);

      await getPromptHistory('chat_assistant');

      const queryCall = mockDbQuery.mock.calls[0];
      expect(queryCall[1]).toContain(50);
    });

    it('accepts a custom limit', async () => {
      mockDbQuery.mockResolvedValueOnce([]);

      await getPromptHistory('chat_assistant', 10);

      const queryCall = mockDbQuery.mock.calls[0];
      expect(queryCall[1]).toContain(10);
    });
  });

  // ── getPromptVersionById ────────────────────────────────────────────

  describe('getPromptVersionById', () => {
    it('returns null when version not found', async () => {
      mockDbQueryOne.mockResolvedValueOnce(null);

      const result = await getPromptVersionById(999, 'chat_assistant');

      expect(result).toBeNull();
    });

    it('returns the version when found', async () => {
      mockDbQueryOne.mockResolvedValueOnce(makeRow({ id: 3, version: 3 }));

      const result = await getPromptVersionById(3, 'chat_assistant');

      expect(result).not.toBeNull();
      expect(result!.id).toBe(3);
      expect(result!.version).toBe(3);
    });

    it('scopes query to the given feature (safety)', async () => {
      mockDbQueryOne.mockResolvedValueOnce(null);

      await getPromptVersionById(1, 'anomaly_explainer');

      const call = mockDbQueryOne.mock.calls[0];
      expect(call[1]).toContain('anomaly_explainer');
    });
  });

  // ── getPromptVersionCount ───────────────────────────────────────────

  describe('getPromptVersionCount', () => {
    it('returns 0 when no versions exist', async () => {
      mockDbQueryOne.mockResolvedValueOnce({ cnt: '0' });

      const count = await getPromptVersionCount('chat_assistant');

      expect(count).toBe(0);
    });

    it('returns the correct count', async () => {
      mockDbQueryOne.mockResolvedValueOnce({ cnt: '12' });

      const count = await getPromptVersionCount('chat_assistant');

      expect(count).toBe(12);
    });
  });

  // ── auto-pruning ────────────────────────────────────────────────────

  describe('auto-pruning logic', () => {
    it(`MAX_VERSIONS_PER_FEATURE is ${MAX_VERSIONS_PER_FEATURE}`, () => {
      expect(MAX_VERSIONS_PER_FEATURE).toBe(50);
    });

    it('pruning DELETE query always keeps version > 1 rows and limits to MAX-1', async () => {
      mockDbQuery.mockResolvedValueOnce([makeRow()]);

      await createPromptVersion('chat_assistant', 'Prompt', 'admin');
      await new Promise((resolve) => setTimeout(resolve, 10));

      const deleteCall = mockDbExecute.mock.calls[0];
      const sql = deleteCall[0] as string;
      const params = deleteCall[1] as unknown[];

      // Should reference "version > 1" to protect v1
      expect(sql).toContain('version > 1');
      // LIMIT should be MAX_VERSIONS_PER_FEATURE - 1 = 49
      expect(params).toContain(MAX_VERSIONS_PER_FEATURE - 1);
    });
  });
});
