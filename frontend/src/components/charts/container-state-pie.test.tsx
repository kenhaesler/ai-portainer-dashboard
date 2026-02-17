import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ContainerStatePie } from './container-state-pie';

describe('ContainerStatePie', () => {
  it('shows empty state when all counts are zero', () => {
    render(<ContainerStatePie running={0} stopped={0} unhealthy={0} />);
    expect(screen.getByText('No container data')).toBeInTheDocument();
  });

  it('displays total count', () => {
    render(<ContainerStatePie running={3} stopped={1} unhealthy={1} />);
    // Total label (center of donut) shows sum of all states
    expect(screen.getByText('Total')).toBeInTheDocument();
    // The center total (5) differs from individual legend counts (3, 1, 1)
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('renders only the Running legend when all containers are running', () => {
    render(<ContainerStatePie running={5} stopped={0} unhealthy={0} />);
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.queryByText('Stopped')).not.toBeInTheDocument();
    expect(screen.queryByText('Unhealthy')).not.toBeInTheDocument();
  });

  it('renders multiple legend entries for mixed states', () => {
    render(<ContainerStatePie running={3} stopped={1} unhealthy={1} />);
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByText('Stopped')).toBeInTheDocument();
    expect(screen.getByText('Unhealthy')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('includes Paused legend only when paused > 0', () => {
    render(<ContainerStatePie running={2} stopped={0} unhealthy={0} paused={1} />);
    expect(screen.getByText('Paused')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('does not include Paused legend when paused is 0', () => {
    render(<ContainerStatePie running={2} stopped={1} unhealthy={0} paused={0} />);
    expect(screen.queryByText('Paused')).not.toBeInTheDocument();
  });

  it('uses flex layout so chart fills available parent height', () => {
    const { container } = render(<ContainerStatePie running={3} stopped={1} unhealthy={0} />);
    const outerDiv = container.firstElementChild as HTMLElement;
    expect(outerDiv.className).toContain('flex');
    expect(outerDiv.className).toContain('h-full');
    expect(outerDiv.className).toContain('flex-col');
  });

  it('scopes center label inside a relative wrapper separate from legend', () => {
    const { container } = render(<ContainerStatePie running={3} stopped={1} unhealthy={0} />);
    const outerDiv = container.firstElementChild as HTMLElement;
    // First child should be the chart+label wrapper with relative positioning
    const chartWrapper = outerDiv.children[0] as HTMLElement;
    expect(chartWrapper.className).toContain('relative');
    expect(chartWrapper.className).toContain('flex-1');
    // Center label should be inside the chart wrapper, not a sibling of the legend
    const centerLabel = chartWrapper.querySelector('[class*="absolute"]');
    expect(centerLabel).not.toBeNull();
    expect(centerLabel!.textContent).toContain('Total');
  });

  it('handles large container counts without clipping', () => {
    render(<ContainerStatePie running={150} stopped={80} unhealthy={20} paused={10} />);
    expect(screen.getByText('260')).toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByText('Stopped')).toBeInTheDocument();
    expect(screen.getByText('Unhealthy')).toBeInTheDocument();
    expect(screen.getByText('Paused')).toBeInTheDocument();
  });
});
