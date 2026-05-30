import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CaptureBrowseFallback } from './capture-browse-fallback';
import type { Container } from '@/features/containers/hooks/use-containers';
import type { Stack } from '@/features/containers/hooks/use-stacks';

const containers = [
  { id: 'c1', name: 'api-1', image: 'a', state: 'running', status: 'Up', endpointId: 1, endpointName: 'local', ports: [], created: 0, networks: [], labels: { 'com.docker.compose.project': 'alpha' } },
  { id: 'c4', name: 'beta-api-1', image: 'b', state: 'running', status: 'Up', endpointId: 1, endpointName: 'local', ports: [], created: 0, networks: [], labels: { 'com.docker.compose.project': 'beta' } },
  { id: 'c3', name: 'standalone-1', image: 's', state: 'running', status: 'Up', endpointId: 1, endpointName: 'local', ports: [], created: 0, networks: [], labels: {} },
] as unknown as Container[];
const stacks = [{ id: 1, name: 'alpha', endpointId: 1 }, { id: 2, name: 'beta', endpointId: 1 }] as unknown as Stack[];
const endpoints = [{ id: 1, name: 'local' }];

function openDisclosure() {
  fireEvent.click(screen.getByText(/browse by endpoint/i));
}

describe('CaptureBrowseFallback', () => {
  it('groups containers by stack once an endpoint is chosen', () => {
    render(<CaptureBrowseFallback containers={containers} stacks={stacks} endpoints={endpoints} edgeAsyncEndpointIds={new Set()} onChange={() => {}} />);
    openDisclosure();
    fireEvent.click(screen.getAllByRole('combobox')[0]); // endpoint select
    fireEvent.click(screen.getByRole('option', { name: 'local' }));
    fireEvent.click(screen.getAllByRole('combobox')[2]); // container select
    expect(screen.getByText('alpha')).toBeInTheDocument();
    expect(screen.getByText('beta')).toBeInTheDocument();
    expect(screen.getByText('No Stack')).toBeInTheDocument();
  }, 20000);

  it('emits a CaptureTarget when a container is chosen', () => {
    const onChange = vi.fn();
    render(<CaptureBrowseFallback containers={containers} stacks={stacks} endpoints={endpoints} edgeAsyncEndpointIds={new Set()} onChange={onChange} />);
    openDisclosure();
    fireEvent.click(screen.getAllByRole('combobox')[0]);
    fireEvent.click(screen.getByRole('option', { name: 'local' }));
    fireEvent.click(screen.getAllByRole('combobox')[2]);
    fireEvent.click(screen.getByRole('option', { name: 'api-1' }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ endpointId: 1, containerId: 'c1', containerName: 'api-1', endpointName: 'local' }),
    );
  }, 20000);
});
