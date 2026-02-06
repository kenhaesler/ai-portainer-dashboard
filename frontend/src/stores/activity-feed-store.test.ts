import { describe, it, expect, beforeEach } from 'vitest';
import { useActivityFeedStore } from './activity-feed-store';

describe('ActivityFeedStore', () => {
  beforeEach(() => {
    useActivityFeedStore.setState({
      events: [],
      collapsed: true,
      unreadCount: 0,
    });
  });

  it('should start with empty events', () => {
    const state = useActivityFeedStore.getState();
    expect(state.events).toHaveLength(0);
    expect(state.collapsed).toBe(true);
    expect(state.unreadCount).toBe(0);
  });

  it('should add an event with auto-generated id and timestamp', () => {
    useActivityFeedStore.getState().addEvent({
      type: 'insight',
      severity: 'warning',
      message: 'High CPU detected',
    });

    const state = useActivityFeedStore.getState();
    expect(state.events).toHaveLength(1);
    expect(state.events[0].message).toBe('High CPU detected');
    expect(state.events[0].id).toBeDefined();
    expect(state.events[0].timestamp).toBeGreaterThan(0);
  });

  it('should prepend new events (most recent first)', () => {
    const { addEvent } = useActivityFeedStore.getState();
    addEvent({ type: 'insight', severity: 'info', message: 'First' });
    addEvent({ type: 'insight', severity: 'info', message: 'Second' });

    const state = useActivityFeedStore.getState();
    expect(state.events[0].message).toBe('Second');
    expect(state.events[1].message).toBe('First');
  });

  it('should cap events at 50 (ring buffer)', () => {
    const { addEvent } = useActivityFeedStore.getState();
    for (let i = 0; i < 60; i++) {
      addEvent({ type: 'insight', severity: 'info', message: `Event ${i}` });
    }

    const state = useActivityFeedStore.getState();
    expect(state.events).toHaveLength(50);
    expect(state.events[0].message).toBe('Event 59');
  });

  it('should increment unread count when collapsed', () => {
    useActivityFeedStore.setState({ collapsed: true });

    useActivityFeedStore.getState().addEvent({
      type: 'insight', severity: 'info', message: 'New event',
    });
    useActivityFeedStore.getState().addEvent({
      type: 'insight', severity: 'info', message: 'Another event',
    });

    expect(useActivityFeedStore.getState().unreadCount).toBe(2);
  });

  it('should reset unread count when toggling to expanded', () => {
    useActivityFeedStore.setState({ collapsed: true, unreadCount: 5 });
    useActivityFeedStore.getState().toggleCollapsed();

    expect(useActivityFeedStore.getState().collapsed).toBe(false);
    expect(useActivityFeedStore.getState().unreadCount).toBe(0);
  });

  it('should toggle collapsed state', () => {
    expect(useActivityFeedStore.getState().collapsed).toBe(true);
    useActivityFeedStore.getState().toggleCollapsed();
    expect(useActivityFeedStore.getState().collapsed).toBe(false);
    useActivityFeedStore.getState().toggleCollapsed();
    expect(useActivityFeedStore.getState().collapsed).toBe(true);
  });

  it('should mark all as read', () => {
    useActivityFeedStore.setState({ unreadCount: 10 });
    useActivityFeedStore.getState().markAllRead();
    expect(useActivityFeedStore.getState().unreadCount).toBe(0);
  });

  it('should clear all events', () => {
    useActivityFeedStore.getState().addEvent({
      type: 'insight', severity: 'info', message: 'Test',
    });
    useActivityFeedStore.getState().clearAll();

    const state = useActivityFeedStore.getState();
    expect(state.events).toHaveLength(0);
    expect(state.unreadCount).toBe(0);
  });

  it('should support optional link in events', () => {
    useActivityFeedStore.getState().addEvent({
      type: 'insight',
      severity: 'error',
      message: 'Critical anomaly',
      link: '/ai-monitor',
    });

    const state = useActivityFeedStore.getState();
    expect(state.events[0].link).toBe('/ai-monitor');
  });
});
