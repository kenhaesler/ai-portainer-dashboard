import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen } from '@testing-library/react';

const mockUseInvestigationDetail = vi.fn();
const mockUseInvestigationByInsightId = vi.fn();

vi.mock('@/hooks/use-investigations', () => ({
  safeParseJson: (value: string | null) => {
    if (!value) return null;
    return JSON.parse(value);
  },
  useInvestigationDetail: (...args: unknown[]) => mockUseInvestigationDetail(...args),
  useInvestigationByInsightId: (...args: unknown[]) => mockUseInvestigationByInsightId(...args),
}));

import InvestigationDetailPage from './investigation-detail';

const baseInvestigation = {
  id: 'inv-1',
  insight_id: 'insight-1',
  endpoint_id: 1,
  container_id: 'container-1',
  container_name: 'api-1',
  status: 'complete',
  evidence_summary: null,
  root_cause: 'CPU leak in worker process',
  contributing_factors: JSON.stringify(['High request burst']),
  severity_assessment: null,
  recommended_actions: JSON.stringify([{ action: 'Scale replicas', priority: 'high' }]),
  confidence_score: 0.88,
  analysis_duration_ms: 3200,
  llm_model: 'llama3.2',
  error_message: null,
  created_at: '2026-02-06T10:00:00.000Z',
  completed_at: '2026-02-06T10:01:00.000Z',
};

function renderById() {
  return render(
    <MemoryRouter initialEntries={['/investigations/inv-1']}>
      <Routes>
        <Route path="/investigations/:id" element={<InvestigationDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

function renderByInsight() {
  return render(
    <MemoryRouter initialEntries={['/investigations/insight/insight-1']}>
      <Routes>
        <Route path="/investigations/insight/:insightId" element={<InvestigationDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('InvestigationDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseInvestigationDetail.mockReturnValue({
      data: baseInvestigation,
      isLoading: false,
      error: null,
    });
    mockUseInvestigationByInsightId.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
    });
  });

  it('renders investigation details by investigation id route', () => {
    renderById();

    expect(screen.getByText('Investigation Detail')).toBeInTheDocument();
    expect(screen.getByText('CPU leak in worker process')).toBeInTheDocument();
    expect(screen.getByText('Scale replicas')).toBeInTheDocument();
    expect(screen.getByText('ID: inv-1')).toBeInTheDocument();
  });

  it('renders investigation details by insight route', () => {
    mockUseInvestigationDetail.mockReturnValue({ data: undefined, isLoading: false, error: null });
    mockUseInvestigationByInsightId.mockReturnValue({
      data: baseInvestigation,
      isLoading: false,
      error: null,
    });

    renderByInsight();

    expect(screen.getByText('ID: inv-1')).toBeInTheDocument();
    expect(screen.getByText('High request burst')).toBeInTheDocument();
  });

  it('renders error state when investigation cannot be loaded', () => {
    mockUseInvestigationDetail.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Investigation not found'),
    });

    renderById();

    expect(screen.getByText('Failed to load investigation')).toBeInTheDocument();
    expect(screen.getByText('Investigation not found')).toBeInTheDocument();
  });
});
