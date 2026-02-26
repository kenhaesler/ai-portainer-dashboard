import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ActivityFeed } from './activity-feed';
import { useActivityFeedStore } from '@/stores/activity-feed-store';

// Mock react-router-dom
const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

// Mock socket provider
const mockMonitoringSocket = {
  on: vi.fn(),
  off: vi.fn(),
  connected: true,
};

vi.mock('@/providers/socket-provider', () => ({
  useSockets: () => ({
    monitoringSocket: mockMonitoringSocket,
    connected: true,
  }),
}));

// Mock theme store
vi.mock('@/stores/theme-store', () => ({
  useThemeStore: (selector: (s: { dashboardBackground: string }) => string) =>
    selector({ dashboardBackground: 'none' }),
}));

// Mock AudioContext
const mockOscillator = {
  type: '',
  frequency: { value: 0 },
  connect: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
};

const mockGain = {
  gain: {
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  },
  connect: vi.fn(),
};

vi.stubGlobal('AudioContext', vi.fn(function () {
  return {
    currentTime: 0,
    destination: {},
    createOscillator: () => mockOscillator,
    createGain: () => mockGain,
  };
}));

describe('ActivityFeed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMonitoringSocket.on.mockClear();
    mockMonitoringSocket.off.mockClear();
    useActivityFeedStore.setState({
      events: [],
      collapsed: true,
      unreadCount: 0,
    });
  });

  it('should render the activity feed bar', () => {
    render(<ActivityFeed />);
    expect(screen.getByText('Activity Feed')).toBeInTheDocument();
  });

  it('should subscribe to monitoring socket events', () => {
    render(<ActivityFeed />);

    const monitoringEvents = mockMonitoringSocket.on.mock.calls.map(
      (c: string[]) => c[0],
    );
    expect(monitoringEvents).toContain('insights:new');
    expect(monitoringEvents).toContain('connect');
    expect(monitoringEvents).toContain('disconnect');
  });

  it('should show "No activity yet" when no events exist', () => {
    useActivityFeedStore.setState({ collapsed: false });
    render(<ActivityFeed />);
    expect(screen.getByText('No activity yet')).toBeInTheDocument();
  });

  it('should display unread count badge', () => {
    useActivityFeedStore.setState({ unreadCount: 3 });
    render(<ActivityFeed />);
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('should show event count in collapsed bar', () => {
    useActivityFeedStore.getState().addEvent({
      type: 'insight',
      severity: 'info',
      message: 'Test event',
    });
    render(<ActivityFeed />);
    expect(screen.getByText('1 events')).toBeInTheDocument();
  });

  it('should display events when expanded', () => {
    useActivityFeedStore.getState().addEvent({
      type: 'insight',
      severity: 'info',
      message: 'Test insight event',
    });
    useActivityFeedStore.setState({ collapsed: false });

    render(<ActivityFeed />);
    expect(screen.getByText('Test insight event')).toBeInTheDocument();
  });

  it('should add insight event when insights:new fires', () => {
    render(<ActivityFeed />);

    const insightsHandler = mockMonitoringSocket.on.mock.calls.find(
      (c: string[]) => c[0] === 'insights:new',
    )?.[1] as (insight: { severity: string; title: string; container_name?: string }) => void;

    expect(insightsHandler).toBeDefined();
    insightsHandler({ severity: 'warning', title: 'High CPU usage', container_name: 'web-app' });

    const state = useActivityFeedStore.getState();
    expect(state.events[0].type).toBe('insight');
    expect(state.events[0].severity).toBe('warning');
    expect(state.events[0].message).toBe('High CPU usage (web-app)');
    expect(state.events[0].link).toBe('/ai-monitor');
  });

  it('should add connection event on connect/disconnect', () => {
    render(<ActivityFeed />);

    const connectHandler = mockMonitoringSocket.on.mock.calls.find(
      (c: string[]) => c[0] === 'connect',
    )?.[1] as () => void;

    const disconnectHandler = mockMonitoringSocket.on.mock.calls.find(
      (c: string[]) => c[0] === 'disconnect',
    )?.[1] as () => void;

    expect(connectHandler).toBeDefined();
    expect(disconnectHandler).toBeDefined();

    connectHandler();
    const stateAfterConnect = useActivityFeedStore.getState();
    expect(stateAfterConnect.events[0].type).toBe('connection');
    expect(stateAfterConnect.events[0].severity).toBe('success');
    expect(stateAfterConnect.events[0].message).toBe('WebSocket connected');

    disconnectHandler();
    const stateAfterDisconnect = useActivityFeedStore.getState();
    expect(stateAfterDisconnect.events[0].type).toBe('connection');
    expect(stateAfterDisconnect.events[0].severity).toBe('error');
    expect(stateAfterDisconnect.events[0].message).toBe('WebSocket disconnected');
  });
});
