import { z } from 'zod/v4';

export const CaptureStatusSchema = z.enum([
  'pending',
  'capturing',
  'processing',
  'complete',
  'failed',
  'succeeded',
]);

export type CaptureStatus = z.infer<typeof CaptureStatusSchema>;

export const CaptureSchema = z.object({
  id: z.string(),
  endpoint_id: z.number(),
  container_id: z.string(),
  container_name: z.string(),
  status: CaptureStatusSchema,
  filter: z.string().nullable(),
  duration_seconds: z.number().nullable(),
  max_packets: z.number().nullable(),
  capture_file: z.string().nullable(),
  file_size_bytes: z.number().nullable(),
  packet_count: z.number().nullable(),
  protocol_stats: z.string().nullable(),
  exec_id: z.string().nullable(),
  sidecar_id: z.string().nullable().optional(),
  error_message: z.string().nullable(),
  started_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  created_at: z.string(),
  analysis_result: z.string().nullable().optional(),
});

export type Capture = z.infer<typeof CaptureSchema>;

// --- PCAP AI Analysis ---

export const PcapFindingSchema = z.object({
  category: z.enum(['anomaly', 'security', 'performance', 'informational']),
  severity: z.enum(['critical', 'warning', 'info']),
  title: z.string(),
  description: z.string(),
  evidence: z.string(),
  recommendation: z.string(),
});

export type PcapFinding = z.infer<typeof PcapFindingSchema>;

export const PcapAnalysisResultSchema = z.object({
  health_status: z.enum(['healthy', 'degraded', 'critical']),
  summary: z.string(),
  findings: z.array(PcapFindingSchema),
  confidence_score: z.number().min(0).max(1),
});

export type PcapAnalysisResult = z.infer<typeof PcapAnalysisResultSchema>;

export interface PcapSummary {
  totalPackets: number;
  durationSeconds: number;
  protocols: Record<string, number>;
  topTalkers: { src: string; dst: string; count: number }[];
  portDistribution: Record<string, number>;
  tcpAnomalies: { resets: number; retransmissions: number };
  dnsQueries: string[];
}

// BPF filter regex: only allow safe characters (prevents shell injection)
const BPF_FILTER_REGEX = /^[a-zA-Z0-9\s.:()/\-!=<>]+$/;

export const StartCaptureRequestSchema = z.object({
  endpointId: z.number().int().positive(),
  containerId: z.string().min(1),
  containerName: z.string().min(1),
  filter: z
    .string()
    .max(500)
    .regex(BPF_FILTER_REGEX, 'Invalid BPF filter: only alphanumeric, spaces, and basic operators allowed')
    .optional(),
  durationSeconds: z.number().int().min(1).max(3600).optional(),
  maxPackets: z.number().int().min(1).max(100000).optional(),
});

export type StartCaptureRequest = z.infer<typeof StartCaptureRequestSchema>;

export const CaptureListQuerySchema = z.object({
  status: CaptureStatusSchema.optional(),
  containerId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type CaptureListQuery = z.infer<typeof CaptureListQuerySchema>;
