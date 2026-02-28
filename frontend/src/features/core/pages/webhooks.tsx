import { useEffect, useMemo, useState } from 'react';
import { Loader2, PlugZap, Plus, TestTube2, Trash2, Activity, Radio, RefreshCw } from 'lucide-react';
import { ThemedSelect } from '@/shared/components/ui/themed-select';
import {
  useCreateWebhook,
  useDeleteWebhook,
  useTestWebhook,
  useUpdateWebhook,
  useWebhookDeliveries,
  useWebhookEventTypes,
  useWebhooks,
  streamDashboardEvents,
  type Webhook,
} from '@/features/core/hooks/use-webhooks';
import { formatDate } from '@/shared/lib/utils';

interface FormState {
  name: string;
  url: string;
  secret: string;
  description: string;
  enabled: boolean;
  events: string[];
}

const initialForm: FormState = {
  name: '',
  url: '',
  secret: '',
  description: '',
  enabled: true,
  events: ['*'],
};

function normalizeForm(form: FormState) {
  return {
    name: form.name.trim(),
    url: form.url.trim(),
    secret: form.secret.trim() || undefined,
    description: form.description.trim() || undefined,
    enabled: form.enabled,
    events: form.events.length ? form.events : ['*'],
  };
}

function statusStyle(enabled: number) {
  return enabled
    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
    : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300';
}

export function WebhooksPanel() {
  const webhooksQuery = useWebhooks();
  const eventTypesQuery = useWebhookEventTypes();
  const createWebhook = useCreateWebhook();
  const updateWebhook = useUpdateWebhook();
  const deleteWebhook = useDeleteWebhook();
  const testWebhook = useTestWebhook();

  const [selectedWebhookId, setSelectedWebhookId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'enabled' | 'disabled'>('all');
  const [form, setForm] = useState<FormState>(initialForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [streamEvents, setStreamEvents] = useState<Array<{ type: string; timestamp: string }>>([]);
  const [streamError, setStreamError] = useState<string | null>(null);

  const deliveriesQuery = useWebhookDeliveries(selectedWebhookId, 20);

  useEffect(() => {
    if (selectedWebhookId) return;
    const first = webhooksQuery.data?.[0];
    if (first) setSelectedWebhookId(first.id);
  }, [selectedWebhookId, webhooksQuery.data]);

  useEffect(() => {
    const controller = new AbortController();

    streamDashboardEvents({
      signal: controller.signal,
      onEvent: (event) => {
        setStreamEvents((prev) => [{ type: event.type, timestamp: event.timestamp }, ...prev].slice(0, 30));
      },
      onError: (message) => setStreamError(message),
    }).catch((err) => {
      if (!controller.signal.aborted) {
        setStreamError(err instanceof Error ? err.message : 'Failed to connect event stream');
      }
    });

    return () => {
      controller.abort();
    };
  }, []);

  const filteredWebhooks = useMemo(() => {
    const all = webhooksQuery.data ?? [];
    if (filter === 'enabled') return all.filter((w) => w.enabled === 1);
    if (filter === 'disabled') return all.filter((w) => w.enabled === 0);
    return all;
  }, [filter, webhooksQuery.data]);

  const beginCreate = () => {
    setEditingId(null);
    setForm(initialForm);
    setFormError(null);
  };

  const beginEdit = (webhook: Webhook) => {
    setEditingId(webhook.id);
    setForm({
      name: webhook.name,
      url: webhook.url,
      secret: '',
      description: webhook.description ?? '',
      enabled: webhook.enabled === 1,
      events: webhook.events,
    });
    setFormError(null);
  };

  const saveWebhook = async () => {
    const normalized = normalizeForm(form);

    if (!normalized.name || !normalized.url) {
      setFormError('Name and URL are required.');
      return;
    }

    try {
      if (editingId) {
        await updateWebhook.mutateAsync({ id: editingId, payload: normalized });
      } else {
        await createWebhook.mutateAsync(normalized);
      }
      setForm(initialForm);
      setEditingId(null);
      setFormError(null);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save webhook');
    }
  };

  const toggleEvent = (eventType: string) => {
    setForm((prev) => {
      const has = prev.events.includes(eventType);
      const next = has
        ? prev.events.filter((event) => event !== eventType)
        : [...prev.events, eventType];
      return { ...prev, events: next.length ? next : ['*'] };
    });
  };

  const toggleEnabled = async (webhook: Webhook) => {
    await updateWebhook.mutateAsync({
      id: webhook.id,
      payload: { enabled: webhook.enabled !== 1 },
    });
  };

  const confirmDelete = async (id: string) => {
    if (!window.confirm('Delete this webhook configuration?')) return;
    await deleteWebhook.mutateAsync(id);
    if (selectedWebhookId === id) {
      setSelectedWebhookId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={beginCreate}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          Add Webhook
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <section className="rounded-lg border bg-card p-4 lg:col-span-3">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <label className="text-sm text-muted-foreground">Filter</label>
            <ThemedSelect
              value={filter}
              onValueChange={(val) => setFilter(val as 'all' | 'enabled' | 'disabled')}
              options={[
                { value: 'all', label: 'All' },
                { value: 'enabled', label: 'Enabled' },
                { value: 'disabled', label: 'Disabled' },
              ]}
            />
            <button
              type="button"
              onClick={() => webhooksQuery.refetch()}
              className="ml-auto inline-flex items-center gap-1 rounded-md border border-input bg-background px-2.5 py-1 text-xs font-medium hover:bg-accent"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </button>
          </div>

          {webhooksQuery.isLoading ? (
            <div className="space-y-2">
              <div className="h-10 animate-pulse rounded bg-muted" />
              <div className="h-10 animate-pulse rounded bg-muted" />
            </div>
          ) : filteredWebhooks.length === 0 ? (
            <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
              No webhooks configured yet.
            </div>
          ) : (
            <div className="space-y-2">
              {filteredWebhooks.map((webhook) => (
                <div
                  key={webhook.id}
                  className={`rounded-md border p-3 ${selectedWebhookId === webhook.id ? 'border-primary bg-primary/5' : ''}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedWebhookId(webhook.id)}
                      className="text-left"
                    >
                      <p className="font-medium">{webhook.name}</p>
                      <p className="text-xs text-muted-foreground">{webhook.url}</p>
                    </button>
                    <span className={`ml-auto inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusStyle(webhook.enabled)}`}>
                      {webhook.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    {webhook.events.map((eventType) => (
                      <span key={eventType} className="rounded bg-muted px-1.5 py-0.5">{eventType}</span>
                    ))}
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => beginEdit(webhook)}
                      className="rounded-md border border-input bg-background px-2 py-1 text-xs font-medium hover:bg-accent"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => void toggleEnabled(webhook)}
                      className="rounded-md border border-input bg-background px-2 py-1 text-xs font-medium hover:bg-accent"
                    >
                      {webhook.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void testWebhook.mutateAsync(webhook.id)}
                      className="inline-flex items-center gap-1 rounded-md border border-input bg-background px-2 py-1 text-xs font-medium hover:bg-accent"
                    >
                      <TestTube2 className="h-3.5 w-3.5" />
                      Test
                    </button>
                    <button
                      type="button"
                      onClick={() => void confirmDelete(webhook.id)}
                      className="inline-flex items-center gap-1 rounded-md border border-red-300 bg-red-50 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-lg border bg-card p-4 lg:col-span-2">
          <h2 className="text-base font-semibold">{editingId ? 'Edit Webhook' : 'Create Webhook'}</h2>
          <div className="mt-3 space-y-3 text-sm">
            <label className="block">
              <span className="mb-1 block text-muted-foreground">Name</span>
              <input
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                className="h-9 w-full rounded-md border border-input bg-background px-2"
                placeholder="alerts-slack"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-muted-foreground">URL</span>
              <input
                value={form.url}
                onChange={(e) => setForm((prev) => ({ ...prev, url: e.target.value }))}
                className="h-9 w-full rounded-md border border-input bg-background px-2"
                placeholder="https://hooks.example.com/..."
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-muted-foreground">Secret (optional)</span>
              <input
                value={form.secret}
                onChange={(e) => setForm((prev) => ({ ...prev, secret: e.target.value }))}
                className="h-9 w-full rounded-md border border-input bg-background px-2"
                placeholder="leave blank to auto-generate"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-muted-foreground">Description</span>
              <textarea
                value={form.description}
                onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                className="min-h-[72px] w-full rounded-md border border-input bg-background px-2 py-1.5"
              />
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => setForm((prev) => ({ ...prev, enabled: e.target.checked }))}
              />
              Enabled
            </label>

            <div>
              <p className="mb-1 text-muted-foreground">Subscribed Events</p>
              <div className="max-h-40 space-y-1 overflow-auto rounded-md border p-2">
                {(eventTypesQuery.data ?? []).map((eventType) => (
                  <label key={eventType.type} className="flex items-start gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={form.events.includes(eventType.type)}
                      onChange={() => toggleEvent(eventType.type)}
                    />
                    <span>
                      <span className="font-medium">{eventType.type}</span>
                      <span className="block text-muted-foreground">{eventType.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {formError && <p className="text-xs text-destructive">{formError}</p>}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void saveWebhook()}
                className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                disabled={createWebhook.isPending || updateWebhook.isPending}
              >
                {(createWebhook.isPending || updateWebhook.isPending) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlugZap className="h-3.5 w-3.5" />}
                {editingId ? 'Update' : 'Create'}
              </button>
              <button
                type="button"
                onClick={beginCreate}
                className="rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent"
              >
                Reset
              </button>
            </div>
          </div>
        </section>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="rounded-lg border bg-card p-4">
          <h2 className="text-base font-semibold">Delivery Monitor</h2>
          {!selectedWebhookId ? (
            <p className="mt-3 text-sm text-muted-foreground">Select a webhook to view delivery history.</p>
          ) : deliveriesQuery.isLoading ? (
            <div className="mt-3 space-y-2">
              <div className="h-9 animate-pulse rounded bg-muted" />
              <div className="h-9 animate-pulse rounded bg-muted" />
            </div>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-2 py-2 font-medium">Event</th>
                    <th className="px-2 py-2 font-medium">Status</th>
                    <th className="px-2 py-2 font-medium">HTTP</th>
                    <th className="px-2 py-2 font-medium">Attempt</th>
                    <th className="px-2 py-2 font-medium">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {(deliveriesQuery.data?.deliveries ?? []).map((delivery) => (
                    <tr key={delivery.id} className="border-b last:border-0">
                      <td className="px-2 py-2 text-xs">{delivery.event_type}</td>
                      <td className="px-2 py-2 text-xs capitalize">{delivery.status}</td>
                      <td className="px-2 py-2 text-xs">{delivery.http_status ?? '-'}</td>
                      <td className="px-2 py-2 text-xs">{delivery.attempt}/{delivery.max_attempts}</td>
                      <td className="px-2 py-2 text-xs text-muted-foreground">{formatDate(delivery.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(deliveriesQuery.data?.deliveries ?? []).length === 0 && (
                <p className="mt-2 text-xs text-muted-foreground">No deliveries recorded yet.</p>
              )}
            </div>
          )}
        </section>

        <section className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">Live Event Feed</h2>
            <Radio className="h-4 w-4 text-primary" />
          </div>
          {streamError && <p className="mt-2 text-xs text-destructive">{streamError}</p>}
          <div className="mt-3 max-h-72 space-y-2 overflow-auto rounded-md border bg-muted/20 p-2">
            {streamEvents.length === 0 ? (
              <p className="text-xs text-muted-foreground">Awaiting events...</p>
            ) : (
              streamEvents.map((event, idx) => (
                <div key={`${event.timestamp}-${idx}`} className="rounded-md border bg-background px-2 py-1.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{event.type}</span>
                    <span className="text-muted-foreground"><Activity className="mr-1 inline h-3 w-3" />{formatDate(event.timestamp)}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

export default function WebhooksPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Webhook Control Center</h1>
          <p className="text-muted-foreground">Manage outbound webhooks, delivery outcomes, and live event flow.</p>
        </div>
      </div>
      <WebhooksPanel />
    </div>
  );
}
