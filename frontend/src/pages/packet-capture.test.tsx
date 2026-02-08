import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/hooks/use-endpoints', () => ({
  useEndpoints: vi.fn().mockReturnValue({
    data: [{ id: 1, name: 'local' }],
  }),
}));

vi.mock('@/hooks/use-containers', () => ({
  useContainers: vi.fn().mockReturnValue({
    data: [
      {
        id: 'c1',
        name: 'api-1',
        state: 'running',
        labels: { 'com.docker.compose.project': 'alpha' },
      },
      {
        id: 'c2',
        name: 'worker-1',
        state: 'running',
        labels: { 'com.docker.compose.project': 'alpha' },
      },
      {
        id: 'c4',
        name: 'beta-api-1',
        state: 'running',
        labels: { 'com.docker.compose.project': 'beta' },
      },
      {
        id: 'c3',
        name: 'standalone-1',
        state: 'running',
        labels: {},
      },
    ],
  }),
}));

vi.mock('@/hooks/use-stacks', () => ({
  useStacks: vi.fn().mockReturnValue({
    data: [
      { id: 1, name: 'alpha', endpointId: 1, type: 1, status: 'active', envCount: 0 },
      { id: 2, name: 'beta', endpointId: 1, type: 1, status: 'active', envCount: 0 },
    ],
  }),
}));

vi.mock('@/hooks/use-pcap', () => ({
  useCaptures: vi.fn().mockReturnValue({
    data: { captures: [] },
    refetch: vi.fn(),
  }),
  useStartCapture: vi.fn().mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  }),
  useStopCapture: vi.fn().mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  }),
  useDeleteCapture: vi.fn().mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  }),
  useAnalyzeCapture: vi.fn().mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    variables: undefined,
  }),
  downloadCapture: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: {
    getToken: vi.fn().mockReturnValue(null),
  },
}));

import PacketCapture from './packet-capture';

describe('PacketCapture', () => {
  it('groups running container options by stack and no-stack bucket', () => {
    render(<PacketCapture />);

    const endpointSelect = screen.getAllByRole('combobox')[0];
    fireEvent.click(endpointSelect);
    fireEvent.click(screen.getByRole('option', { name: 'local' }));

    const containerSelect = screen.getAllByRole('combobox')[2];
    fireEvent.click(containerSelect);

    expect(screen.getByText('alpha')).toBeInTheDocument();
    expect(screen.getByText('beta')).toBeInTheDocument();
    expect(screen.getByText('No Stack')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'api-1' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'worker-1' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'beta-api-1' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'standalone-1' })).toBeInTheDocument();
  });

  it('filters container options by selected stack', () => {
    render(<PacketCapture />);

    const endpointSelect = screen.getAllByRole('combobox')[0];
    fireEvent.click(endpointSelect);
    fireEvent.click(screen.getByRole('option', { name: 'local' }));

    const stackSelect = screen.getAllByRole('combobox')[1];
    fireEvent.click(stackSelect);
    fireEvent.click(screen.getByRole('option', { name: 'alpha' }));

    const containerSelect = screen.getAllByRole('combobox')[2];
    fireEvent.click(containerSelect);

    expect(screen.getByRole('option', { name: 'api-1' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'worker-1' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'beta-api-1' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'standalone-1' })).not.toBeInTheDocument();
  });
});
