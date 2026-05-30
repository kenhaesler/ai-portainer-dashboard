import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NetworkTrafficTooltip } from './network-traffic-tooltip';

describe('NetworkTrafficTooltip', () => {
  it('renders nothing when not active', () => {
    const { container } = render(
      <NetworkTrafficTooltip active={false} payload={[{ name: 'RX', value: 10 }]} label="net-a" />,
    );

    expect(container.firstChild).toBeNull();
  });

  it('renders formatted values when active', () => {
    render(
      <NetworkTrafficTooltip
        active
        label="net-a"
        payload={[
          { name: 'RX', value: 1024 * 1024, color: '#00f' },
          { name: 'TX', value: 2 * 1024 * 1024, color: '#f90' },
        ]}
        formatValue={(value) => `${(value / (1024 * 1024)).toFixed(2)} MB/s`}
      />,
    );

    expect(screen.getByText('net-a')).toBeInTheDocument();
    expect(screen.getByText('RX:')).toBeInTheDocument();
    expect(screen.getByText('1.00 MB/s')).toBeInTheDocument();
    expect(screen.getByText('TX:')).toBeInTheDocument();
    expect(screen.getByText('2.00 MB/s')).toBeInTheDocument();
  });
});
