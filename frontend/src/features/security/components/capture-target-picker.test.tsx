import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CaptureTargetPicker, type CaptureTarget } from './capture-target-picker';
import type { Container } from '@/features/containers/hooks/use-containers';
import type { Stack } from '@/features/containers/hooks/use-stacks';

const containers = [
  { id: 'c1', name: 'nginx-prod', image: 'nginx', state: 'running', status: 'Up', endpointId: 1, endpointName: 'prod', ports: [], created: 0, labels: { 'com.docker.compose.project': 'web' }, networks: [] },
  { id: 'c2', name: 'nginx-stage', image: 'nginx', state: 'running', status: 'Up', endpointId: 2, endpointName: 'staging', ports: [], created: 0, labels: {}, networks: [] },
  { id: 'c3', name: 'postgres', image: 'postgres', state: 'running', status: 'Up', endpointId: 2, endpointName: 'staging', ports: [], created: 0, labels: {}, networks: [] },
] as unknown as Container[];
const stacks = [{ id: 1, name: 'web', endpointId: 1 }] as unknown as Stack[];

function setup(props: Partial<React.ComponentProps<typeof CaptureTargetPicker>> = {}) {
  const onChange = vi.fn();
  render(
    <CaptureTargetPicker
      containers={containers}
      stacks={stacks}
      edgeAsyncEndpointIds={new Set()}
      value={null}
      onChange={onChange}
      {...props}
    />,
  );
  return { onChange };
}

describe('CaptureTargetPicker', () => {
  it('finds matching containers across endpoints with no endpoint pre-selection', () => {
    setup();
    const input = screen.getByLabelText('Search capture target container');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'nginx' } });
    expect(screen.getByText('prod')).toBeInTheDocument();
    expect(screen.getByText('staging')).toBeInTheDocument();
    expect(screen.getByText('nginx-prod')).toBeInTheDocument();
    expect(screen.getByText('nginx-stage')).toBeInTheDocument();
    expect(screen.queryByText('postgres')).not.toBeInTheDocument();
  });

  it('selecting a container emits a CaptureTarget', () => {
    const { onChange } = setup();
    const input = screen.getByLabelText('Search capture target container');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'postgres' } });
    // The fixture container is named "postgres" with image "postgres", so plain
    // getByText('postgres') is ambiguous. Click the cmdk item (the row) instead —
    // this is the spec-sanctioned "click the closest cmdk-item ancestor" approach.
    fireEvent.click(screen.getByRole('option', { name: /postgres/ }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining<Partial<CaptureTarget>>({
        endpointId: 2, containerId: 'c3', containerName: 'postgres', endpointName: 'staging',
      }),
    );
  });

  it('renders the selected target as a clearable chip', () => {
    const onChange = vi.fn();
    render(
      <CaptureTargetPicker
        containers={containers}
        stacks={stacks}
        edgeAsyncEndpointIds={new Set()}
        value={{ endpointId: 1, containerId: 'c1', containerName: 'nginx-prod', endpointName: 'prod', stackName: 'web' }}
        onChange={onChange}
      />,
    );
    expect(screen.getByText('nginx-prod')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Clear selected container'));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('disables containers on edge-async endpoints', () => {
    setup({ edgeAsyncEndpointIds: new Set([2]) });
    const input = screen.getByLabelText('Search capture target container');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'nginx' } });
    const stageItem = screen.getByText('nginx-stage').closest('[data-disabled]') as HTMLElement;
    expect(stageItem).toBeTruthy();
  });

  it('keeps endpoints with the same display name as distinct groups', () => {
    const dupNameContainers = [
      { id: 'd1', name: 'svc-a', image: 'x', state: 'running', status: 'Up', endpointId: 1, endpointName: 'edge', ports: [], created: 0, labels: {}, networks: [] },
      { id: 'd2', name: 'svc-b', image: 'x', state: 'running', status: 'Up', endpointId: 2, endpointName: 'edge', ports: [], created: 0, labels: {}, networks: [] },
    ] as unknown as Container[];
    render(
      <CaptureTargetPicker
        containers={dupNameContainers}
        stacks={[] as unknown as Stack[]}
        edgeAsyncEndpointIds={new Set()}
        value={null}
        onChange={vi.fn()}
      />,
    );
    const input = screen.getByLabelText('Search capture target container');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'svc' } });
    // Both containers from the two same-named endpoints are listed (not merged
    // or dropped), and the heading appears once per endpoint group.
    expect(screen.getByText('svc-a')).toBeInTheDocument();
    expect(screen.getByText('svc-b')).toBeInTheDocument();
    expect(screen.getAllByText('edge')).toHaveLength(2);
  });
});
