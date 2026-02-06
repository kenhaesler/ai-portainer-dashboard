import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConnectionOrb } from './connection-orb';

// Mock socket provider
const mockUseSockets = vi.fn();
vi.mock('@/providers/socket-provider', () => ({
  useSockets: () => mockUseSockets(),
}));

function stubMatchMedia() {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe('ConnectionOrb', () => {
  beforeEach(() => {
    stubMatchMedia();
    vi.clearAllMocks();
  });

  it('should render a status indicator', () => {
    mockUseSockets.mockReturnValue({
      connected: false,
      monitoringSocket: null,
    });

    const { container } = render(<ConnectionOrb />);
    const orb = container.querySelector('[role="status"]');
    expect(orb).toBeInTheDocument();
  });

  it('should show disconnected state when not connected', () => {
    mockUseSockets.mockReturnValue({
      connected: false,
      monitoringSocket: null,
    });

    const { container } = render(<ConnectionOrb />);
    const orb = container.querySelector('[role="status"]');
    expect(orb).toHaveClass('bg-red-500');
  });

  it('should show connected state when connected', () => {
    const mockSocket = {
      connected: true,
      on: vi.fn(),
      off: vi.fn(),
    };
    mockUseSockets.mockReturnValue({
      connected: true,
      monitoringSocket: mockSocket,
    });

    const { container } = render(<ConnectionOrb />);
    const orb = container.querySelector('[role="status"]');
    expect(orb).toHaveClass('bg-emerald-500');
  });

  it('should show tooltip on hover', () => {
    mockUseSockets.mockReturnValue({
      connected: false,
      monitoringSocket: null,
    });

    const { container } = render(<ConnectionOrb />);
    fireEvent.mouseEnter(container.firstChild!);
    expect(screen.getByText('Disconnected')).toBeInTheDocument();
  });

  it('should hide tooltip on mouse leave', () => {
    mockUseSockets.mockReturnValue({
      connected: false,
      monitoringSocket: null,
    });

    const { container } = render(<ConnectionOrb />);
    fireEvent.mouseEnter(container.firstChild!);
    expect(screen.getByText('Disconnected')).toBeInTheDocument();

    fireEvent.mouseLeave(container.firstChild!);
    expect(screen.queryByText('Disconnected')).not.toBeInTheDocument();
  });

  it('should have proper aria-label', () => {
    mockUseSockets.mockReturnValue({
      connected: false,
      monitoringSocket: null,
    });

    const { container } = render(<ConnectionOrb />);
    const orb = container.querySelector('[role="status"]');
    expect(orb).toHaveAttribute('aria-label', 'WebSocket Disconnected');
  });
});
