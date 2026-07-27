import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

// The attribution setting is a prop handed to ReactFlow, not DOM this component
// renders. Stub it at the boundary and record what it was called with.
const reactFlowProps: Array<Record<string, unknown>> = [];

vi.mock('@xyflow/react', () => ({
  ReactFlow: (props: Record<string, unknown>) => {
    reactFlowProps.push(props);
    return <div data-testid="react-flow">{props.children as ReactNode}</div>;
  },
  Background: () => null,
  Controls: () => null,
  useNodesState: (initial: unknown) => [initial, vi.fn(), vi.fn()],
  useEdgesState: (initial: unknown) => [initial, vi.fn(), vi.fn()],
}));

import { ServiceMap } from './service-map';

const serviceNodes = [
  { id: 'api', name: 'api', callCount: 12, avgDuration: 40, errorRate: 0 },
  { id: 'db', name: 'db', callCount: 5, avgDuration: 120, errorRate: 0.2 },
];

const serviceEdges = [{ source: 'api', target: 'db', callCount: 5, avgDuration: 120 }];

describe('ServiceMap', () => {
  beforeEach(() => {
    reactFlowProps.length = 0;
  });

  it('shows an empty state rather than a blank canvas when there are no services', () => {
    render(<ServiceMap serviceNodes={[]} serviceEdges={[]} />);

    expect(screen.getByText('No service map data')).toBeInTheDocument();
    expect(reactFlowProps).toHaveLength(0);
  });

  it('asks ReactFlow for a bottom-left attribution instead of suppressing it', () => {
    render(<ServiceMap serviceNodes={serviceNodes} serviceEdges={serviceEdges} />);

    const props = reactFlowProps[0];
    expect(props).toBeDefined();

    // Suppressing the badge is what xyflow reserves for Pro subscribers; here
    // it is asked for instead.
    const proOptions = props.proOptions as { hideAttribution?: boolean } | undefined;
    expect(proOptions?.hideAttribution).not.toBe(true);
    expect(props.attributionPosition).toBe('bottom-left');
  });
});
