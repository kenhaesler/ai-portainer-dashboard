import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
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
  confidence_score: number;
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
  analysis_result: string | null;
}

interface CapturesResponse {
  captures: Capture[];
}

export function useCaptures(filters?: { status?: string; containerId?: string }) {
  const query = useQuery<CapturesResponse>({
    queryKey: ['pcap', 'captures', filters],
    queryFn: () => {
      const params: Record<string, string | undefined> = {
        status: filters?.status,
        containerId: filters?.containerId,
      };
      return api.get<CapturesResponse>('/api/pcap/captures', { params });
    },
  });

  // Auto-refetch when there are active captures
  const hasActive = query.data?.captures.some(
    (c) => c.status === 'capturing' || c.status === 'pending' || c.status === 'processing',
  );

  return useQuery<CapturesResponse>({
    queryKey: ['pcap', 'captures', filters],
    queryFn: () => {
      const params: Record<string, string | undefined> = {
        status: filters?.status,
        containerId: filters?.containerId,
      };
      return api.get<CapturesResponse>('/api/pcap/captures', { params });
    },
    refetchInterval: hasActive ? 2000 : false,
  });
}

export function useCapture(id: string | undefined) {
  const result = useQuery<Capture>({
    queryKey: ['pcap', 'capture', id],
    queryFn: () => api.get<Capture>(`/api/pcap/captures/${id}`),
    enabled: !!id,
  });

  const isActive = result.data?.status === 'capturing' || result.data?.status === 'processing';

  return useQuery<Capture>({
    queryKey: ['pcap', 'capture', id],
    queryFn: () => api.get<Capture>(`/api/pcap/captures/${id}`),
    enabled: !!id,
    refetchInterval: isActive ? 2000 : false,
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

export function downloadCapture(captureId: string, token: string | null): void {
  const baseUrl = import.meta.env.VITE_API_URL || '';
  const url = `${baseUrl || window.location.origin}/api/pcap/captures/${captureId}/download`;

  // Use fetch with auth header, then trigger browser download
  fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
    .then((res) => {
      if (!res.ok) throw new Error(`Download failed: ${res.status}`);
      return res.blob();
    })
    .then((blob) => {
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `capture_${captureId}.pcap`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);
    })
    .catch((err) => {
      toast.error('Download failed', { description: err.message });
    });
}
