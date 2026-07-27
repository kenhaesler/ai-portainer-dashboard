import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  EndpointHealthOctagons,
  getHealthLevel_testable,
  type EndpointHealthOctagonsProps,
} from './endpoint-health-octagons';

/**
 * The element type the component actually accepts. Derived from the prop rather
 * than inferred from the ENDPOINTS fixture below: that fixture exercises none of
 * the optional fields, so inferring from it silently narrowed `withHexGrid` to
 * the five always-present keys and rejected every offline/unavailable endpoint.
 */
type EndpointHealth = EndpointHealthOctagonsProps['endpoints'][number];

const mockNavigate = vi.fn();
vi.mock('react-router', () => ({
  useNavigate: () => mockNavigate,
  Link: ({ to, children, ...rest }: any) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('framer-motion', () => ({
  m: {
    div: ({ children, ...props }: any) => {
      const { variants: _v, initial: _i, animate: _a, ...rest } = props;
      return <div {...rest}>{children}</div>;
    },
  },
  useReducedMotion: () => false,
}));

// Store the ResizeObserver callback so we can trigger it in tests
let resizeCallback: ResizeObserverCallback | null = null;
beforeEach(() => {
  mockNavigate.mockReset();
  resizeCallback = null;
  global.ResizeObserver = class {
    constructor(cb: ResizeObserverCallback) {
      resizeCallback = cb;
    }
    observe = vi.fn();
    disconnect = vi.fn();
    unobserve = vi.fn();
  } as unknown as typeof ResizeObserver;
});

/** Render and trigger ResizeObserver with a simulated container width */
function renderWithWidth(ui: React.ReactElement, width = 600) {
  const result = render(ui);
  // Trigger the resize callback to set containerWidth
  act(() => {
    resizeCallback?.([{ contentRect: { width, height: 400 } } as unknown as ResizeObserverEntry], {} as ResizeObserver);
  });
  return result;
}

const ENDPOINTS: EndpointHealth[] = [
  { id: 1, name: 'Production', running: 9, stopped: 1, total: 10 },
  { id: 2, name: 'Staging', running: 4, stopped: 4, total: 8 },
  { id: 3, name: 'Dev', running: 1, stopped: 5, total: 6 },
  { id: 4, name: 'Empty', running: 0, stopped: 0, total: 0 },
];

/**
 * Pad a fleet up to the honeycomb threshold. Below 4 endpoints the component
 * deliberately drops the hex grid for one row per endpoint, so tests about the
 * hexagon itself have to supply a fleet big enough to get one.
 */
function withHexGrid(...endpoints: EndpointHealth[]): EndpointHealth[] {
  const filler = ENDPOINTS.slice(0, Math.max(0, 4 - endpoints.length)).map((ep, i) => ({
    ...ep,
    id: 1000 + i,
    name: `Filler${i}`,
  }));
  return [...endpoints, ...filler];
}

describe('EndpointHealthOctagons', () => {
  it('renders one hexagon per endpoint', () => {
    renderWithWidth(<EndpointHealthOctagons endpoints={ENDPOINTS} />);
    expect(screen.getByTestId('octagon-Production')).toBeInTheDocument();
    expect(screen.getByTestId('octagon-Staging')).toBeInTheDocument();
    expect(screen.getByTestId('octagon-Dev')).toBeInTheDocument();
    expect(screen.getByTestId('octagon-Empty')).toBeInTheDocument();
  });

  it('displays endpoint name and running count', () => {
    renderWithWidth(<EndpointHealthOctagons endpoints={ENDPOINTS} />);
    expect(screen.getByText('Production')).toBeInTheDocument();
    expect(screen.getByText('9/10 running')).toBeInTheDocument();
    // The Empty endpoint (total=0) now reads "Awaiting snapshot" instead of "No containers" —
    // it's the same gray hexagon but the label distinguishes "we haven't seen data yet"
    // from "we tried and failed" (issue #1249).
    expect(
      within(screen.getByTestId('octagon-Empty')).getByText('Awaiting snapshot'),
    ).toBeInTheDocument();
  });

  it('renders "Offline" inside the hexagon when status=down', () => {
    const down = withHexGrid({ id: 9, name: 'DeadNode', running: 0, stopped: 0, total: 0, status: 'down' as const });
    renderWithWidth(<EndpointHealthOctagons endpoints={down} />);
    const hex = screen.getByTestId('octagon-DeadNode');
    expect(hex.textContent).toContain('Offline');
  });

  it('renders "Data unavailable" when snapshotSource=unavailable (issue #1249)', () => {
    const unavail = withHexGrid({ id: 10, name: 'EdgeStandard', running: 0, stopped: 0, total: 0, status: 'up' as const, snapshotSource: 'unavailable' as const });
    renderWithWidth(<EndpointHealthOctagons endpoints={unavail} />);
    const hex = screen.getByTestId('octagon-EdgeStandard');
    expect(hex.textContent).toContain('Data unavailable');
    expect(hex.textContent).not.toContain('Awaiting snapshot');
  });

  it('shows live counts and includes refresh age in the tooltip when snapshotSource=live', () => {
    const tenSecondsAgo = Date.now() - 10_000;
    const live = withHexGrid({
      id: 11, name: 'LiveEdge', running: 4, stopped: 1, total: 5,
      status: 'up' as const, snapshotSource: 'live' as const, snapshotFetchedAt: tenSecondsAgo,
    });
    renderWithWidth(<EndpointHealthOctagons endpoints={live} />);
    const hex = screen.getByTestId('octagon-LiveEdge');
    expect(hex.textContent).toContain('4/5 running');
    // Tooltip lives on the title attribute — surfaced to screen readers via aria-label.
    expect(hex.getAttribute('title')).toMatch(/live, refreshed \d+s ago/);
  });

  it('handles empty endpoints array', () => {
    render(<EndpointHealthOctagons endpoints={[]} />);
    expect(screen.getByText('No endpoint data')).toBeInTheDocument();
  });

  it('shows loading spinner when isLoading', () => {
    const { container } = render(<EndpointHealthOctagons endpoints={[]} isLoading />);
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('navigates to /infrastructure on click', () => {
    renderWithWidth(<EndpointHealthOctagons endpoints={ENDPOINTS} />);
    fireEvent.click(screen.getByTestId('octagon-Production'));
    expect(mockNavigate).toHaveBeenCalledWith('/infrastructure');
  });

  it('renders only the legend entries for levels present in the fleet', () => {
    renderWithWidth(<EndpointHealthOctagons endpoints={ENDPOINTS} />);
    const legend = within(screen.getByTestId('octagon-legend'));
    // The bands measure running/total, so the copy says "running", not "healthy".
    expect(legend.getByText('>80% running')).toBeInTheDocument();
    expect(legend.getByText('50-80% running')).toBeInTheDocument();
    expect(legend.getByText('<50% running')).toBeInTheDocument();
    expect(legend.getByText('Awaiting snapshot')).toBeInTheDocument();
    // Nothing here is offline or unavailable, so those captions are absent —
    // the legend used to list all six states regardless.
    expect(legend.queryByText('Offline')).not.toBeInTheDocument();
    expect(legend.queryByText('Data unavailable')).not.toBeInTheDocument();
  });

  it('renders SVG hexagon paths', () => {
    const { container } = renderWithWidth(
      <EndpointHealthOctagons endpoints={withHexGrid(ENDPOINTS[0])} />,
    );
    const paths = container.querySelectorAll('path');
    // Each of the 4 hexagons has 3 paths: shadow, glow, main
    expect(paths.length).toBe(12);
  });

  // -------------------------------------------------------------------------
  // Small fleets: a fleet map designed for 50 hosts rendering 1, plus a
  // six-item legend of which five were unused, is 300px spent on one fact.
  // -------------------------------------------------------------------------

  it('collapses to one inline row per endpoint below 4 endpoints', () => {
    renderWithWidth(
      <EndpointHealthOctagons endpoints={[{ id: 1, name: 'docker-dev-1', running: 13, stopped: 0, total: 13 }]} />,
    );

    const row = screen.getByTestId('endpoint-row-docker-dev-1');
    expect(row).toHaveTextContent('docker-dev-1');
    expect(row).toHaveTextContent('13/13 running');
    expect(row).toHaveAttribute('href', '/infrastructure');
    expect(screen.queryByTestId('octagon-docker-dev-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('octagon-legend')).not.toBeInTheDocument();
  });

  it('keeps the honeycomb once the fleet reaches 4 endpoints', () => {
    renderWithWidth(<EndpointHealthOctagons endpoints={ENDPOINTS} />);

    expect(screen.getByTestId('octagon-Production')).toBeInTheDocument();
    expect(screen.queryByTestId('endpoint-rows')).not.toBeInTheDocument();
  });

  it('states offline and unavailable in words on the inline row', () => {
    renderWithWidth(
      <EndpointHealthOctagons
        endpoints={[
          { id: 1, name: 'DeadNode', running: 0, stopped: 0, total: 0, status: 'down' },
          { id: 2, name: 'EdgeStandard', running: 0, stopped: 0, total: 0, status: 'up', snapshotSource: 'unavailable' },
        ]}
      />,
    );

    expect(screen.getByTestId('endpoint-row-DeadNode')).toHaveTextContent('Offline');
    expect(screen.getByTestId('endpoint-row-EdgeStandard')).toHaveTextContent('Data unavailable');
  });
});

describe('getHealthLevel', () => {
  it('returns good for >80% ratio', () => {
    expect(getHealthLevel_testable(9, 10)).toBe('good');
    expect(getHealthLevel_testable(10, 10)).toBe('good');
  });

  it('returns warning for 50-80% ratio', () => {
    expect(getHealthLevel_testable(5, 10)).toBe('warning');
    expect(getHealthLevel_testable(8, 10)).toBe('warning');
  });

  it('returns critical for <50% ratio', () => {
    expect(getHealthLevel_testable(1, 10)).toBe('critical');
    expect(getHealthLevel_testable(4, 10)).toBe('critical');
  });

  it('returns empty when total is 0', () => {
    expect(getHealthLevel_testable(0, 0)).toBe('empty');
  });

  it('returns offline when status is down regardless of counts (issue #1249)', () => {
    expect(getHealthLevel_testable(0, 0, 'down')).toBe('offline');
    expect(getHealthLevel_testable(5, 10, 'down')).toBe('offline');
    expect(getHealthLevel_testable(10, 10, 'down')).toBe('offline');
  });

  it('returns unavailable when snapshotSource is unavailable (issue #1249)', () => {
    expect(getHealthLevel_testable(0, 0, 'up', 'unavailable')).toBe('unavailable');
  });

  it('uses container ratio when status=up and snapshotSource=live', () => {
    expect(getHealthLevel_testable(9, 10, 'up', 'live')).toBe('good');
    expect(getHealthLevel_testable(0, 0, 'up', 'live')).toBe('empty');
  });
});
