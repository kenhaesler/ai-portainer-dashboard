import { execFile } from 'child_process';
import { promisify } from 'util';
import { createChildLogger } from '@dashboard/core/utils/logger.js';
import { getConfig } from '@dashboard/core/config/index.js';
// eslint-disable-next-line boundaries/element-types, boundaries/entry-point -- Phase 3: replace with @dashboard/contracts AI interface
import { isOllamaAvailable, chatStream } from '../../ai-intelligence/services/llm-client.js';
// eslint-disable-next-line boundaries/element-types, boundaries/entry-point -- Phase 3: replace with @dashboard/contracts AI interface
import { getEffectivePrompt } from '../../ai-intelligence/services/prompt-store.js';
import { getCapture, updateCaptureAnalysis } from './pcap-store.js';
import { getCaptureFilePath } from './pcap-service.js';
import type { PcapAnalysisResult, PcapSummary } from '../models/pcap.js';

const log = createChildLogger('pcap-analysis');
const execFileAsync = promisify(execFile);

/**
 * Parse `tcpdump -r <file> -q -n` output into a structured summary.
 * Each line looks like: "12:34:56.789 IP 10.0.0.1.443 > 10.0.0.2.54321: tcp 128"
 */
export function parseTcpdumpOutput(raw: string): PcapSummary {
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);

  const protocols: Record<string, number> = {};
  const talkerMap = new Map<string, number>();
  const portMap: Record<string, number> = {};
  const dnsSet = new Set<string>();
  let resets = 0;
  let retransmissions = 0;
  let firstTs = Infinity;
  let lastTs = 0;

  for (const line of lines) {
    // Extract timestamp (first field, e.g. "12:34:56.789123")
    const tsMatch = line.match(/^(\d{2}:\d{2}:\d{2}\.\d+)/);
    if (tsMatch) {
      const parts = tsMatch[1].split(':');
      const secs = Number(parts[0]) * 3600 + Number(parts[1]) * 60 + parseFloat(parts[2]);
      if (secs < firstTs) firstTs = secs;
      if (secs > lastTs) lastTs = secs;
    }

    // Protocol detection — check specific protocols before generic IP
    const lowerLine = line.toLowerCase();
    if (lowerLine.includes('arp')) {
      protocols['ARP'] = (protocols['ARP'] || 0) + 1;
    } else if (lowerLine.includes('icmp')) {
      protocols['ICMP'] = (protocols['ICMP'] || 0) + 1;
    } else if (lowerLine.includes(' ip ') || lowerLine.includes(' ip6 ')) {
      if (lowerLine.includes(': tcp') || lowerLine.includes(' tcp ')) {
        protocols['TCP'] = (protocols['TCP'] || 0) + 1;
      } else if (lowerLine.includes(': udp') || lowerLine.includes(' udp ')) {
        protocols['UDP'] = (protocols['UDP'] || 0) + 1;
      } else {
        protocols['Other IP'] = (protocols['Other IP'] || 0) + 1;
      }
    } else {
      protocols['Other'] = (protocols['Other'] || 0) + 1;
    }

    // TCP anomalies
    if (lowerLine.includes('[rst]') || lowerLine.includes(' rst ') || lowerLine.includes('flags [r')) {
      resets++;
    }
    if (lowerLine.includes('retransmit')) {
      retransmissions++;
    }

    // Top talkers: extract "src > dst" pairs (IP-based lines)
    const flowMatch = line.match(/(\d+\.\d+\.\d+\.\d+)[.\d]* > (\d+\.\d+\.\d+\.\d+)[.\d]*/);
    if (flowMatch) {
      const key = `${flowMatch[1]} > ${flowMatch[2]}`;
      talkerMap.set(key, (talkerMap.get(key) || 0) + 1);
    }

    // Port distribution: extract destination port from patterns like "10.0.0.1.443" or ".https"
    const dstPortMatch = line.match(/> \S+?\.(\d+):/);
    if (dstPortMatch) {
      const port = `:${dstPortMatch[1]}`;
      portMap[port] = (portMap[port] || 0) + 1;
    }

    // DNS queries: look for port 53 or domain names
    if (lowerLine.includes('.53:') || lowerLine.includes(' domain')) {
      // Extract queried domain from DNS lines like "A? api.example.com"
      const dnsMatch = line.match(/[A-Z]+\?\s+(\S+)/);
      if (dnsMatch) {
        dnsSet.add(dnsMatch[1].replace(/\.$/, ''));
      }
    }
  }

  // Build top talkers (sorted by count, top 10)
  const topTalkers = [...talkerMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([flow, count]) => {
      const [src, dst] = flow.split(' > ');
      return { src, dst, count };
    });

  const durationSeconds = lastTs > firstTs ? Math.round((lastTs - firstTs) * 10) / 10 : 0;

  return {
    totalPackets: lines.length,
    durationSeconds,
    protocols,
    topTalkers,
    portDistribution: portMap,
    tcpAnomalies: { resets, retransmissions },
    dnsQueries: [...dnsSet].slice(0, 20),
  };
}

/**
 * Extract PCAP summary using tcpdump -r on the local stored file.
 */
export async function extractPcapSummary(filePath: string): Promise<PcapSummary> {
  try {
    const { stdout } = await execFileAsync('tcpdump', ['-r', filePath, '-q', '-n', '-c', '5000'], {
      timeout: 30_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    return parseTcpdumpOutput(stdout);
  } catch (err: unknown) {
    // tcpdump may exit with code 1 but still produce output (e.g., truncated capture)
    if (err && typeof err === 'object' && 'stdout' in err) {
      const stdout = (err as { stdout: string }).stdout;
      if (stdout && stdout.length > 0) {
        return parseTcpdumpOutput(stdout);
      }
    }
    throw new Error(`Failed to parse PCAP file: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }
}

/**
 * Build the LLM prompt from a PCAP summary.
 */
export function buildAnalysisPrompt(summary: PcapSummary, containerName: string): string {
  const parts: string[] = [
    '# Network Packet Capture Analysis',
    '',
    `## Container: ${containerName}`,
    '',
    '## Capture Statistics',
    `- **Total packets**: ${summary.totalPackets}`,
    `- **Duration**: ${summary.durationSeconds}s`,
    '',
    '## Protocol Breakdown',
  ];

  for (const [proto, count] of Object.entries(summary.protocols)) {
    const pct = ((count / summary.totalPackets) * 100).toFixed(1);
    parts.push(`- ${proto}: ${count} (${pct}%)`);
  }

  if (summary.topTalkers.length > 0) {
    parts.push('', '## Top Talkers (by packet count)');
    for (const t of summary.topTalkers) {
      parts.push(`- ${t.src} -> ${t.dst}: ${t.count} packets`);
    }
  }

  if (Object.keys(summary.portDistribution).length > 0) {
    parts.push('', '## Destination Port Distribution');
    const sorted = Object.entries(summary.portDistribution).sort((a, b) => b[1] - a[1]).slice(0, 15);
    for (const [port, count] of sorted) {
      parts.push(`- ${port}: ${count} packets`);
    }
  }

  parts.push(
    '',
    '## TCP Anomalies',
    `- RST packets: ${summary.tcpAnomalies.resets}`,
    `- Retransmissions: ${summary.tcpAnomalies.retransmissions}`,
  );

  if (summary.dnsQueries.length > 0) {
    parts.push('', '## DNS Queries');
    for (const domain of summary.dnsQueries) {
      parts.push(`- ${domain}`);
    }
  }

  parts.push(
    '',
    '## Instructions',
    'Analyze the above network capture summary and provide a health assessment. Respond with ONLY a JSON object (no markdown fencing, no extra text) with this exact structure:',
    '',
    '```json',
    '{',
    '  "health_status": "healthy | degraded | critical",',
    '  "summary": "Human-readable 2-3 sentence overview of the capture",',
    '  "findings": [',
    '    {',
    '      "category": "anomaly | security | performance | informational",',
    '      "severity": "critical | warning | info",',
    '      "title": "Short title",',
    '      "description": "Detailed explanation",',
    '      "evidence": "Specific data from the capture supporting this finding",',
    '      "recommendation": "Actionable suggestion to resolve the issue"',
    '    }',
    '  ],',
    '  "confidence_score": 0.85',
    '}',
    '```',
    '',
    'Important:',
    '- confidence_score: 0.0 to 1.0 based on evidence quality and capture size',
    '- Be specific about network behavior, not generic',
    '- Findings should be ordered by severity (critical first)',
    '- Only include findings that are actually supported by the data',
    '- recommendations should be read-only observations/suggestions, never destructive commands',
    '- If the traffic looks normal, say so — not every capture has problems',
  );

  return parts.join('\n');
}

/**
 * Parse the LLM response into a structured analysis result.
 * Follows the same pattern as investigation-service.ts parseInvestigationResponse.
 */
export function parseAnalysisResponse(raw: string): PcapAnalysisResult {
  // Try direct JSON parse
  try {
    return validateAnalysisResult(JSON.parse(raw));
  } catch {
    // not direct JSON
  }

  // Try to extract JSON from markdown code fences
  const jsonMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (jsonMatch) {
    try {
      return validateAnalysisResult(JSON.parse(jsonMatch[1]));
    } catch {
      // invalid JSON inside fence
    }
  }

  // Fallback
  return {
    health_status: 'degraded',
    summary: raw.trim().slice(0, 500),
    findings: [],
    confidence_score: 0.3,
  };
}

function validateAnalysisResult(parsed: Record<string, unknown>): PcapAnalysisResult {
  const healthStatus = ['healthy', 'degraded', 'critical'].includes(parsed.health_status as string)
    ? (parsed.health_status as 'healthy' | 'degraded' | 'critical')
    : 'degraded';

  const summary = typeof parsed.summary === 'string' ? parsed.summary : 'Analysis completed';

  const findings = Array.isArray(parsed.findings)
    ? parsed.findings
        .map((f: unknown) => {
          if (typeof f !== 'object' || f === null) return null;
          const obj = f as Record<string, unknown>;
          return {
            category: ['anomaly', 'security', 'performance', 'informational'].includes(obj.category as string)
              ? (obj.category as 'anomaly' | 'security' | 'performance' | 'informational')
              : 'informational',
            severity: ['critical', 'warning', 'info'].includes(obj.severity as string)
              ? (obj.severity as 'critical' | 'warning' | 'info')
              : 'info',
            title: typeof obj.title === 'string' ? obj.title : 'Finding',
            description: typeof obj.description === 'string' ? obj.description : '',
            evidence: typeof obj.evidence === 'string' ? obj.evidence : '',
            recommendation: typeof obj.recommendation === 'string' ? obj.recommendation : '',
          };
        })
        .filter((f): f is NonNullable<typeof f> => f !== null)
    : [];

  const confidenceScore = typeof parsed.confidence_score === 'number'
    ? Math.max(0, Math.min(1, parsed.confidence_score))
    : 0.5;

  return { health_status: healthStatus, summary, findings, confidence_score: confidenceScore };
}

/**
 * Analyze a completed packet capture using tcpdump + LLM.
 * Idempotent: re-analyzing overwrites previous results.
 */
export async function analyzeCapture(captureId: string): Promise<PcapAnalysisResult> {
  const config = getConfig();

  // Guard: feature flag
  if (!config.PCAP_ENABLED) {
    throw new Error('Packet capture is not enabled');
  }

  // Guard: capture must exist and be complete/succeeded
  const capture = await getCapture(captureId);
  if (!capture) {
    throw new Error('Capture not found');
  }
  if (capture.status !== 'complete' && capture.status !== 'succeeded') {
    throw new Error(`Cannot analyze capture in status: ${capture.status}`);
  }

  // Guard: file must exist
  const filePath = await getCaptureFilePath(captureId);
  if (!filePath) {
    throw new Error('Capture file not found on disk');
  }

  // Guard: LLM must be available
  const llmAvailable = await isOllamaAvailable();
  if (!llmAvailable) {
    throw new Error('LLM service is not available');
  }

  log.info({ captureId, containerName: capture.container_name }, 'Starting PCAP analysis');

  // Phase 1: Extract summary
  const summary = await extractPcapSummary(filePath);

  // Phase 2: LLM analysis
  const prompt = buildAnalysisPrompt(summary, capture.container_name);

  let llmResponse = '';
  await chatStream(
    [{ role: 'user', content: prompt }],
    await getEffectivePrompt('pcap_analyzer'),
    (chunk) => { llmResponse += chunk; },
  );

  // Phase 3: Parse and store
  const result = parseAnalysisResponse(llmResponse);

  await updateCaptureAnalysis(captureId, JSON.stringify(result));

  log.info(
    { captureId, healthStatus: result.health_status, findingsCount: result.findings.length, confidence: result.confidence_score },
    'PCAP analysis completed',
  );

  return result;
}
