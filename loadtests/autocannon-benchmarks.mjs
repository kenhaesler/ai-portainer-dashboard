#!/usr/bin/env node

/**
 * Per-endpoint HTTP throughput benchmarks using autocannon.
 *
 * Logs in once, then benchmarks each endpoint sequentially with
 * 10 concurrent connections for 30 seconds.
 *
 * Usage:
 *   npm run loadtest:bench
 *   node loadtests/autocannon-benchmarks.mjs
 *
 * Env vars (with defaults):
 *   BASE_URL          http://localhost:3051
 *   DASHBOARD_USER    admin
 *   DASHBOARD_PASS    admin
 *   BENCH_CONNECTIONS  10
 *   BENCH_DURATION     30
 */

import autocannon from 'autocannon';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3051';
const USERNAME = process.env.DASHBOARD_USER || 'admin';
const PASSWORD = process.env.DASHBOARD_PASS || 'admin';
const CONNECTIONS = parseInt(process.env.BENCH_CONNECTIONS || '10', 10);
const DURATION = parseInt(process.env.BENCH_DURATION || '30', 10);

const ENDPOINTS = [
  { path: '/api/dashboard/summary', label: 'Dashboard summary' },
  { path: '/api/containers', label: 'Containers list' },
  { path: '/api/metrics/anomalies?limit=50', label: 'Metric anomalies' },
  { path: '/api/networks', label: 'Networks list' },
  { path: '/api/stacks', label: 'Stacks list' },
];

// ── Helpers ──────────────────────────────────────────────────────

async function login() {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
  if (!res.ok) {
    throw new Error(`Login failed: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  return data.token;
}

function runBenchmark(url, token) {
  return new Promise((resolve, reject) => {
    const instance = autocannon({
      url,
      connections: CONNECTIONS,
      duration: DURATION,
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    instance.on('done', resolve);
    instance.on('error', reject);
  });
}

function formatNum(n) {
  return typeof n === 'number' ? n.toLocaleString() : String(n);
}

// ── Main ─────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(70));
  console.log('Autocannon HTTP Throughput Benchmarks');
  console.log('='.repeat(70));
  console.log(`  Target:      ${BASE_URL}`);
  console.log(`  Connections: ${CONNECTIONS}`);
  console.log(`  Duration:    ${DURATION}s per endpoint`);
  console.log(`  Endpoints:   ${ENDPOINTS.length}`);
  console.log();

  // Authenticate once
  console.log('Authenticating...');
  let token;
  try {
    token = await login();
    console.log(`  Token acquired: ${token.substring(0, 40)}...\n`);
  } catch (err) {
    console.error(`FATAL: ${err.message}`);
    process.exit(1);
  }

  const results = [];

  for (const endpoint of ENDPOINTS) {
    const url = `${BASE_URL}${endpoint.path}`;
    console.log(`Benchmarking: ${endpoint.label} (${endpoint.path})`);
    console.log(`  ${CONNECTIONS} connections × ${DURATION}s ...`);

    try {
      const result = await runBenchmark(url, token);
      results.push({
        label: endpoint.label,
        path: endpoint.path,
        reqPerSec: Math.round(result.requests.average),
        p50: result.latency.p50,
        p95: result.latency.p97_5,
        p99: result.latency.p99,
        errors: result.errors,
        timeouts: result.timeouts,
        '2xx': result['2xx'],
        non2xx: result.non2xx,
      });
      console.log(
        `  → ${formatNum(Math.round(result.requests.average))} req/s | ` +
        `p50=${result.latency.p50}ms | p95=${result.latency.p97_5}ms | ` +
        `p99=${result.latency.p99}ms | errors=${result.errors}\n`,
      );
    } catch (err) {
      console.error(`  ERROR: ${err.message}\n`);
      results.push({
        label: endpoint.label,
        path: endpoint.path,
        reqPerSec: 0,
        p50: 0,
        p95: 0,
        p99: 0,
        errors: -1,
        timeouts: 0,
        '2xx': 0,
        non2xx: 0,
      });
    }
  }

  // ── Summary table ──────────────────────────────────────────────

  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));

  // Header
  const cols = ['Endpoint', 'req/s', 'p50', 'p95', 'p99', 'Errors'];
  const widths = [22, 8, 7, 7, 7, 8];

  const header = cols.map((c, i) => c.padEnd(widths[i])).join(' | ');
  const separator = widths.map((w) => '-'.repeat(w)).join('-+-');

  console.log(header);
  console.log(separator);

  for (const r of results) {
    const shortLabel = r.label.length > 20
      ? r.label.substring(0, 20) + '..'
      : r.label;
    const row = [
      shortLabel.padEnd(widths[0]),
      String(r.reqPerSec).padStart(widths[1]),
      String(r.p50).padStart(widths[2]),
      String(r.p95).padStart(widths[3]),
      String(r.p99).padStart(widths[4]),
      String(r.errors).padStart(widths[5]),
    ];
    console.log(row.join(' | '));
  }

  console.log();

  const totalErrors = results.reduce((s, r) => s + Math.max(r.errors, 0), 0);
  if (totalErrors > 0) {
    console.log(`  !! ${totalErrors} total errors across all benchmarks`);
  } else {
    console.log('  All benchmarks completed without errors.');
  }

  process.exit(totalErrors > 0 ? 1 : 0);
}

main();
