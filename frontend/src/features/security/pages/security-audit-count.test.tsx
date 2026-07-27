import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { SecurityAuditEntry } from '@/features/security/hooks/use-security-audit';
import SecurityAuditPage from './security-audit';

/**
 * The audit page counted the rows it was displaying, not the containers that
 * needed review.
 *
 * `visibleEntries` includes the clean rows once "Show N clean containers" is
 * expanded, so clicking that button — an explicit request to confirm nothing
 * was wrong — flipped the counter above it from "0 containers need a look" to
 * "20 containers need a look", while the button itself now read "Hide 20 clean
 * containers". The page asserted twenty findings and zero findings at once, on
 * a security surface, from a fleet with no exceptions at all.
 *
 * These tests drive the real `SecurityAuditPage` and stub only `fetch`, so the
 * count they read is the one the page renders. A display toggle must not be
 * able to change a count of findings.
 */

interface EntryOverrides {
  capAdd?: string[];
  privileged?: boolean;
  networkMode?: string;
  pidMode?: string;
  severity?: SecurityAuditEntry['severity'];
  findings?: SecurityAuditEntry['findings'];
}

function makeEntry(name: string, overrides: EntryOverrides = {}): SecurityAuditEntry {
  return {
    containerId: `id-${name}`,
    containerName: name,
    stackName: 'core',
    endpointId: 1,
    endpointName: 'prod',
    state: 'running',
    status: 'Up',
    image: `${name}:latest`,
    posture: {
      capAdd: overrides.capAdd ?? [],
      privileged: overrides.privileged ?? false,
      networkMode: overrides.networkMode ?? 'bridge',
      pidMode: overrides.pidMode ?? 'private',
    },
    findings: overrides.findings ?? [],
    severity: overrides.severity ?? 'none',
    ignored: false,
  };
}

/** Adds no capability, runs unprivileged, shares no namespace, trips no check. */
function cleanFleet(size: number): SecurityAuditEntry[] {
  return Array.from({ length: size }, (_, i) => makeEntry(`svc-${i}`));
}

/**
 * Stubs the HTTP boundary rather than the page's hook, so `useSecurityAudit`,
 * the api client and the page's own derivation all run for real.
 */
function stubApi(entries: SecurityAuditEntry[]) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    const body = url.includes('/api/security/audit')
      ? { entries }
      : url.includes('/api/endpoints')
        ? []
        // Observed destinations panel; nothing here asserts on it.
        : { destinations: [] };
    return { ok: true, status: 200, json: () => Promise.resolve(body) } as Response;
  });
}

async function renderAudit(entries: SecurityAuditEntry[]) {
  stubApi(entries);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <SecurityAuditPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  // The subtitle renders only once the audit query has resolved.
  await screen.findByTestId('page-header-subtitle');
}

/**
 * The header line above the table. Compared with `toBe` rather than
 * `toHaveTextContent`, which is a substring match — and "0 containers need a
 * look" is a substring of the regression's "20 containers need a look".
 */
function countLine(): string {
  return screen.getByText(/need a look$/).textContent?.trim() ?? '';
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('security audit "need a look" count', () => {
  it('stays at zero when a clean fleet expands its clean list', async () => {
    await renderAudit(cleanFleet(20));

    expect(countLine()).toBe('0 containers need a look');
    expect(screen.getByText('Nothing to review')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Show 20 clean containers/ }));

    // The rows the user asked to see are now on screen...
    expect(screen.queryByText('Nothing to review')).not.toBeInTheDocument();
    expect(screen.getByTestId('data-table')).toBeInTheDocument();
    // DataTable paginates at 10 rows, so all 20 are reported by the footer
    // rather than rendered at once.
    expect(screen.getByText('Page 1 of 2 (20 total)')).toBeInTheDocument();
    expect(screen.getAllByTestId(/^table-row-/)).toHaveLength(10);

    // ...and the finding count is unmoved by that display choice.
    expect(countLine()).toBe('0 containers need a look');
    expect(screen.getByRole('button', { name: /Hide 20 clean containers/ })).toBeInTheDocument();
  });

  it('is unchanged by the toggle on a fleet that does have exceptions', async () => {
    await renderAudit([
      makeEntry('privileged-agent', { privileged: true }),
      makeEntry('net-tool', { capAdd: ['NET_ADMIN'] }),
      makeEntry('node-exporter', { networkMode: 'host', pidMode: 'host' }),
      ...cleanFleet(5),
    ]);

    expect(countLine()).toBe('3 containers need a look');
    expect(screen.getAllByTestId(/^table-row-/)).toHaveLength(3);

    fireEvent.click(screen.getByRole('button', { name: /Show 5 clean containers/ }));

    expect(screen.getAllByTestId(/^table-row-/)).toHaveLength(8);
    expect(countLine()).toBe('3 containers need a look');
  });

  it('counts only the containers that trip a check', async () => {
    await renderAudit([
      makeEntry('privileged-agent', { privileged: true }),
      makeEntry('sys-admin', { capAdd: ['SYS_ADMIN'] }),
      ...cleanFleet(4),
    ]);

    expect(countLine()).toBe('2 containers need a look');
  });
});
