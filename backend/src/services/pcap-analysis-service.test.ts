import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseTcpdumpOutput, buildAnalysisPrompt, parseAnalysisResponse } from './pcap-analysis-service.js';
import type { PcapSummary } from '../models/pcap.js';

describe('parseTcpdumpOutput', () => {
  it('parses TCP packets with source/dest IP and ports', () => {
    const raw = [
      '12:00:01.000000 IP 10.0.0.1.443 > 10.0.0.2.54321: tcp 128',
      '12:00:01.100000 IP 10.0.0.2.54321 > 10.0.0.1.443: tcp 64',
      '12:00:02.000000 IP 10.0.0.1.443 > 10.0.0.3.12345: tcp 256',
    ].join('\n');

    const result = parseTcpdumpOutput(raw);

    expect(result.totalPackets).toBe(3);
    expect(result.protocols['TCP']).toBe(3);
    expect(result.durationSeconds).toBeCloseTo(1.0, 0);
    expect(result.topTalkers.length).toBeGreaterThan(0);
    expect(result.topTalkers[0].src).toBe('10.0.0.1');
  });

  it('detects UDP protocol', () => {
    const raw = '12:00:01.000000 IP 10.0.0.1.53 > 10.0.0.2.12345: udp 64';
    const result = parseTcpdumpOutput(raw);
    expect(result.protocols['UDP']).toBe(1);
  });

  it('detects ARP protocol', () => {
    const raw = '12:00:01.000000 ARP, Request who-has 10.0.0.1 tell 10.0.0.2, length 28';
    const result = parseTcpdumpOutput(raw);
    expect(result.protocols['ARP']).toBe(1);
  });

  it('detects ICMP protocol', () => {
    const raw = '12:00:01.000000 IP 10.0.0.1 > 10.0.0.2: ICMP echo request, id 1234, seq 1, length 64';
    const result = parseTcpdumpOutput(raw);
    expect(result.protocols['ICMP']).toBe(1);
  });

  it('counts TCP RST anomalies', () => {
    const raw = [
      '12:00:01.000000 IP 10.0.0.1.443 > 10.0.0.2.54321: Flags [R], seq 0, length 0',
      '12:00:01.100000 IP 10.0.0.1.443 > 10.0.0.2.54321: tcp 64',
    ].join('\n');

    const result = parseTcpdumpOutput(raw);
    expect(result.tcpAnomalies.resets).toBe(1);
  });

  it('extracts port distribution', () => {
    const raw = [
      '12:00:01.000000 IP 10.0.0.1.54321 > 10.0.0.2.443: tcp 128',
      '12:00:01.100000 IP 10.0.0.1.54322 > 10.0.0.2.443: tcp 64',
      '12:00:01.200000 IP 10.0.0.1.54323 > 10.0.0.2.80: tcp 64',
    ].join('\n');

    const result = parseTcpdumpOutput(raw);
    expect(result.portDistribution[':443']).toBe(2);
    expect(result.portDistribution[':80']).toBe(1);
  });

  it('returns empty summary for empty input', () => {
    const result = parseTcpdumpOutput('');
    expect(result.totalPackets).toBe(0);
    expect(result.durationSeconds).toBe(0);
    expect(result.topTalkers).toHaveLength(0);
  });
});

describe('buildAnalysisPrompt', () => {
  const mockSummary: PcapSummary = {
    totalPackets: 100,
    durationSeconds: 30.5,
    protocols: { TCP: 80, UDP: 15, ICMP: 5 },
    topTalkers: [
      { src: '10.0.0.1', dst: '10.0.0.2', count: 50 },
    ],
    portDistribution: { ':443': 60, ':80': 20 },
    tcpAnomalies: { resets: 3, retransmissions: 2 },
    dnsQueries: ['api.example.com'],
  };

  it('includes container name', () => {
    const prompt = buildAnalysisPrompt(mockSummary, 'nginx-proxy');
    expect(prompt).toContain('nginx-proxy');
  });

  it('includes capture statistics', () => {
    const prompt = buildAnalysisPrompt(mockSummary, 'test');
    expect(prompt).toContain('100');
    expect(prompt).toContain('30.5s');
  });

  it('includes protocol breakdown', () => {
    const prompt = buildAnalysisPrompt(mockSummary, 'test');
    expect(prompt).toContain('TCP: 80');
    expect(prompt).toContain('UDP: 15');
    expect(prompt).toContain('ICMP: 5');
  });

  it('includes top talkers', () => {
    const prompt = buildAnalysisPrompt(mockSummary, 'test');
    expect(prompt).toContain('10.0.0.1 -> 10.0.0.2: 50 packets');
  });

  it('includes port distribution', () => {
    const prompt = buildAnalysisPrompt(mockSummary, 'test');
    expect(prompt).toContain(':443');
    expect(prompt).toContain(':80');
  });

  it('includes TCP anomalies', () => {
    const prompt = buildAnalysisPrompt(mockSummary, 'test');
    expect(prompt).toContain('RST packets: 3');
    expect(prompt).toContain('Retransmissions: 2');
  });

  it('includes DNS queries', () => {
    const prompt = buildAnalysisPrompt(mockSummary, 'test');
    expect(prompt).toContain('api.example.com');
  });

  it('includes JSON response instructions', () => {
    const prompt = buildAnalysisPrompt(mockSummary, 'test');
    expect(prompt).toContain('health_status');
    expect(prompt).toContain('findings');
    expect(prompt).toContain('confidence_score');
  });
});

describe('parseAnalysisResponse', () => {
  it('parses valid JSON response', () => {
    const raw = JSON.stringify({
      health_status: 'healthy',
      summary: 'Traffic looks normal',
      findings: [
        {
          category: 'informational',
          severity: 'info',
          title: 'Normal traffic',
          description: 'All protocols within expected ranges',
          evidence: '100 packets, 80% TCP',
          recommendation: 'No action needed',
        },
      ],
      confidence_score: 0.9,
    });

    const result = parseAnalysisResponse(raw);
    expect(result.health_status).toBe('healthy');
    expect(result.summary).toBe('Traffic looks normal');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].category).toBe('informational');
    expect(result.confidence_score).toBe(0.9);
  });

  it('parses JSON wrapped in markdown code fences', () => {
    const raw = '```json\n{"health_status":"degraded","summary":"Issues found","findings":[],"confidence_score":0.7}\n```';
    const result = parseAnalysisResponse(raw);
    expect(result.health_status).toBe('degraded');
    expect(result.confidence_score).toBe(0.7);
  });

  it('falls back gracefully for unparseable responses', () => {
    const raw = 'The traffic looks concerning because of high retransmissions.';
    const result = parseAnalysisResponse(raw);
    expect(result.health_status).toBe('degraded');
    expect(result.confidence_score).toBe(0.3);
    expect(result.summary).toContain('retransmissions');
    expect(result.findings).toHaveLength(0);
  });

  it('validates health_status enum values', () => {
    const raw = JSON.stringify({
      health_status: 'unknown',
      summary: 'test',
      findings: [],
      confidence_score: 0.5,
    });
    const result = parseAnalysisResponse(raw);
    expect(result.health_status).toBe('degraded'); // defaults to degraded for unknown
  });

  it('clamps confidence_score to 0-1 range', () => {
    const raw = JSON.stringify({
      health_status: 'healthy',
      summary: 'test',
      findings: [],
      confidence_score: 1.5,
    });
    const result = parseAnalysisResponse(raw);
    expect(result.confidence_score).toBe(1);
  });

  it('validates finding categories and severities', () => {
    const raw = JSON.stringify({
      health_status: 'critical',
      summary: 'test',
      findings: [
        {
          category: 'invalid_category',
          severity: 'invalid_severity',
          title: 'Test',
          description: 'desc',
          evidence: 'ev',
          recommendation: 'rec',
        },
      ],
      confidence_score: 0.5,
    });
    const result = parseAnalysisResponse(raw);
    expect(result.findings[0].category).toBe('informational'); // default
    expect(result.findings[0].severity).toBe('info'); // default
  });
});
