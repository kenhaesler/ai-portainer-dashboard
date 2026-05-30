import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GlassTooltip } from './glass-tooltip';

describe('GlassTooltip', () => {
  it('renders nothing when not active', () => {
    const { container } = render(
      <GlassTooltip active={false} payload={[{ name: 'CPU', value: 42 }]} label="12:00" />,
    );

    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when payload is empty', () => {
    const { container } = render(
      <GlassTooltip active payload={[]} label="12:00" />,
    );

    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when payload is undefined', () => {
    const { container } = render(
      <GlassTooltip active label="12:00" />,
    );

    expect(container.firstChild).toBeNull();
  });

  it('renders payload values when active', () => {
    render(
      <GlassTooltip
        active
        payload={[
          { name: 'CPU Usage', value: 42.567, color: '#ff0000' },
          { name: 'Memory', value: 78.123, color: '#00ff00' },
        ]}
        label="2024-01-15 12:00"
      />,
    );

    expect(screen.getByTestId('glass-tooltip')).toBeInTheDocument();
    expect(screen.getByText('2024-01-15 12:00')).toBeInTheDocument();
    expect(screen.getByText('CPU Usage:')).toBeInTheDocument();
    expect(screen.getByText('42.6')).toBeInTheDocument();
    expect(screen.getByText('Memory:')).toBeInTheDocument();
    expect(screen.getByText('78.1')).toBeInTheDocument();
  });

  it('renders without label when label is not provided', () => {
    render(
      <GlassTooltip
        active
        payload={[{ name: 'CPU', value: 50 }]}
      />,
    );

    expect(screen.getByTestId('glass-tooltip')).toBeInTheDocument();
    expect(screen.getByText('CPU:')).toBeInTheDocument();
  });

  it('renders color indicators when color is provided', () => {
    const { container } = render(
      <GlassTooltip
        active
        payload={[{ name: 'CPU', value: 50, color: '#ff0000' }]}
      />,
    );

    const colorDot = container.querySelector('span[style*="background-color"]');
    expect(colorDot).toBeInTheDocument();
  });
});
