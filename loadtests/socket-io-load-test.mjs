#!/usr/bin/env node

/**
 * Socket.IO load test for /monitoring and /remediation namespaces.
 *
 * Uses socket.io-client v4 directly (Artillery's built-in engine uses
 * Socket.IO v2 which is incompatible with our v4 server).
 *
 * Simulates 10 concurrent users connecting to both namespaces,
 * subscribing to events, holding connections for 30s, then disconnecting.
 *
 * Usage:
 *   npm run loadtest:socketio
 *   node loadtests/socket-io-load-test.mjs
 *
 * Env vars (with defaults):
 *   BASE_URL          http://localhost:3051
 *   DASHBOARD_USER    admin
 *   DASHBOARD_PASS    admin
 *   SOCKETIO_USERS    10
 */

import { io } from 'socket.io-client';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3051';
const USERNAME = process.env.DASHBOARD_USER || 'admin';
const PASSWORD = process.env.DASHBOARD_PASS || 'admin';
const NUM_USERS = parseInt(process.env.SOCKETIO_USERS || '10', 10);
const HOLD_DURATION_MS = 30_000;

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

function connectNamespace(token, namespace) {
  return new Promise((resolve, reject) => {
    const socket = io(`${BASE_URL}${namespace}`, {
      auth: { token },
      query: { token },
      transports: ['websocket'],
      reconnection: false,
      timeout: 10_000,
    });

    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', (err) => reject(new Error(`${namespace}: ${err.message}`)));

    setTimeout(() => reject(new Error(`${namespace}: connection timeout`)), 10_000);
  });
}

// ── Per-user session ─────────────────────────────────────────────

async function runUserSession(userId, token) {
  const metrics = {
    userId,
    monitoring: { connected: false, events: 0, errors: 0 },
    remediation: { connected: false, events: 0, errors: 0 },
    latencyMs: {},
  };

  try {
    // Connect to both namespaces in parallel
    const [monSocket, remSocket] = await Promise.all([
      connectNamespace(token, '/monitoring'),
      connectNamespace(token, '/remediation'),
    ]);

    metrics.monitoring.connected = true;
    metrics.remediation.connected = true;

    // Track incoming events
    monSocket.onAny(() => { metrics.monitoring.events++; });
    remSocket.onAny(() => { metrics.remediation.events++; });

    monSocket.on('error', () => { metrics.monitoring.errors++; });
    remSocket.on('error', () => { metrics.remediation.errors++; });

    // Monitoring: request history + subscribe
    const t0 = Date.now();
    monSocket.emit('insights:history', { limit: 20 });
    monSocket.emit('investigations:history', { limit: 10 });
    monSocket.emit('insights:subscribe', {});

    // Remediation: request action list
    remSocket.emit('actions:list', {});

    // Wait for first response to measure latency
    await new Promise((resolve) => {
      let resolved = false;
      const done = (label) => {
        if (!resolved) {
          metrics.latencyMs[label] = Date.now() - t0;
          resolved = true;
          resolve();
        }
      };
      monSocket.once('insights:history', () => done('insights:history'));
      monSocket.once('insights:error', () => done('insights:error'));
      remSocket.once('actions:list', () => done('actions:list'));
      remSocket.once('actions:error', () => done('actions:error'));
      // Fallback timeout
      setTimeout(() => done('timeout'), 5_000);
    });

    // Hold connection for the sustained duration
    await new Promise((r) => setTimeout(r, HOLD_DURATION_MS));

    // Unsubscribe and disconnect
    monSocket.emit('insights:unsubscribe');
    monSocket.disconnect();
    remSocket.disconnect();
  } catch (err) {
    metrics.monitoring.errors++;
    metrics.remediation.errors++;
    console.error(`  [user ${userId}] Error: ${err.message}`);
  }

  return metrics;
}

// ── Main ─────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(60));
  console.log('Socket.IO Load Test — /monitoring + /remediation');
  console.log('='.repeat(60));
  console.log(`  Target:    ${BASE_URL}`);
  console.log(`  Users:     ${NUM_USERS}`);
  console.log(`  Hold time: ${HOLD_DURATION_MS / 1000}s`);
  console.log();

  // Login once — share token across all virtual users
  console.log('Authenticating...');
  let token;
  try {
    token = await login();
    console.log(`  Token acquired: ${token.substring(0, 40)}...`);
  } catch (err) {
    console.error(`FATAL: ${err.message}`);
    process.exit(1);
  }

  // Stagger user connections (100ms apart to avoid thundering herd)
  console.log(`\nSpawning ${NUM_USERS} users (100ms stagger)...\n`);
  const startTime = Date.now();

  const promises = [];
  for (let i = 0; i < NUM_USERS; i++) {
    promises.push(
      new Promise((resolve) => setTimeout(resolve, i * 100))
        .then(() => runUserSession(i + 1, token))
    );
  }

  const results = await Promise.all(promises);
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

  // ── Summary ──────────────────────────────────────────────────

  console.log('\n' + '='.repeat(60));
  console.log('RESULTS');
  console.log('='.repeat(60));

  const monConnected = results.filter((r) => r.monitoring.connected).length;
  const remConnected = results.filter((r) => r.remediation.connected).length;
  const totalMonEvents = results.reduce((s, r) => s + r.monitoring.events, 0);
  const totalRemEvents = results.reduce((s, r) => s + r.remediation.events, 0);
  const totalErrors = results.reduce(
    (s, r) => s + r.monitoring.errors + r.remediation.errors,
    0,
  );

  const latencies = results
    .map((r) => Object.values(r.latencyMs)[0])
    .filter(Boolean)
    .sort((a, b) => a - b);

  const p50 = latencies[Math.floor(latencies.length * 0.5)] || 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;

  console.log(`  Duration:            ${totalTime}s`);
  console.log(`  /monitoring connected: ${monConnected}/${NUM_USERS}`);
  console.log(`  /remediation connected: ${remConnected}/${NUM_USERS}`);
  console.log(`  Total /monitoring events: ${totalMonEvents}`);
  console.log(`  Total /remediation events: ${totalRemEvents}`);
  console.log(`  Total errors:        ${totalErrors}`);
  console.log(`  First-response p50:  ${p50}ms`);
  console.log(`  First-response p95:  ${p95}ms`);
  console.log();

  if (totalErrors > 0) {
    console.log('  !! Some errors occurred — check output above');
  } else {
    console.log('  All sessions completed successfully.');
  }

  process.exit(totalErrors > 0 ? 1 : 0);
}

main();
