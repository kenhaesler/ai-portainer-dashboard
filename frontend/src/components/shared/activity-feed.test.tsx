import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ActivityFeed } from './activity-feed';
import { useActivityFeedStore, EVENT_TYPES, SEVERITIES } from '@/stores/activity-feed-store';

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
const mockRemediationSocket = {
  on: vi.fn(),
  off: vi.fn(),
  connected: true,
};

vi.mock('@/providers/socket-provider', () => ({
  useSockets: () => ({
    monitoringSocket: mockMonitoringSocket,
    remediationSocket: mockRemediationSocket,
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

vi.stubGlobal('AudioContext', vi.fn().mockImplementation(() => ({
  currentTime: 0,
  destination: {},
  createOscillator: () => mockOscillator,
  createGain: () => mockGain,
})));

describe('ActivityFeed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMonitoringSocket.on.mockClear();
    mockMonitoringSocket.off.mockClear();
    mockRemediationSocket.on.mockClear();
    mockRemediationSocket.off.mockClear();
    useActivityFeedStore.setState({
      events: [],
      collapsed: true,
      unreadCount: 0,
      filters: {
        eventTypes: new Set(EVENT_TYPES),
        severities: new Set(SEVERITIES),
      },
      preferences: {
        desktopNotifications: false,
        soundNotifications: false,
        notificationPermission: 'default',
      },
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

  it('should subscribe to remediation socket events', () => {
    render(<ActivityFeed />);

    const remediationEvents = mockRemediationSocket.on.mock.calls.map(
      (c: string[]) => c[0],
    );
    expect(remediationEvents).toContain('actions:new');
    expect(remediationEvents).toContain('actions:updated');
  });

  it('should add remediation event when actions:new fires', () => {
    render(<ActivityFeed />);

    const actionsNewHandler = mockRemediationSocket.on.mock.calls.find(
      (c: string[]) => c[0] === 'actions:new',
    )?.[1] as (action: { title: string; status: string }) => void;

    expect(actionsNewHandler).toBeDefined();
    actionsNewHandler({ title: 'Restart container', status: 'pending' });

    const state = useActivityFeedStore.getState();
    expect(state.events[0].type).toBe('remediation');
    expect(state.events[0].message).toBe('Restart container');
    expect(state.events[0].link).toBe('/remediation');
  });

  it('should add remediation event when actions:updated fires', () => {
    render(<ActivityFeed />);

    const actionsUpdatedHandler = mockRemediationSocket.on.mock.calls.find(
      (c: string[]) => c[0] === 'actions:updated',
    )?.[1] as (action: { title: string; status: string }) => void;

    expect(actionsUpdatedHandler).toBeDefined();
    actionsUpdatedHandler({ title: 'Restart container', status: 'completed' });

    const state = useActivityFeedStore.getState();
    expect(state.events[0].type).toBe('remediation');
    expect(state.events[0].severity).toBe('success');
    expect(state.events[0].message).toContain('completed');
  });

  it('should show filter chips when expanded', () => {
    useActivityFeedStore.setState({ collapsed: false });
    render(<ActivityFeed />);

    expect(screen.getByText('Container')).toBeInTheDocument();
    expect(screen.getByText('Anomaly')).toBeInTheDocument();
    expect(screen.getByText('Insight')).toBeInTheDocument();
    expect(screen.getByText('Connection')).toBeInTheDocument();
    expect(screen.getByText('Incident')).toBeInTheDocument();
    expect(screen.getByText('Remediation')).toBeInTheDocument();
    expect(screen.getByText('Success')).toBeInTheDocument();
    expect(screen.getByText('Warning')).toBeInTheDocument();
    expect(screen.getByText('Error')).toBeInTheDocument();
    expect(screen.getByText('Info')).toBeInTheDocument();
  });

  it('should filter events by type when chip is toggled', () => {
    // Add events of different types
    useActivityFeedStore.getState().addEvent({
      type: 'insight',
      severity: 'info',
      message: 'Insight event',
    });
    useActivityFeedStore.getState().addEvent({
      type: 'container',
      severity: 'info',
      message: 'Container event',
    });

    useActivityFeedStore.setState({ collapsed: false });
    render(<ActivityFeed />);

    // Both should be visible
    expect(screen.getByText('Container event')).toBeInTheDocument();
    expect(screen.getByText('Insight event')).toBeInTheDocument();

    // Click the Container chip to disable it
    fireEvent.click(screen.getByText('Container'));

    // Container event should be gone
    expect(screen.queryByText('Container event')).not.toBeInTheDocument();
    expect(screen.getByText('Insight event')).toBeInTheDocument();
  });

  it('should filter events by severity when chip is toggled', () => {
    useActivityFeedStore.getState().addEvent({
      type: 'insight',
      severity: 'info',
      message: 'Info event',
    });
    useActivityFeedStore.getState().addEvent({
      type: 'insight',
      severity: 'error',
      message: 'Error event',
    });

    useActivityFeedStore.setState({ collapsed: false });
    render(<ActivityFeed />);

    expect(screen.getByText('Info event')).toBeInTheDocument();
    expect(screen.getByText('Error event')).toBeInTheDocument();

    // Click the Info severity chip to disable it
    fireEvent.click(screen.getByText('Info'));

    expect(screen.queryByText('Info event')).not.toBeInTheDocument();
    expect(screen.getByText('Error event')).toBeInTheDocument();
  });

  it('should show filtered count when filters are active', () => {
    useActivityFeedStore.getState().addEvent({
      type: 'insight',
      severity: 'info',
      message: 'Event 1',
    });
    useActivityFeedStore.getState().addEvent({
      type: 'container',
      severity: 'info',
      message: 'Event 2',
    });

    useActivityFeedStore.setState({ collapsed: false });
    render(<ActivityFeed />);

    // Disable container type
    fireEvent.click(screen.getByText('Container'));

    // Should show filtered count
    expect(screen.getByText(/1\/2/)).toBeInTheDocument();
  });

  it('should show "No events match filters" when all filtered out', () => {
    useActivityFeedStore.getState().addEvent({
      type: 'insight',
      severity: 'info',
      message: 'Event 1',
    });

    // Disable insight type
    useActivityFeedStore.getState().setEventTypeFilter('insight', false);
    useActivityFeedStore.setState({ collapsed: false });

    render(<ActivityFeed />);
    expect(screen.getByText('No events match filters')).toBeInTheDocument();
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
});
