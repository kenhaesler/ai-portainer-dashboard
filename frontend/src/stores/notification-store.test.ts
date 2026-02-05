import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useNotificationStore } from './notification-store';

// Mock crypto.randomUUID
vi.stubGlobal('crypto', {
  randomUUID: vi.fn(() => `test-uuid-${Date.now()}-${Math.random()}`),
});

describe('useNotificationStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useNotificationStore.setState({ notifications: [] });
  });

  describe('initial state', () => {
    it('should have empty notifications array', () => {
      const state = useNotificationStore.getState();
      expect(state.notifications).toEqual([]);
    });
  });

  describe('addNotification', () => {
    it('should add a notification with generated id', () => {
      const { addNotification } = useNotificationStore.getState();

      addNotification({
        type: 'success',
        title: 'Test Success',
      });

      const { notifications } = useNotificationStore.getState();
      expect(notifications).toHaveLength(1);
      expect(notifications[0].type).toBe('success');
      expect(notifications[0].title).toBe('Test Success');
      expect(notifications[0].id).toBeDefined();
    });

    it('should add notification with description', () => {
      const { addNotification } = useNotificationStore.getState();

      addNotification({
        type: 'error',
        title: 'Error Title',
        description: 'Error description here',
      });

      const { notifications } = useNotificationStore.getState();
      expect(notifications[0].description).toBe('Error description here');
    });

    it('should add persistent notification', () => {
      const { addNotification } = useNotificationStore.getState();

      addNotification({
        type: 'warning',
        title: 'Persistent Warning',
        persistent: true,
      });

      const { notifications } = useNotificationStore.getState();
      expect(notifications[0].persistent).toBe(true);
    });

    it('should add multiple notifications', () => {
      const { addNotification } = useNotificationStore.getState();

      addNotification({ type: 'success', title: 'First' });
      addNotification({ type: 'error', title: 'Second' });
      addNotification({ type: 'info', title: 'Third' });

      const { notifications } = useNotificationStore.getState();
      expect(notifications).toHaveLength(3);
      expect(notifications[0].title).toBe('First');
      expect(notifications[1].title).toBe('Second');
      expect(notifications[2].title).toBe('Third');
    });

    it('should support all notification types', () => {
      const { addNotification } = useNotificationStore.getState();

      addNotification({ type: 'success', title: 'Success' });
      addNotification({ type: 'error', title: 'Error' });
      addNotification({ type: 'warning', title: 'Warning' });
      addNotification({ type: 'info', title: 'Info' });

      const { notifications } = useNotificationStore.getState();
      expect(notifications[0].type).toBe('success');
      expect(notifications[1].type).toBe('error');
      expect(notifications[2].type).toBe('warning');
      expect(notifications[3].type).toBe('info');
    });

    it('should generate unique ids for each notification', () => {
      const { addNotification } = useNotificationStore.getState();

      addNotification({ type: 'info', title: 'Notification 1' });
      addNotification({ type: 'info', title: 'Notification 2' });
      addNotification({ type: 'info', title: 'Notification 3' });

      const { notifications } = useNotificationStore.getState();
      const ids = notifications.map((n) => n.id);
      const uniqueIds = new Set(ids);

      expect(uniqueIds.size).toBe(3);
    });
  });

  describe('removeNotification', () => {
    it('should remove notification by id', () => {
      const { addNotification, removeNotification } = useNotificationStore.getState();

      addNotification({ type: 'info', title: 'To Remove' });
      const { notifications } = useNotificationStore.getState();
      const id = notifications[0].id;

      removeNotification(id);

      expect(useNotificationStore.getState().notifications).toHaveLength(0);
    });

    it('should only remove the specified notification', () => {
      const { addNotification, removeNotification } = useNotificationStore.getState();

      addNotification({ type: 'info', title: 'Keep 1' });
      addNotification({ type: 'info', title: 'Remove Me' });
      addNotification({ type: 'info', title: 'Keep 2' });

      const { notifications: beforeRemoval } = useNotificationStore.getState();
      const idToRemove = beforeRemoval[1].id;

      removeNotification(idToRemove);

      const { notifications } = useNotificationStore.getState();
      expect(notifications).toHaveLength(2);
      expect(notifications[0].title).toBe('Keep 1');
      expect(notifications[1].title).toBe('Keep 2');
    });

    it('should do nothing when removing non-existent id', () => {
      const { addNotification, removeNotification } = useNotificationStore.getState();

      addNotification({ type: 'info', title: 'Existing' });
      removeNotification('non-existent-id');

      expect(useNotificationStore.getState().notifications).toHaveLength(1);
    });

    it('should handle removing from empty array', () => {
      const { removeNotification } = useNotificationStore.getState();

      removeNotification('any-id');

      expect(useNotificationStore.getState().notifications).toHaveLength(0);
    });
  });

  describe('clearAll', () => {
    it('should remove all notifications', () => {
      const { addNotification, clearAll } = useNotificationStore.getState();

      addNotification({ type: 'info', title: 'First' });
      addNotification({ type: 'error', title: 'Second' });
      addNotification({ type: 'warning', title: 'Third' });

      clearAll();

      expect(useNotificationStore.getState().notifications).toHaveLength(0);
    });

    it('should work when already empty', () => {
      const { clearAll } = useNotificationStore.getState();

      clearAll();

      expect(useNotificationStore.getState().notifications).toHaveLength(0);
    });

    it('should allow adding notifications after clear', () => {
      const { addNotification, clearAll } = useNotificationStore.getState();

      addNotification({ type: 'info', title: 'Before Clear' });
      clearAll();
      addNotification({ type: 'success', title: 'After Clear' });

      const { notifications } = useNotificationStore.getState();
      expect(notifications).toHaveLength(1);
      expect(notifications[0].title).toBe('After Clear');
    });
  });

  describe('combined operations', () => {
    it('should handle rapid add/remove operations', () => {
      const { addNotification, removeNotification } = useNotificationStore.getState();

      // Add several notifications
      for (let i = 0; i < 10; i++) {
        addNotification({ type: 'info', title: `Notification ${i}` });
      }

      // Remove every other one
      const { notifications } = useNotificationStore.getState();
      notifications.forEach((n, i) => {
        if (i % 2 === 0) {
          removeNotification(n.id);
        }
      });

      expect(useNotificationStore.getState().notifications).toHaveLength(5);
    });

    it('should maintain order after operations', () => {
      const { addNotification, removeNotification } = useNotificationStore.getState();

      addNotification({ type: 'info', title: 'A' });
      addNotification({ type: 'info', title: 'B' });
      addNotification({ type: 'info', title: 'C' });

      // Remove B
      const { notifications: before } = useNotificationStore.getState();
      const bId = before[1].id;
      removeNotification(bId);

      // Add D
      addNotification({ type: 'info', title: 'D' });

      const { notifications } = useNotificationStore.getState();
      expect(notifications.map((n) => n.title)).toEqual(['A', 'C', 'D']);
    });
  });
});
