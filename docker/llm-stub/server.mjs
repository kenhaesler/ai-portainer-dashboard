// Deterministic OpenAI-compatible LLM stub for the E2E stack (#1521).
//
// The dashboard's chat assistant runs server-side: the browser talks to the
// backend over Socket.IO (`/llm` namespace), and the backend calls an
// OpenAI-compatible chat-completions endpoint over HTTP. CI has no reachable
// LLM (OLLAMA_BASE_URL points at an unused loopback), so chat could only ever
// exercise the degraded path. This stub gives the backend a real, canned
// endpoint so `e2e/ai-chat.spec.ts` can drive the full streamed chat flow
// offline and deterministically.
//
// Wired via `LLM_API_URL=http://llm-stub:8090/v1` on the backend in
// docker/docker-compose.e2e.yml. The backend appends `/chat/completions` and
// derives `/models` (see resolveChatCompletionsUrl / resolveModelsUrl in
// packages/ai-intelligence/src/services/llm-client.ts).
//
// Zero dependencies — runs on a bare `node:*-alpine` image with no install.
import http from 'node:http';

const PORT = Number(process.env.PORT) || 8090;
const MODEL = process.env.STUB_MODEL || 'e2e-stub-model';

// Canned assistant reply. The distinctive "E2E stub" marker lets the spec
// assert the streamed text rendered without matching on incidental words.
const REPLY = 'Hello from the E2E stub. Your fleet looks healthy and all containers are running normally.';

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

/** Stream the canned reply back as OpenAI-style SSE `choices[].delta.content` chunks. */
function streamCompletion(res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });

  const words = REPLY.split(' ');
  let i = 0;
  const tick = () => {
    if (res.writableEnded) return;
    if (i < words.length) {
      const delta = (i === 0 ? '' : ' ') + words[i];
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`);
      i += 1;
      // Small inter-chunk delay so the client observes genuine streaming.
      setTimeout(tick, 15);
    } else {
      res.write('data: [DONE]\n\n');
      res.end();
    }
  };
  tick();
}

const server = http.createServer((req, res) => {
  const url = (req.url || '').split('?')[0];

  // Liveness for the compose healthcheck.
  if (req.method === 'GET' && (url === '/health' || url === '/')) {
    return sendJson(res, 200, { status: 'ok', model: MODEL });
  }

  // Model listing — backend maps `.data[].id` to the model dropdown.
  if (req.method === 'GET' && url.endsWith('/models')) {
    return sendJson(res, 200, { object: 'list', data: [{ id: MODEL, object: 'model', owned_by: 'e2e-stub' }] });
  }

  // Chat completions (streaming). The request body is intentionally ignored —
  // the stub is deterministic regardless of prompt.
  if (req.method === 'POST' && url.endsWith('/chat/completions')) {
    let drained = 0;
    req.on('data', (c) => { drained += c.length; });
    req.on('end', () => streamCompletion(res));
    req.on('error', () => { if (!res.writableEnded) res.end(); });
    return undefined;
  }

  return sendJson(res, 404, { error: { message: `No stub route for ${req.method} ${url}` } });
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`llm-stub listening on :${PORT} (model=${MODEL})`);
});
