import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api';
import { toast } from 'sonner';

export interface PcapFinding {
  category: 'anomaly' | 'security' | 'performance' | 'informational';
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  evidence: string;
  recommendation: string;
}

export interface PcapAnalysisResult {
  health_status: 'healthy' | 'degraded' | 'critical';
  summary: string;
  findings: PcapFinding[];
  /**
   * Null when the model supplied no score. Kept nullable deliberately: this
   * interface hand-mirrors `PcapAnalysisResultSchema` in @dashboard/security and
   * nothing machine-checks the two, so narrowing it here would let the view
   * multiply null by 100 and print an authoritative "Confidence: 0%".
   */
  confidence_score: number | null;
}

export interface Capture {
  id: string;
  endpoint_id: number;
  container_id: string;
  container_name: string;
  status: 'pending' | 'capturing' | 'processing' | 'complete' | 'failed' | 'succeeded';
  filter: string | null;
  duration_seconds: number | null;
  max_packets: number | null;
  capture_file: string | null;
  file_size_bytes: number | null;
  packet_count: number | null;
  protocol_stats: string | null;
  exec_id: string | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  /**
   * The stored analysis. Declared as the JSONB column's real wire shape — an
   * object — with `string` kept for tolerance: the pg driver parses JSONB, so
   * this is not the JSON text the name suggests, and treating it as such is
   * what made the analysis panel unreachable.
   */
  analysis_result: PcapAnalysisResult | string | null;
}

interface CapturesResponse {
  captures: Capture[];
}

export interface PcapStatus {
  enabled: boolean;
  disabledReason: string | null;
}

/**
 * Whether packet capture is switched on for this deployment.
 *
 * `PCAP_ENABLED` defaults to false and was enforced only server-side, inside
 * `startCapture` — after the click. The form offered a live "Start Capture"
 * on a stock install and the operator learned the feature was off from an
 * error toast.
 */
export function usePcapStatus() {
  return useQuery<PcapStatus>({
    queryKey: ['pcap', 'status'],
    queryFn: () => api.get<PcapStatus>('/api/pcap/status'),
    // A deployment flag, not fleet state — it cannot change without a restart.
    staleTime: Infinity,
  });
}

export function useCaptures(filters?: { status?: string; containerId?: string; search?: string }) {
  return useQuery<CapturesResponse>({
    queryKey: ['pcap', 'captures', filters],
    queryFn: () => {
      const params: Record<string, string | undefined> = {
        status: filters?.status,
        containerId: filters?.containerId,
        search: filters?.search,
      };
      return api.get<CapturesResponse>('/api/pcap/captures', { params });
    },
    // Poll while any capture is still in flight; stop once they all settle.
    refetchInterval: (query) =>
      query.state.data?.captures.some(
        (c) => c.status === 'capturing' || c.status === 'pending' || c.status === 'processing',
      )
        ? 2000
        : false,
  });
}

export function useCapture(id: string | undefined) {
  return useQuery<Capture>({
    queryKey: ['pcap', 'capture', id],
    queryFn: () => api.get<Capture>(`/api/pcap/captures/${id}`),
    enabled: !!id,
    // Poll while this capture is still running.
    refetchInterval: (query) =>
      query.state.data?.status === 'capturing' || query.state.data?.status === 'processing'
        ? 2000
        : false,
  });
}

interface StartCaptureParams {
  endpointId: number;
  containerId: string;
  containerName: string;
  filter?: string;
  durationSeconds?: number;
  maxPackets?: number;
}

export function useStartCapture() {
  const queryClient = useQueryClient();

  return useMutation<Capture, Error, StartCaptureParams>({
    mutationFn: async (params) => {
      return api.post<Capture>('/api/pcap/captures', params);
    },
    onSuccess: (capture) => {
      queryClient.invalidateQueries({ queryKey: ['pcap'] });
      toast.success('Capture started', {
        description: `Capturing traffic on ${capture.container_name}`,
      });
    },
    onError: (error) => {
      toast.error('Failed to start capture', {
        description: error.message,
      });
    },
  });
}

export function useStopCapture() {
  const queryClient = useQueryClient();

  return useMutation<Capture, Error, string>({
    mutationFn: async (captureId) => {
      return api.post<Capture>(`/api/pcap/captures/${captureId}/stop`);
    },
    onSuccess: (_capture, captureId) => {
      queryClient.invalidateQueries({ queryKey: ['pcap'] });
      toast.success('Capture stopped', {
        description: `Capture ${captureId.slice(0, 8)} has been stopped.`,
      });
    },
    onError: (error) => {
      toast.error('Failed to stop capture', {
        description: error.message,
      });
    },
  });
}

export function useDeleteCapture() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: async (captureId) => {
      await api.delete(`/api/pcap/captures/${captureId}`);
    },
    onSuccess: (_data, captureId) => {
      queryClient.invalidateQueries({ queryKey: ['pcap'] });
      toast.success('Capture deleted', {
        description: `Capture ${captureId.slice(0, 8)} has been removed.`,
      });
    },
    onError: (error) => {
      toast.error('Failed to delete capture', {
        description: error.message,
      });
    },
  });
}

export function useAnalyzeCapture() {
  const queryClient = useQueryClient();

  return useMutation<PcapAnalysisResult, Error, string>({
    mutationFn: async (captureId) => {
      return api.post<PcapAnalysisResult>(`/api/pcap/captures/${captureId}/analyze`);
    },
    onSuccess: (_result, captureId) => {
      queryClient.invalidateQueries({ queryKey: ['pcap'] });
      toast.success('Analysis complete', {
        description: `Capture ${captureId.slice(0, 8)} has been analyzed.`,
      });
    },
    onError: (error) => {
      toast.error('Analysis failed', {
        description: error.message,
      });
    },
  });
}

export function downloadCapture(captureId: string): void {
  // Routes through ApiClient so the download shares base-URL/auth-header/X-Request-ID
  // plumbing and the shared 401 → auth:expired session-expiry flow.
  api
    .downloadBlob(`/api/pcap/captures/${captureId}/download`, {
      filename: `capture_${captureId}.pcap`,
    })
    .catch((err) => {
      toast.error('Download failed', {
        description: err instanceof Error ? err.message : String(err),
      });
    });
}
