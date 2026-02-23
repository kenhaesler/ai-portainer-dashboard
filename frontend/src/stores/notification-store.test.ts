import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useNotificationStore } from './notification-store';

// Mock crypto.randomUUID
vi.stubGlobal('crypto', {
  randomUUID: vi.fn(() => `test-uuid-${Date.now()}-${Math.random()}`),
});

describe('useNotificationStore', () => {
  beforeEach(() => {
    useNotificationStore.setState({ notifications: [] });
  });

  it('starts with empty notifications', () => {
    expect(useNotificationStore.getState().notifications).toEqual([]);
  });

  it('adds a notification with all fields and a generated id', () => {
    const { addNotification } = useNotificationStore.getState();

    addNotification({
      type: 'error',
      title: 'Deploy Failed',
      description: 'Timeout after 30s',
      persistent: true,
    });

    const { notifications } = useNotificationStore.getState();
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      type: 'error',
      title: 'Deploy Failed',
      description: 'Timeout after 30s',
      persistent: true,
    });
    expect(notifications[0].id).toBeDefined();
  });

  it('generates unique ids across notifications', () => {
    const { addNotification } = useNotificationStore.getState();

    addNotification({ type: 'info', title: 'A' });
    addNotification({ type: 'info', title: 'B' });
    addNotification({ type: 'info', title: 'C' });

    const ids = useNotificationStore.getState().notifications.map((n) => n.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('removes only the targeted notification by id', () => {
    const { addNotification } = useNotificationStore.getState();

    addNotification({ type: 'info', title: 'Keep' });
    addNotification({ type: 'info', title: 'Remove' });
    addNotification({ type: 'info', title: 'Keep Too' });

    const idToRemove = useNotificationStore.getState().notifications[1].id;
    useNotificationStore.getState().removeNotification(idToRemove);

    const titles = useNotificationStore.getState().notifications.map((n) => n.title);
    expect(titles).toEqual(['Keep', 'Keep Too']);
  });

  it('handles remove on non-existent and empty gracefully', () => {
    // Remove from empty
    useNotificationStore.getState().removeNotification('ghost');
    expect(useNotificationStore.getState().notifications).toHaveLength(0);

    // Remove non-existent from populated
    useNotificationStore.getState().addNotification({ type: 'info', title: 'Stays' });
    useNotificationStore.getState().removeNotification('non-existent');
    expect(useNotificationStore.getState().notifications).toHaveLength(1);
  });

  it('clears all notifications and allows re-adding', () => {
    const { addNotification, clearAll } = useNotificationStore.getState();

    addNotification({ type: 'info', title: 'First' });
    addNotification({ type: 'error', title: 'Second' });
    clearAll();
    expect(useNotificationStore.getState().notifications).toHaveLength(0);

    // Re-add after clear
    addNotification({ type: 'success', title: 'After Clear' });
    expect(useNotificationStore.getState().notifications).toHaveLength(1);
    expect(useNotificationStore.getState().notifications[0].title).toBe('After Clear');
  });

  it('maintains insertion order after mixed add/remove', () => {
    const { addNotification } = useNotificationStore.getState();

    addNotification({ type: 'info', title: 'A' });
    addNotification({ type: 'info', title: 'B' });
    addNotification({ type: 'info', title: 'C' });

    const bId = useNotificationStore.getState().notifications[1].id;
    useNotificationStore.getState().removeNotification(bId);
    useNotificationStore.getState().addNotification({ type: 'info', title: 'D' });

    const titles = useNotificationStore.getState().notifications.map((n) => n.title);
    expect(titles).toEqual(['A', 'C', 'D']);
  });
});
