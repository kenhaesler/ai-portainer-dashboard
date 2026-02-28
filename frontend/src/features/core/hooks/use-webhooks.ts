import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api';
import { useResource } from '@/shared/hooks/use-resource';
import { STALE_TIMES } from '@/shared/lib/query-constants';

export interface Webhook {
  id: string;
  name: string;
  url: string;
  secret: string;
  events: string[];
  enabled: number;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface WebhookDelivery {
  id: string;
  webhook_id: string;
  event_type: string;
  payload: string;
  status: string;
  http_status: number | null;
  response_body: string | null;
  attempt: number;
  max_attempts: number;
  next_retry_at: string | null;
  delivered_at: string | null;
  created_at: string;
}

export interface WebhookEventType {
  type: string;
  description: string;
}

export interface WebhookEvent {
  type: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface WebhookInput {
  name: string;
  url: string;
  secret?: string;
  events: string[];
  enabled?: boolean;
  description?: string;
}

interface WebhookDeliveryResponse {
  deliveries: WebhookDelivery[];
  total: number;
}

interface WebhookTestResponse {
  success: boolean;
  httpStatus?: number;
  responseBody?: string;
  error?: string;
}

const webhooksKey = ['webhooks'] as const;

export function useWebhooks() {
  return useResource<Webhook[]>(webhooksKey, '/api/webhooks');
}

export function useWebhookEventTypes() {
  return useResource<WebhookEventType[]>(
    ['webhooks', 'event-types'],
    '/api/webhooks/event-types',
    { staleTime: STALE_TIMES.LONG },
  );
}

export function useWebhookDeliveries(webhookId: string | null, limit: number = 20) {
  return useQuery<WebhookDeliveryResponse>({
    queryKey: ['webhooks', 'deliveries', webhookId, limit],
    queryFn: () => api.get<WebhookDeliveryResponse>(`/api/webhooks/${webhookId}/deliveries?limit=${limit}`),
    enabled: Boolean(webhookId),
  });
}

export function useCreateWebhook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: WebhookInput) => api.post<Webhook>('/api/webhooks', payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: webhooksKey }),
  });
}

export function useUpdateWebhook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<WebhookInput> }) =>
      api.request<Webhook>(`/api/webhooks/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: webhooksKey }),
  });
}

export function useDeleteWebhook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ success: boolean }>(`/api/webhooks/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: webhooksKey }),
  });
}

export function useTestWebhook() {
  return useMutation({
    mutationFn: (id: string) => api.post<WebhookTestResponse>(`/api/webhooks/${id}/test`),
  });
}

export async function streamDashboardEvents(options: {
  signal: AbortSignal;
  onEvent: (event: WebhookEvent) => void;
  onError: (message: string) => void;
}): Promise<void> {
  const token = api.getToken();
  const response = await fetch('/api/events/stream', {
    method: 'GET',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    signal: options.signal,
  });

  if (!response.ok || !response.body) {
    options.onError(`Event stream failed (${response.status})`);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (!options.signal.aborted) {
    const result = await reader.read();
    if (result.done) break;

    buffer += decoder.decode(result.value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';

    for (const chunk of parts) {
      const lines = chunk.split('\n');
      let data = '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          data += line.slice(6);
        }
      }

      if (!data) continue;

      try {
        options.onEvent(JSON.parse(data) as WebhookEvent);
      } catch {
        options.onError('Failed to parse stream event payload');
      }
    }
  }
}
