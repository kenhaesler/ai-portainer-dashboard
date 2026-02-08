#!/usr/bin/env node

/**
 * LLM chat (/llm namespace) load test.
 *
 * Spawns 5 concurrent Socket.IO clients on the /llm namespace.
 * Each sends 3 randomized chat messages and collects streaming
 * response metrics (latency, chunk count, tool calls, errors).
 *
 * Requires a running Ollama instance — separated from loadtest:all
 * for this reason.
 *
 * Usage:
 *   npm run loadtest:llm
 *   node loadtests/llm-load-test.mjs
 *
 * Env vars (with defaults):
 *   BASE_URL          http://localhost:3051
 *   DASHBOARD_USER    admin
 *   DASHBOARD_PASS    admin
 *   LLM_SESSIONS      5
 *   LLM_MESSAGES       3
 */

import { io } from 'socket.io-client';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3051';
const USERNAME = process.env.DASHBOARD_USER || 'admin';
const PASSWORD = process.env.DASHBOARD_PASS || 'admin';
const NUM_SESSIONS = parseInt(process.env.LLM_SESSIONS || '5', 10);
const MSGS_PER_SESSION = parseInt(process.env.LLM_MESSAGES || '3', 10);
const THINK_MS = 2_000;
const MESSAGE_TIMEOUT_MS = 60_000; // Ollama can be slow

const CHAT_MESSAGES = [
  'Which containers are using the most CPU right now?',
  'Show me containers with high memory usage.',
  'Are there any stopped containers that should be running?',
  'Summarize the health of my Docker environment.',
  'What anomalies have been detected recently?',
  'Which stacks are currently running?',
  'Tell me about network connectivity between containers.',
  'Are there any security concerns with my running containers?',
  'What is the average CPU usage across all containers?',
  'List containers that restarted recently.',
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

function randomMessage() {
  return CHAT_MESSAGES[Math.floor(Math.random() * CHAT_MESSAGES.length)];
}

function connectLlm(token) {
  return new Promise((resolve, reject) => {
    const socket = io(`${BASE_URL}/llm`, {
      auth: { token },
      query: { token },
      transports: ['websocket'],
      reconnection: false,
      timeout: 10_000,
    });

    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', (err) =>
      reject(new Error(`/llm connect: ${err.message}`)),
    );

    setTimeout(() => reject(new Error('/llm: connection timeout')), 10_000);
  });
}

/**
 * Sends a chat message and waits for the full streamed response.
 * Returns metrics for this single message exchange.
 */
function sendMessage(socket, text) {
  return new Promise((resolve) => {
    const metrics = {
      text: text.substring(0, 50),
      startMs: Date.now(),
      endMs: 0,
      latencyMs: 0,
      chunks: 0,
      toolCalls: 0,
      error: null,
    };

    let timeout;

    const cleanup = () => {
      clearTimeout(timeout);
      socket.off('chat:chunk', onChunk);
      socket.off('chat:end', onEnd);
      socket.off('chat:error', onError);
      socket.off('chat:tool_call', onToolCall);
    };

    const onChunk = () => {
      metrics.chunks++;
    };

    const onToolCall = () => {
      metrics.toolCalls++;
    };

    const onEnd = () => {
      metrics.endMs = Date.now();
      metrics.latencyMs = metrics.endMs - metrics.startMs;
      cleanup();
      resolve(metrics);
    };

    const onError = (err) => {
      metrics.endMs = Date.now();
      metrics.latencyMs = metrics.endMs - metrics.startMs;
      metrics.error = err?.message || String(err);
      cleanup();
      resolve(metrics);
    };

    socket.on('chat:chunk', onChunk);
    socket.on('chat:end', onEnd);
    socket.on('chat:error', onError);
    socket.on('chat:tool_call', onToolCall);

    timeout = setTimeout(() => {
      metrics.endMs = Date.now();
      metrics.latencyMs = metrics.endMs - metrics.startMs;
      metrics.error = 'timeout';
      cleanup();
      resolve(metrics);
    }, MESSAGE_TIMEOUT_MS);

    socket.emit('chat:message', { text });
  });
}

// ── Per-session runner ───────────────────────────────────────────

async function runSession(sessionId, token) {
  const session = {
    sessionId,
    connected: false,
    messages: [],
    error: null,
  };

  let socket;
  try {
    socket = await connectLlm(token);
    session.connected = true;

    for (let i = 0; i < MSGS_PER_SESSION; i++) {
      const msg = randomMessage();
      console.log(`  [session ${sessionId}] Sending message ${i + 1}/${MSGS_PER_SESSION}: "${msg.substring(0, 40)}..."`);

      const metrics = await sendMessage(socket, msg);
      session.messages.push(metrics);

      if (metrics.error) {
        console.log(`  [session ${sessionId}] Message ${i + 1} error: ${metrics.error}`);
      } else {
        console.log(
          `  [session ${sessionId}] Message ${i + 1} done: ` +
          `${metrics.latencyMs}ms, ${metrics.chunks} chunks, ${metrics.toolCalls} tool calls`,
        );
      }

      // Think between messages (except the last one)
      if (i < MSGS_PER_SESSION - 1) {
        await new Promise((r) => setTimeout(r, THINK_MS));
      }
    }

    // Clear conversation and disconnect
    socket.emit('chat:clear');
    socket.disconnect();
  } catch (err) {
    session.error = err.message;
    console.error(`  [session ${sessionId}] Fatal: ${err.message}`);
    if (socket) socket.disconnect();
  }

  return session;
}

// ── Main ─────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(60));
  console.log('LLM Chat Load Test — /llm namespace');
  console.log('='.repeat(60));
  console.log(`  Target:           ${BASE_URL}`);
  console.log(`  Concurrent users: ${NUM_SESSIONS}`);
  console.log(`  Messages/user:    ${MSGS_PER_SESSION}`);
  console.log(`  Total messages:   ${NUM_SESSIONS * MSGS_PER_SESSION}`);
  console.log(`  Think time:       ${THINK_MS}ms between messages`);
  console.log(`  Message timeout:  ${MESSAGE_TIMEOUT_MS / 1000}s`);
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

  // Stagger session starts (200ms apart)
  console.log(`Spawning ${NUM_SESSIONS} sessions (200ms stagger)...\n`);
  const startTime = Date.now();

  const promises = [];
  for (let i = 0; i < NUM_SESSIONS; i++) {
    promises.push(
      new Promise((resolve) => setTimeout(resolve, i * 200))
        .then(() => runSession(i + 1, token)),
    );
  }

  const results = await Promise.all(promises);
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

  // ── Summary ──────────────────────────────────────────────────

  console.log('\n' + '='.repeat(60));
  console.log('RESULTS');
  console.log('='.repeat(60));

  const connected = results.filter((r) => r.connected).length;
  const allMessages = results.flatMap((r) => r.messages);
  const successful = allMessages.filter((m) => !m.error);
  const failed = allMessages.filter((m) => m.error);
  const latencies = successful.map((m) => m.latencyMs).sort((a, b) => a - b);
  const totalChunks = successful.reduce((s, m) => s + m.chunks, 0);
  const totalToolCalls = successful.reduce((s, m) => s + m.toolCalls, 0);

  const p50 = latencies[Math.floor(latencies.length * 0.5)] || 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;
  const avgLatency = latencies.length > 0
    ? Math.round(latencies.reduce((s, l) => s + l, 0) / latencies.length)
    : 0;

  console.log(`  Duration:          ${totalTime}s`);
  console.log(`  Sessions connected: ${connected}/${NUM_SESSIONS}`);
  console.log(`  Messages sent:     ${allMessages.length}`);
  console.log(`  Messages OK:       ${successful.length}`);
  console.log(`  Messages failed:   ${failed.length}`);
  console.log(`  Total chunks:      ${totalChunks}`);
  console.log(`  Total tool calls:  ${totalToolCalls}`);
  console.log(`  Avg latency:       ${avgLatency}ms`);
  console.log(`  Latency p50:       ${p50}ms`);
  console.log(`  Latency p95:       ${p95}ms`);

  if (failed.length > 0) {
    console.log('\n  Failures:');
    for (const m of failed) {
      console.log(`    "${m.text}..." → ${m.error}`);
    }
  }

  console.log();
  if (failed.length === 0 && connected === NUM_SESSIONS) {
    console.log('  All sessions completed successfully.');
  } else {
    console.log('  !! Some sessions had errors — check output above.');
  }

  process.exit(failed.length > 0 ? 1 : 0);
}

main();
