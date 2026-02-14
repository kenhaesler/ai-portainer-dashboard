import { useState, useEffect, useMemo } from 'react';
import {
  Activity,
  AlertTriangle,
  Bell,
  Info,
  Loader2,
  RefreshCw,
  Send,
} from 'lucide-react';
import { SettingsSection, DEFAULT_SETTINGS, type SettingsTabProps } from './shared';
import { ThemedSelect } from '@/components/shared/themed-select';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { toast } from 'sonner';

export function MonitoringTab({ editedValues, originalValues, onChange, isSaving }: SettingsTabProps) {
  return (
    <div className="space-y-6">
      {/* Monitoring Settings */}
      <SettingsSection
        title="Monitoring"
        icon={<Activity className="h-5 w-5" />}
        category="monitoring"
        settings={DEFAULT_SETTINGS.monitoring}
        values={editedValues}
        originalValues={originalValues}
        onChange={onChange}
        requiresRestart
        disabled={isSaving}
        status={editedValues['monitoring.enabled'] === 'true' ? 'configured' : 'not-configured'}
        statusLabel={editedValues['monitoring.enabled'] === 'true' ? 'Enabled' : 'Disabled'}
      />

      {/* Anomaly Detection Settings */}
      <SettingsSection
        title="Anomaly Detection"
        icon={<AlertTriangle className="h-5 w-5" />}
        category="anomaly"
        settings={DEFAULT_SETTINGS.anomaly}
        values={editedValues}
        originalValues={originalValues}
        onChange={onChange}
        disabled={isSaving}
        status={editedValues['anomaly.detection_enabled'] === 'true' ? 'configured' : 'not-configured'}
        statusLabel={editedValues['anomaly.detection_enabled'] === 'true' ? 'Enabled' : 'Disabled'}
      />

      {/* Notification Settings */}
      <SettingsSection
        title="Notifications"
        icon={<Bell className="h-5 w-5" />}
        category="notifications"
        settings={DEFAULT_SETTINGS.notifications}
        values={editedValues}
        originalValues={originalValues}
        onChange={onChange}
        requiresRestart
        disabled={isSaving}
        footerContent={<NotificationTestButtons />}
        status={
          editedValues['notifications.teams_enabled'] === 'true' || editedValues['notifications.email_enabled'] === 'true' || editedValues['notifications.discord_enabled'] === 'true' || editedValues['notifications.telegram_enabled'] === 'true'
            ? 'configured'
            : 'not-configured'
        }
        statusLabel={
          editedValues['notifications.teams_enabled'] === 'true' || editedValues['notifications.email_enabled'] === 'true' || editedValues['notifications.discord_enabled'] === 'true' || editedValues['notifications.telegram_enabled'] === 'true'
            ? 'Enabled'
            : 'Disabled'
        }
      />

      {/* Notification History */}
      <NotificationHistoryPanel />
    </div>
  );
}

export function NotificationTestButtons() {
  const [testingChannel, setTestingChannel] = useState<string | null>(null);

  const handleTest = async (channel: 'teams' | 'email' | 'discord' | 'telegram') => {
    setTestingChannel(channel);
    try {
      const result = await api.post<{ success: boolean; error?: string }>('/api/notifications/test', { channel });
      if (result.success) {
        toast.success(`Test ${channel} notification sent successfully`);
      } else {
        toast.error(`Failed to send test ${channel} notification: ${result.error || 'Unknown error'}`);
      }
    } catch (err) {
      toast.error(`Failed to send test ${channel} notification: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setTestingChannel(null);
    }
  };

  const channels: { id: 'teams' | 'email' | 'discord' | 'telegram'; label: string }[] = [
    { id: 'teams', label: 'Test Teams' },
    { id: 'email', label: 'Test Email' },
    { id: 'discord', label: 'Test Discord' },
    { id: 'telegram', label: 'Test Telegram' },
  ];

  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card p-4">
      <Info className="h-4 w-4 text-muted-foreground shrink-0" />
      <span className="text-sm text-muted-foreground">Send a test notification to verify your configuration:</span>
      <div className="flex flex-wrap items-center gap-2 ml-auto">
        {channels.map((ch) => (
          <button
            key={ch.id}
            onClick={() => handleTest(ch.id)}
            disabled={testingChannel !== null}
            className="flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            {testingChannel === ch.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            {ch.label}
          </button>
        ))}
      </div>
    </div>
  );
}

interface NotificationHistoryEntry {
  id: number;
  channel: 'teams' | 'email' | 'discord' | 'telegram';
  event_type: string;
  title: string;
  body: string;
  severity: string;
  status: 'sent' | 'failed';
  error: string | null;
  container_name: string | null;
  created_at: string;
}

interface NotificationHistoryResponse {
  entries: NotificationHistoryEntry[];
  total: number;
  limit: number;
  offset: number;
}

type ChannelFilter = 'all' | 'teams' | 'email' | 'discord' | 'telegram';
type StatusFilter = 'all' | 'sent' | 'failed';
type DateRangeFilter = 'all' | '24h' | '7d' | '30d';

export function NotificationHistoryPanel() {
  const [entries, setEntries] = useState<NotificationHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [dateRangeFilter, setDateRangeFilter] = useState<DateRangeFilter>('7d');

  const fetchHistory = async (channel: ChannelFilter) => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string | number | undefined> = {
        limit: 200,
        offset: 0,
        channel: channel === 'all' ? undefined : channel,
      };
      const response = await api.get<NotificationHistoryResponse>('/api/notifications/history', { params });
      setEntries(response.entries);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load notification history');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchHistory(channelFilter);
  }, [channelFilter]);

  const filteredEntries = useMemo(() => {
    const now = Date.now();

    return entries.filter((entry) => {
      if (statusFilter !== 'all' && entry.status !== statusFilter) {
        return false;
      }

      if (dateRangeFilter !== 'all') {
        const createdAt = new Date(entry.created_at).getTime();
        const ageMs = now - createdAt;
        const thresholds: Record<Exclude<DateRangeFilter, 'all'>, number> = {
          '24h': 24 * 60 * 60 * 1000,
          '7d': 7 * 24 * 60 * 60 * 1000,
          '30d': 30 * 24 * 60 * 60 * 1000,
        };
        if (ageMs > thresholds[dateRangeFilter]) {
          return false;
        }
      }

      return true;
    });
  }, [dateRangeFilter, entries, statusFilter]);

  const sentCount = filteredEntries.filter((entry) => entry.status === 'sent').length;
  const failedCount = filteredEntries.filter((entry) => entry.status === 'failed').length;

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
        <div className="flex items-center gap-2">
          <Bell className="h-5 w-5" />
          <h2 className="text-lg font-semibold">Notification History</h2>
        </div>
        <button
          type="button"
          onClick={() => void fetchHistory(channelFilter)}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Refresh
        </button>
      </div>

      <div className="border-b p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Channel
            </label>
            <ThemedSelect
              value={channelFilter}
              onValueChange={(val) => setChannelFilter(val as ChannelFilter)}
              options={[
                { value: 'all', label: 'All' },
                { value: 'teams', label: 'Teams' },
                { value: 'email', label: 'Email' },
                { value: 'discord', label: 'Discord' },
                { value: 'telegram', label: 'Telegram' },
              ]}
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Status
            </label>
            <ThemedSelect
              value={statusFilter}
              onValueChange={(val) => setStatusFilter(val as StatusFilter)}
              options={[
                { value: 'all', label: 'All' },
                { value: 'sent', label: 'Sent' },
                { value: 'failed', label: 'Failed' },
              ]}
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Date Range
            </label>
            <ThemedSelect
              value={dateRangeFilter}
              onValueChange={(val) => setDateRangeFilter(val as DateRangeFilter)}
              options={[
                { value: '24h', label: 'Last 24 Hours' },
                { value: '7d', label: 'Last 7 Days' },
                { value: '30d', label: 'Last 30 Days' },
                { value: 'all', label: 'All Time' },
              ]}
            />
          </div>
          <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            <span className="rounded-full bg-emerald-500/15 px-2 py-1 text-emerald-700 dark:text-emerald-400">Sent: {sentCount}</span>
            <span className="rounded-full bg-red-500/15 px-2 py-1 text-red-700 dark:text-red-400">Failed: {failedCount}</span>
          </div>
        </div>
      </div>

      {error ? (
        <div className="p-4">
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4">
            <p className="font-medium text-destructive">Failed to load notification history</p>
            <p className="mt-1 text-sm text-muted-foreground">{error}</p>
          </div>
        </div>
      ) : loading ? (
        <div className="space-y-2 p-4">
          <div className="h-10 animate-pulse rounded bg-muted" />
          <div className="h-10 animate-pulse rounded bg-muted" />
          <div className="h-10 animate-pulse rounded bg-muted" />
        </div>
      ) : filteredEntries.length === 0 ? (
        <div className="p-8 text-center">
          <p className="text-sm font-medium">No notification history found</p>
          <p className="mt-1 text-sm text-muted-foreground">Try adjusting channel, status, or date filters.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Time</th>
                <th className="px-4 py-2.5 font-medium">Channel</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Event</th>
                <th className="px-4 py-2.5 font-medium">Message</th>
                <th className="px-4 py-2.5 font-medium">Error</th>
              </tr>
            </thead>
            <tbody>
              {filteredEntries.map((entry) => (
                <tr key={entry.id} className="border-b last:border-0">
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {new Date(entry.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex rounded-full bg-muted px-2 py-1 text-xs capitalize">
                      {entry.channel}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        'inline-flex rounded-full px-2 py-1 text-xs font-medium',
                        entry.status === 'sent'
                          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                          : 'bg-red-500/15 text-red-700 dark:text-red-400'
                      )}
                    >
                      {entry.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium">{entry.title}</p>
                    <p className="text-xs text-muted-foreground">{entry.event_type}</p>
                  </td>
                  <td className="max-w-[380px] px-4 py-3 text-xs text-muted-foreground">
                    <p className="line-clamp-2">{entry.body}</p>
                  </td>
                  <td className="max-w-[280px] px-4 py-3 text-xs text-red-700 dark:text-red-400">
                    {entry.error ?? 'None'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
