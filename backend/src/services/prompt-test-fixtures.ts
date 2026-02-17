import type { PromptFeature } from './prompt-store.js';

/**
 * Hardcoded sample payloads for testing each LLM feature's system prompt.
 * Each fixture provides a representative user message that the feature
 * would typically receive.
 */
export const PROMPT_TEST_FIXTURES: Record<PromptFeature, { label: string; sampleInput: string }> = {
  chat_assistant: {
    label: 'General infrastructure question',
    sampleInput: 'What containers are using the most CPU right now? Are there any that look unhealthy?',
  },

  command_palette: {
    label: 'Natural language navigation query',
    sampleInput: 'show me containers with high memory usage',
  },

  anomaly_explainer: {
    label: 'High CPU anomaly on nginx container',
    sampleInput: JSON.stringify({
      containerId: 'abc123',
      containerName: 'nginx-proxy',
      endpointName: 'production-01',
      metricType: 'cpu',
      currentValue: 94.5,
      baselineMean: 22.3,
      baselineStdDev: 8.1,
      zScore: 8.9,
      timestamp: new Date().toISOString(),
    }, null, 2),
  },

  incident_summarizer: {
    label: 'Group of 3 related alerts',
    sampleInput: JSON.stringify([
      { severity: 'critical', title: 'CPU spike on api-gateway', description: 'CPU at 97% for 5 minutes', container: 'api-gateway', timestamp: new Date().toISOString() },
      { severity: 'warning', title: 'Memory pressure on api-gateway', description: 'Memory at 89%, approaching limit', container: 'api-gateway', timestamp: new Date().toISOString() },
      { severity: 'warning', title: 'Increased latency on nginx-proxy', description: 'P95 latency up 340% in last 10 minutes', container: 'nginx-proxy', timestamp: new Date().toISOString() },
    ], null, 2),
  },

  log_analyzer: {
    label: '20 lines of mixed nginx access/error logs',
    sampleInput: `2025-01-15T10:23:01Z [info] 192.168.1.10 - GET /api/health 200 12ms
2025-01-15T10:23:02Z [info] 192.168.1.15 - POST /api/login 200 145ms
2025-01-15T10:23:03Z [error] 192.168.1.20 - GET /api/users 500 2ms "Internal Server Error"
2025-01-15T10:23:03Z [warn] upstream timed out (110: Connection timed out) while connecting to upstream
2025-01-15T10:23:04Z [info] 192.168.1.10 - GET /api/containers 200 89ms
2025-01-15T10:23:05Z [error] 192.168.1.25 - POST /api/deploy 502 5002ms "Bad Gateway"
2025-01-15T10:23:05Z [error] connect() failed (111: Connection refused) while connecting to upstream
2025-01-15T10:23:06Z [info] 192.168.1.10 - GET /static/bundle.js 200 3ms
2025-01-15T10:23:07Z [info] 192.168.1.30 - GET /api/metrics 200 234ms
2025-01-15T10:23:08Z [warn] client sent too large body: 15728640 bytes
2025-01-15T10:23:09Z [info] 192.168.1.10 - GET /api/health 200 8ms
2025-01-15T10:23:10Z [error] 192.168.1.20 - GET /api/users 500 3ms "Internal Server Error"
2025-01-15T10:23:11Z [info] 192.168.1.15 - GET /api/containers 200 92ms
2025-01-15T10:23:12Z [info] 192.168.1.10 - GET /api/stacks 200 56ms
2025-01-15T10:23:13Z [error] SSL_do_handshake() failed (SSL: error:0A000086)
2025-01-15T10:23:14Z [info] 192.168.1.30 - GET /api/endpoints 200 45ms
2025-01-15T10:23:15Z [warn] upstream prematurely closed connection
2025-01-15T10:23:16Z [info] 192.168.1.10 - GET /api/health 200 7ms
2025-01-15T10:23:17Z [info] 192.168.1.15 - DELETE /api/sessions/old 204 12ms
2025-01-15T10:23:18Z [error] 192.168.1.20 - GET /api/users 500 2ms "Internal Server Error"`,
  },

  metrics_summary: {
    label: 'CPU/memory time-series for a container',
    sampleInput: JSON.stringify({
      containerName: 'web-app-prod',
      endpointName: 'production-01',
      timeRange: '1h',
      cpu: [
        { timestamp: '10:00', value: 12.3 }, { timestamp: '10:05', value: 15.1 },
        { timestamp: '10:10', value: 14.8 }, { timestamp: '10:15', value: 45.2 },
        { timestamp: '10:20', value: 67.8 }, { timestamp: '10:25', value: 72.1 },
        { timestamp: '10:30', value: 68.9 }, { timestamp: '10:35', value: 55.4 },
        { timestamp: '10:40', value: 34.2 }, { timestamp: '10:45', value: 18.7 },
        { timestamp: '10:50', value: 15.3 }, { timestamp: '10:55', value: 13.9 },
      ],
      memory: [
        { timestamp: '10:00', value: 256 }, { timestamp: '10:05', value: 258 },
        { timestamp: '10:10', value: 262 }, { timestamp: '10:15', value: 289 },
        { timestamp: '10:20', value: 312 }, { timestamp: '10:25', value: 334 },
        { timestamp: '10:30', value: 328 }, { timestamp: '10:35', value: 305 },
        { timestamp: '10:40', value: 278 }, { timestamp: '10:45', value: 264 },
        { timestamp: '10:50', value: 259 }, { timestamp: '10:55', value: 257 },
      ],
      memoryLimitMb: 512,
    }, null, 2),
  },

  root_cause: {
    label: 'Evidence bundle with metrics + logs',
    sampleInput: JSON.stringify({
      anomaly: {
        containerId: 'def456',
        containerName: 'payment-service',
        metricType: 'memory',
        currentValue: 95.2,
        baselineMean: 45.0,
        zScore: 6.3,
      },
      recentLogs: [
        '2025-01-15T10:20:00Z [error] OutOfMemoryError: Java heap space',
        '2025-01-15T10:20:01Z [error] GC overhead limit exceeded',
        '2025-01-15T10:20:02Z [warn] Heap usage at 94% - approaching OOM kill threshold',
        '2025-01-15T10:19:55Z [info] Processing batch of 50000 records',
        '2025-01-15T10:19:50Z [info] Cache miss ratio: 78% (normal: 15%)',
      ],
      relatedContainers: [
        { name: 'redis-cache', state: 'running', cpu: 5.2, memory: 30.1 },
        { name: 'postgres-db', state: 'running', cpu: 22.8, memory: 65.3 },
      ],
    }, null, 2),
  },

  remediation: {
    label: 'Sample remediation action',
    sampleInput: JSON.stringify({
      actionType: 'restart_container',
      containerId: 'ghi789',
      containerName: 'worker-queue',
      reason: 'Container memory usage at 98% with OOM errors in logs',
      severity: 'critical',
      metrics: { cpu: 15.2, memory: 98.1, restarts: 3 },
      context: 'Container has restarted 3 times in the last hour due to memory pressure. No memory limit configured.',
    }, null, 2),
  },

  pcap_analyzer: {
    label: 'Packet capture summary with protocols and top talkers',
    sampleInput: `Capture Duration: 60 seconds
Total Packets: 15,432
Total Bytes: 8,234,567

Protocol Distribution:
  TCP: 12,890 (83.5%)
  UDP: 2,102 (13.6%)
  ICMP: 440 (2.9%)

Top Talkers (by packets):
  10.0.0.5:443 -> 10.0.0.12:8080: 4,523 packets (TCP)
  10.0.0.12:8080 -> 10.0.0.5:443: 4,210 packets (TCP)
  10.0.0.5:53 -> 8.8.8.8:53: 890 packets (UDP)
  10.0.0.20:22 -> 192.168.1.100:54321: 650 packets (TCP)

DNS Queries:
  api.internal.corp: 45 queries
  suspicious-domain.xyz: 12 queries
  cdn.cloudflare.com: 8 queries

TCP Flags Summary:
  SYN: 234, SYN-ACK: 230, RST: 18, FIN: 198`,
  },

  capacity_forecast: {
    label: 'Trend data with slope and R-squared values',
    sampleInput: JSON.stringify({
      containerName: 'database-primary',
      metricType: 'disk_usage_percent',
      currentValue: 72.5,
      limit: 100,
      trendData: {
        slope: 0.15,
        rSquared: 0.94,
        dataPointsUsed: 168,
        timeSpanHours: 168,
      },
      recentValues: [
        { daysAgo: 7, value: 65.2 },
        { daysAgo: 6, value: 66.4 },
        { daysAgo: 5, value: 67.8 },
        { daysAgo: 4, value: 69.1 },
        { daysAgo: 3, value: 70.0 },
        { daysAgo: 2, value: 71.2 },
        { daysAgo: 1, value: 71.9 },
        { daysAgo: 0, value: 72.5 },
      ],
    }, null, 2),
  },

  correlation_insights: {
    label: 'Top 3 correlated metric pairs',
    sampleInput: JSON.stringify({
      correlations: [
        { metric1: 'api-gateway:cpu', metric2: 'database:cpu', coefficient: 0.92, lag: '30s' },
        { metric1: 'web-app:memory', metric2: 'redis-cache:memory', coefficient: 0.87, lag: '0s' },
        { metric1: 'worker:cpu', metric2: 'queue-depth', coefficient: 0.95, lag: '60s' },
      ],
      timeRange: '24h',
      sampleSize: 1440,
    }, null, 2),
  },

  monitoring_analysis: {
    label: 'Periodic monitoring analysis request',
    sampleInput: 'Analyze the current infrastructure state. Identify the top 3 most important issues or recommendations. Be specific and actionable.',
  },
};
