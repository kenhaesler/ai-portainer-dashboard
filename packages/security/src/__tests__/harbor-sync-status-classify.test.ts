import { describe, it, expect } from 'vitest';
import {
  classifySyncStatus,
  TRUNCATION_PREFIX,
  type SyncStatusRecord,
} from '../services/harbor-vulnerability-store.js';

// Pure-function tests for the #1392 truncation relabel. A truncated sync is
// successful-but-incomplete: the note is persisted in error_message (no dedicated
// column) but must be surfaced at the API as `truncated` / `syncWarning`, NOT as
// a hard error. classifySyncStatus performs that boundary reclassification.

function record(over: Partial<SyncStatusRecord>): SyncStatusRecord {
  return {
    id: 1,
    sync_type: 'full',
    status: 'completed',
    vulnerabilities_synced: 0,
    in_use_matched: 0,
    error_message: null,
    started_at: '2026-01-01T00:00:00Z',
    completed_at: '2026-01-01T00:01:00Z',
    ...over,
  };
}

describe('classifySyncStatus (#1392 truncation relabel)', () => {
  it('reclassifies a truncated completed sync as a warning, clearing error_message', () => {
    const msg = `${TRUNCATION_PREFIX} synced 200 of 10000 vulnerabilities (raise HARBOR_MAX_PAGES)`;
    const r = classifySyncStatus(
      record({ status: 'completed', error_message: msg, vulnerabilities_synced: 200 }),
    );
    expect(r.truncated).toBe(true);
    expect(r.syncWarning).toBe(msg);
    expect(r.lastSync?.error_message).toBeNull(); // not surfaced as a hard error
    expect(r.lastSync?.vulnerabilities_synced).toBe(200); // other fields preserved
    expect(r.lastSync?.status).toBe('completed');
  });

  it('passes a real failure through unchanged (not truncation)', () => {
    const r = classifySyncStatus(record({ status: 'failed', error_message: 'Harbor API 500' }));
    expect(r.truncated).toBe(false);
    expect(r.syncWarning).toBeNull();
    expect(r.lastSync?.error_message).toBe('Harbor API 500');
  });

  it('passes a clean completed sync through unchanged', () => {
    const r = classifySyncStatus(record({ status: 'completed', error_message: null }));
    expect(r.truncated).toBe(false);
    expect(r.syncWarning).toBeNull();
    expect(r.lastSync?.error_message).toBeNull();
  });

  it('does not treat a truncation-looking message on a failed sync as a warning', () => {
    // Only completed syncs carry truncation notes; a failed sync stays an error.
    const msg = `${TRUNCATION_PREFIX} synced 1 of 2`;
    const r = classifySyncStatus(record({ status: 'failed', error_message: msg }));
    expect(r.truncated).toBe(false);
    expect(r.syncWarning).toBeNull();
    expect(r.lastSync?.error_message).toBe(msg);
  });

  it('handles a null record', () => {
    expect(classifySyncStatus(null)).toEqual({
      lastSync: null,
      truncated: false,
      syncWarning: null,
    });
  });
});
