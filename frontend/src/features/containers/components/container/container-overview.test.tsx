import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ContainerOverview } from './container-overview';

const baseContainer = {
  id: 'abc123def456789',
  name: 'api-1',
  image: 'ghcr.io/example/api:latest',
  state: 'running',
  status: 'Up 5 minutes',
  endpointId: 1,
  endpointName: 'local',
  ports: [],
  created: Math.floor(Date.now() / 1000) - 300,
  labels: {},
  networks: ['frontend', 'backend'],
};

describe('ContainerOverview — Host IP column', () => {
  it('renders the real per-row bind address instead of a hardcoded 0.0.0.0', () => {
    render(
      <ContainerOverview
        container={{
          ...baseContainer,
          ports: [
            { private: 80, public: 8080, type: 'tcp', ip: '0.0.0.0' },
            { private: 80, public: 8080, type: 'tcp', ip: '::' },
            { private: 5432, public: 5432, type: 'tcp', ip: '127.0.0.1' },
          ],
        }}
      />
    );

    // Every column survives, and Host IP is now backed by an accessor.
    for (const header of ['Container Port', 'Host Port', 'Type', 'Host IP']) {
      expect(screen.getByRole('columnheader', { name: header })).toBeInTheDocument();
    }

    // The two bindings Docker publishes for one mapping are now distinguishable
    // — they used to render as two identical `0.0.0.0` rows.
    expect(screen.getByText('0.0.0.0')).toBeInTheDocument();
    expect(screen.getByText('::')).toBeInTheDocument();
    expect(screen.getByText('127.0.0.1')).toBeInTheDocument();
  });

  it('badges wildcard binds and marks loopback binds, so the exposure is legible', () => {
    render(
      <ContainerOverview
        container={{
          ...baseContainer,
          ports: [
            { private: 80, public: 8080, type: 'tcp', ip: '0.0.0.0' },
            { private: 5432, public: 5432, type: 'tcp', ip: '127.0.0.1' },
            { private: 9000, public: 9000, type: 'tcp', ip: '192.168.1.10' },
          ],
        }}
      />
    );

    expect(screen.getAllByText('all interfaces')).toHaveLength(1);
    expect(screen.getByText('loopback only')).toBeInTheDocument();
    // A specific routable address needs no badge — the address itself says it.
    expect(screen.getByText('192.168.1.10')).toBeInTheDocument();
  });

  it('does not claim 0.0.0.0 when Docker reported no bind address', () => {
    render(
      <ContainerOverview
        container={{
          ...baseContainer,
          ports: [{ private: 53, type: 'udp' }],
        }}
      />
    );

    expect(screen.getByText('Not published')).toBeInTheDocument();
    expect(screen.queryByText('0.0.0.0')).not.toBeInTheDocument();
    expect(screen.queryByText('all interfaces')).not.toBeInTheDocument();
  });

  it('omits the Port Mappings card when there are no ports', () => {
    render(<ContainerOverview container={baseContainer} />);

    expect(screen.queryByRole('heading', { name: 'Port Mappings' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('data-table')).not.toBeInTheDocument();
  });
});

describe('ContainerOverview — identity strip', () => {
  it('states the running time once and never alongside Docker raw status string', () => {
    render(<ContainerOverview container={baseContainer} />);

    expect(screen.getByText('Uptime')).toBeInTheDocument();
    // The old strip carried `Status: Up 5 minutes` next to `Uptime: 5m`.
    expect(screen.queryByText('Status')).not.toBeInTheDocument();
    expect(screen.queryByText('Up 5 minutes')).not.toBeInTheDocument();
    expect(screen.getByText('Created')).toBeInTheDocument();
  });

  it('does not report an uptime for a container that is not running', () => {
    render(
      <ContainerOverview
        container={{
          ...baseContainer,
          state: 'stopped',
          status: 'Exited (137) 3 days ago',
        }}
      />
    );

    expect(screen.queryByText('Uptime')).not.toBeInTheDocument();
    expect(screen.getByText('State')).toBeInTheDocument();
    // Docker's own line is where the exit code lives, so it is kept for stopped
    // containers instead of a duration computed from the creation timestamp.
    expect(screen.getByText('Exited (137) 3 days ago')).toBeInTheDocument();
  });

  it('promotes the compose project and service into the strip', () => {
    render(
      <ContainerOverview
        container={{
          ...baseContainer,
          labels: {
            'com.docker.compose.project': 'lcm',
            'com.docker.compose.service': 'web',
          },
        }}
      />
    );

    expect(screen.getByText('Stack')).toBeInTheDocument();
    expect(screen.getByText('lcm / web')).toBeInTheDocument();
  });

  it('omits the Stack field when the container is not part of a compose project', () => {
    render(<ContainerOverview container={baseContainer} />);

    expect(screen.queryByText('Stack')).not.toBeInTheDocument();
  });
});

describe('ContainerOverview — Details list', () => {
  it('replaces the three near-empty cards with one definition list', () => {
    render(<ContainerOverview container={baseContainer} />);

    expect(screen.queryByRole('heading', { name: 'Image Information' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Endpoint Information' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Networks' })).not.toBeInTheDocument();

    expect(screen.getByRole('heading', { name: 'Details' })).toBeInTheDocument();
    const details = within(screen.getByTestId('container-details'));
    for (const term of ['Image', 'Container ID', 'Endpoint', 'Networks']) {
      expect(details.getByText(term).tagName).toBe('DT');
    }
    expect(screen.getByText('ghcr.io/example/api:latest')).toBeInTheDocument();
    expect(screen.getByText('abc123def456789')).toBeInTheDocument();
    expect(screen.getByText('· ID 1')).toBeInTheDocument();
    expect(screen.getByText('frontend')).toBeInTheDocument();
    expect(screen.getByText('backend')).toBeInTheDocument();
  });

  it('shows the per-network IP and says so plainly when nothing is attached', () => {
    const { unmount } = render(
      <ContainerOverview
        container={{
          ...baseContainer,
          networks: ['frontend'],
          networkIPs: { frontend: '172.18.0.4' },
        }}
      />
    );
    expect(screen.getByText('172.18.0.4')).toBeInTheDocument();
    unmount();

    render(<ContainerOverview container={{ ...baseContainer, networks: [] }} />);
    expect(screen.getByText('None attached')).toBeInTheDocument();
  });
});

describe('ContainerOverview — Labels', () => {
  const manyLabels: Record<string, string> = {
    'z.last': 'z',
    'a.first': 'a',
    'com.docker.compose.project': 'lcm',
    'com.docker.compose.service': 'web',
    'b.two': '2',
    'c.three': '3',
    'd.four': '4',
    'e.five': '5',
    'f.six': '6',
    'g.seven': '7',
  };

  it('sorts labels and collapses everything past the first eight', async () => {
    const user = userEvent.setup();
    render(<ContainerOverview container={{ ...baseContainer, labels: manyLabels }} />);

    expect(screen.getByRole('heading', { name: 'Labels (10)' })).toBeInTheDocument();

    const list = screen.getByTestId('container-labels');
    const keys = within(list)
      .getAllByTestId('label-key')
      .map((el) => el.textContent);
    expect(keys).toHaveLength(8);
    expect(keys.slice(0, 3)).toEqual(['a.first', 'b.two', 'c.three']);
    expect(screen.queryByText('z.last')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show all 10' }));
    expect(screen.getByText('z.last')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show fewer' })).toBeInTheDocument();
  });

  it('hides value-less labels and says how many it hid', () => {
    render(
      <ContainerOverview
        container={{
          ...baseContainer,
          labels: {
            'com.docker.dhi.flavor': '',
            'com.docker.dhi.shell': '',
            'org.opencontainers.image.title': 'api',
          },
        }}
      />
    );

    expect(screen.getByRole('heading', { name: 'Labels (3)' })).toBeInTheDocument();
    expect(screen.queryByText('com.docker.dhi.flavor')).not.toBeInTheDocument();
    expect(
      screen.getByText('2 labels are set with no value and are not shown.')
    ).toBeInTheDocument();
  });

  it('explains the redaction instead of rendering a bare [REDACTED] token', () => {
    render(
      <ContainerOverview
        container={{
          ...baseContainer,
          labels: { 'com.docker.compose.project.config_files': '[REDACTED]' },
        }}
      />
    );

    expect(screen.queryByText('[REDACTED]')).not.toBeInTheDocument();
    expect(screen.getByText('— host path hidden —')).toBeInTheDocument();
  });

  it('omits the Labels card entirely when there are no labels', () => {
    render(<ContainerOverview container={baseContainer} />);

    expect(screen.queryByTestId('container-labels')).not.toBeInTheDocument();
  });
});
