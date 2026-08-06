import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { NodeProps } from '@xyflow/react';
import { stripGroupPrefix, ContainerNode } from './container-node';

// @xyflow/react's Handle needs a ReactFlow provider; the node's label logic
// does not, so stub the handle at the boundary.
vi.mock('@xyflow/react', () => ({
  Handle: () => null,
  Position: { Top: 'top', Right: 'right', Bottom: 'bottom', Left: 'left' },
}));

describe('stripGroupPrefix', () => {
  it('drops the compose project prefix the group box already shows', () => {
    expect(stripGroupPrefix('container-insights-backend', 'container-insights')).toBe(
      'backend',
    );
    expect(stripGroupPrefix('container-insights-redis', 'container-insights')).toBe(
      'redis',
    );
  });

  it('distinguishes siblings that previously all truncated to the same string', () => {
    const group = 'container-insights';
    const names = [
      'container-insights-backend',
      'container-insights-frontend',
      'container-insights-redis',
    ];
    const stripped = names.map((n) => stripGroupPrefix(n, group));
    expect(new Set(stripped).size).toBe(3);
    // Every label now fits the 160px cap comfortably at text-xs (~22 chars).
    expect(stripped.every((s) => s.length <= 22)).toBe(true);
  });

  it('handles underscore-separated project names', () => {
    expect(stripGroupPrefix('docker_postgres', 'docker')).toBe('postgres');
  });

  it('leaves the label alone with no group, a non-matching group, or an exact match', () => {
    expect(stripGroupPrefix('standalone-thing')).toBe('standalone-thing');
    expect(stripGroupPrefix('other-app-web', 'container-insights')).toBe('other-app-web');
    expect(stripGroupPrefix('container-insights', 'container-insights')).toBe(
      'container-insights',
    );
  });

  it('never strips the label down to nothing', () => {
    expect(stripGroupPrefix('proj-', 'proj')).toBe('proj-');
  });
});

describe('ContainerNode', () => {
  const data = {
    label: 'container-insights-backend',
    groupLabel: 'container-insights',
    state: 'running',
    image: 'ghcr.io/example/backend:1.2.3',
    usedHandles: [],
  };

  /**
   * NodeProps carries a large xyflow surface the component never reads, so the
   * fields outside `data` are the values ReactFlow itself passes for a plain,
   * un-dragged, unselected node at the canvas origin.
   */
  function nodeProps(nodeData: Record<string, unknown>): NodeProps {
    return {
      id: 'container-insights-backend',
      type: 'container',
      data: nodeData,
      selected: false,
      dragging: false,
      draggable: true,
      selectable: true,
      deletable: true,
      isConnectable: true,
      zIndex: 0,
      positionAbsoluteX: 0,
      positionAbsoluteY: 0,
    };
  }

  function renderNode(overrides: Record<string, unknown> = {}) {
    return render(<ContainerNode {...nodeProps({ ...data, ...overrides })} />);
  }

  it('renders the de-prefixed name, not the shared prefix', () => {
    renderNode();
    expect(screen.getByText('backend')).toBeInTheDocument();
    expect(screen.queryByText('container-insights-backend')).not.toBeInTheDocument();
  });

  it('does not render a letter badge derived from the name', () => {
    const { container } = renderNode();
    // The circle used to show `label.charAt(0)`, which is constant inside a
    // compose project: six green circles all reading "C".
    expect(container.textContent).not.toMatch(/^C/);
    expect(container.textContent).toBe('backend');
  });

  it('moves the full name and image onto the hover title instead of a second line', () => {
    const { container } = renderNode();
    expect(screen.queryByText('ghcr.io/example/backend:1.2.3')).not.toBeInTheDocument();
    expect((container.firstChild as HTMLElement).title).toBe(
      'container-insights-backend (running) — ghcr.io/example/backend:1.2.3',
    );
  });

  it('widens the label past the compose-prefix width', () => {
    const { container } = renderNode();
    const labelEl = container.querySelector('.truncate') as HTMLElement;
    expect(labelEl.className).toContain('max-w-[160px]');
    expect(labelEl.className).not.toContain('max-w-[100px]');
  });

  it('uses a neutral selection ring rather than a status hue', () => {
    const { container } = renderNode({ selected: true });
    const circle = container.querySelector('.rounded-full') as HTMLElement;
    expect(circle.className).toContain('ring-foreground/70');
    expect(circle.className).not.toContain('ring-cyan-300');
  });
});
