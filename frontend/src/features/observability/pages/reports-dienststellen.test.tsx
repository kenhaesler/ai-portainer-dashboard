import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DienststellenOverview, parseStackName } from './reports';
import type { Container } from '@/features/containers/hooks/use-containers';

function makeContainer(overrides: Partial<Container> = {}): Container {
  return {
    id: 'abc123',
    name: 'web-app',
    image: 'nginx:latest',
    state: 'running',
    status: 'Up 2 hours',
    endpointId: 1,
    endpointName: 'Endpoint-1',
    ports: [],
    created: Date.now() / 1000,
    labels: {},
    networks: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// parseStackName unit tests
// ---------------------------------------------------------------------------

describe('parseStackName', () => {
  it('returns null for empty string', () => {
    expect(parseStackName('')).toBeNull();
  });

  it('returns null for single-segment name (no convention)', () => {
    expect(parseStackName('mystack')).toBeNull();
  });

  it('parses two-segment name (department + dienststelle)', () => {
    const result = parseStackName('IT_Berlin');
    expect(result).toEqual({
      department: 'IT',
      dienststelle: 'Berlin',
      stackName: 'Berlin',
      environment: null,
      raw: 'IT_Berlin',
    });
  });

  it('parses full convention: dept_dienststelle_stack', () => {
    const result = parseStackName('IT_Berlin_webapp');
    expect(result).toEqual({
      department: 'IT',
      dienststelle: 'Berlin',
      stackName: 'webapp',
      environment: null,
      raw: 'IT_Berlin_webapp',
    });
  });

  it('parses stack with -prod suffix', () => {
    const result = parseStackName('HR_Munich_portal-prod');
    expect(result).toEqual({
      department: 'HR',
      dienststelle: 'Munich',
      stackName: 'portal',
      environment: 'prod',
      raw: 'HR_Munich_portal-prod',
    });
  });

  it('parses stack with -test suffix', () => {
    const result = parseStackName('FIN_Hamburg_billing-test');
    expect(result).toEqual({
      department: 'FIN',
      dienststelle: 'Hamburg',
      stackName: 'billing',
      environment: 'test',
      raw: 'FIN_Hamburg_billing-test',
    });
  });

  it('handles stack name with extra underscores', () => {
    const result = parseStackName('IT_Berlin_web_app_v2-prod');
    expect(result).toEqual({
      department: 'IT',
      dienststelle: 'Berlin',
      stackName: 'web_app_v2',
      environment: 'prod',
      raw: 'IT_Berlin_web_app_v2-prod',
    });
  });

  it('does not confuse -production with -prod', () => {
    const result = parseStackName('IT_Berlin_app-production');
    expect(result).toEqual({
      department: 'IT',
      dienststelle: 'Berlin',
      stackName: 'app-production',
      environment: null,
      raw: 'IT_Berlin_app-production',
    });
  });
});

// ---------------------------------------------------------------------------
// DienststellenOverview component tests
// ---------------------------------------------------------------------------

describe('DienststellenOverview', () => {
  it('renders nothing when containers is undefined', () => {
    const { container } = render(
      <DienststellenOverview containers={undefined} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when containers array is empty', () => {
    const { container } = render(
      <DienststellenOverview containers={[]} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('groups containers by dienststelle from stack label', () => {
    const containers = [
      makeContainer({
        id: 'c1', name: 'web-1',
        labels: { 'com.docker.compose.project': 'IT_Berlin_webapp-prod' },
      }),
      makeContainer({
        id: 'c2', name: 'api-1',
        labels: { 'com.docker.compose.project': 'IT_Berlin_api-prod' },
      }),
      makeContainer({
        id: 'c3', name: 'db-1',
        labels: { 'com.docker.compose.project': 'HR_Munich_database' },
      }),
    ];

    render(<DienststellenOverview containers={containers} />);

    expect(screen.getByText('Berlin')).toBeInTheDocument();
    expect(screen.getByText('Munich')).toBeInTheDocument();
  });

  it('shows total Dienststellen count (excluding Standalone)', () => {
    const containers = [
      makeContainer({
        id: 'c1', name: 'web',
        labels: { 'com.docker.compose.project': 'IT_Berlin_web' },
      }),
      makeContainer({
        id: 'c2', name: 'api',
        labels: { 'com.docker.compose.project': 'IT_Munich_api' },
      }),
      makeContainer({ id: 'c3', name: 'orphan', labels: {} }),
    ];

    render(<DienststellenOverview containers={containers} />);

    expect(screen.getByText('Total Dienststellen')).toBeInTheDocument();
    // 2 Dienststellen (Berlin + Munich), Standalone not counted
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('shows department badges', () => {
    const containers = [
      makeContainer({
        id: 'c1', name: 'web',
        labels: { 'com.docker.compose.project': 'IT_Berlin_web' },
      }),
    ];

    render(<DienststellenOverview containers={containers} />);

    expect(screen.getByText('IT')).toBeInTheDocument();
  });

  it('shows departments KPI', () => {
    const containers = [
      makeContainer({
        id: 'c1', name: 'web',
        labels: { 'com.docker.compose.project': 'IT_Berlin_web' },
      }),
      makeContainer({
        id: 'c2', name: 'api',
        labels: { 'com.docker.compose.project': 'HR_Munich_api' },
      }),
    ];

    render(<DienststellenOverview containers={containers} />);

    expect(screen.getByText('Departments')).toBeInTheDocument();
  });

  it('shows prod/test environment badges on the group row', () => {
    const containers = [
      makeContainer({
        id: 'c1', name: 'web',
        labels: { 'com.docker.compose.project': 'IT_Berlin_web-prod' },
      }),
      makeContainer({
        id: 'c2', name: 'api',
        labels: { 'com.docker.compose.project': 'IT_Berlin_api-test' },
      }),
    ];

    render(<DienststellenOverview containers={containers} />);

    expect(screen.getByText('prod')).toBeInTheDocument();
    expect(screen.getByText('test')).toBeInTheDocument();
  });

  it('shows containers with stack and environment in expanded view', () => {
    const containers = [
      makeContainer({
        id: 'c1', name: 'web-server',
        image: 'nginx:1.25',
        labels: { 'com.docker.compose.project': 'IT_Berlin_webapp-prod' },
      }),
    ];

    render(<DienststellenOverview containers={containers} />);

    // Click to expand
    fireEvent.click(screen.getByText('Berlin'));

    expect(screen.getByText('web-server')).toBeInTheDocument();
    expect(screen.getByText('webapp')).toBeInTheDocument();
    expect(screen.getByText('nginx:1.25')).toBeInTheDocument();
  });

  it('collapses on second click', () => {
    const containers = [
      makeContainer({
        id: 'c1', name: 'my-app',
        labels: { 'com.docker.compose.project': 'IT_Berlin_web' },
      }),
    ];

    render(<DienststellenOverview containers={containers} />);

    fireEvent.click(screen.getByText('Berlin'));
    expect(screen.getByText('my-app')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Berlin'));
    expect(screen.queryByText('my-app')).not.toBeInTheDocument();
  });

  it('shows running/stopped counts per group', () => {
    const containers = [
      makeContainer({
        id: 'c1', name: 'a1', state: 'running',
        labels: { 'com.docker.compose.project': 'IT_Berlin_web' },
      }),
      makeContainer({
        id: 'c2', name: 'a2', state: 'running',
        labels: { 'com.docker.compose.project': 'IT_Berlin_api' },
      }),
      makeContainer({
        id: 'c3', name: 'a3', state: 'stopped',
        labels: { 'com.docker.compose.project': 'IT_Berlin_db' },
      }),
    ];

    render(<DienststellenOverview containers={containers} />);

    expect(screen.getByText('2 running')).toBeInTheDocument();
    expect(screen.getByText('1 stopped')).toBeInTheDocument();
    expect(screen.getByText('3 total')).toBeInTheDocument();
  });

  it('puts standalone containers (no stack label) in Standalone group', () => {
    const containers = [
      makeContainer({ id: 'c1', name: 'orphan-1', labels: {} }),
      makeContainer({ id: 'c2', name: 'orphan-2', labels: {} }),
    ];

    render(<DienststellenOverview containers={containers} />);

    expect(screen.getByText('Standalone')).toBeInTheDocument();
    expect(screen.getByText('2 total')).toBeInTheDocument();
  });

  it('sorts Dienststellen alphabetically with Standalone last', () => {
    const containers = [
      makeContainer({
        id: 'c1', name: 'z-app',
        labels: { 'com.docker.compose.project': 'IT_Zurich_web' },
      }),
      makeContainer({
        id: 'c2', name: 'b-app',
        labels: { 'com.docker.compose.project': 'IT_Berlin_web' },
      }),
      makeContainer({ id: 'c3', name: 'orphan', labels: {} }),
    ];

    render(<DienststellenOverview containers={containers} />);

    const buttons = screen.getAllByRole('button');
    const names = buttons.map((b) => b.textContent);
    const berlinIdx = names.findIndex((n) => n?.includes('Berlin'));
    const zurichIdx = names.findIndex((n) => n?.includes('Zurich'));
    const standaloneIdx = names.findIndex((n) => n?.includes('Standalone'));

    expect(berlinIdx).toBeLessThan(zurichIdx);
    expect(zurichIdx).toBeLessThan(standaloneIdx);
  });

  it('handles non-convention stack names as Standalone', () => {
    const containers = [
      makeContainer({
        id: 'c1', name: 'app',
        labels: { 'com.docker.compose.project': 'mystack' },
      }),
    ];

    render(<DienststellenOverview containers={containers} />);

    expect(screen.getByText('Standalone')).toBeInTheDocument();
  });
});
