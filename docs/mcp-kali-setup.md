# MCP / Kali Lab Setup

The dev and local compose stacks include a `kali-mcp` service exposed at `http://127.0.0.1:8787/mcp`. This provides a sandboxed Kali Linux container for running smoke tests and security checks via Claude Code's MCP integration.

## Setup

### 1. Configure command policy

In your `.env` file:

```ini
# Restrictive allowlist (recommended)
KALI_MCP_ALLOWED_COMMANDS=whoami,id,uname,ip,df,free,ps,ss,ls,cat

# Or allow everything (high risk)
# KALI_MCP_ALLOWED_COMMANDS=all
```

### 2. Start (or restart) the stack

```bash
docker compose -f docker/docker-compose.dev.yml up -d --build
```

### 3. Register MCP in Claude Code

```bash
claude mcp add --transport http kali-lab http://127.0.0.1:8787/mcp
claude mcp list
claude mcp get kali-lab
```

### 4. Activate

In Claude Code, run `/mcp` if the server requires interactive auth.

## Testing the App via MCP

Use the `kali-lab` MCP tool `run_allowed` for black-box smoke tests from Claude Code.

1. Ensure the app stack is running:

```bash
docker compose -f docker/docker-compose.dev.yml up -d
```

2. In Claude Code, ask it to run checks with `kali-lab`:

- Backend health:
  - `curl -i http://host.docker.internal:3051/health`
- Frontend status:
  - `curl -I http://host.docker.internal:5273`
- Open ports:
  - `ss -tulpen`

3. Use the same pattern for API smoke/regression checks (auth, read-only endpoints, and expected status codes).

**Notes:**
- If `KALI_MCP_ALLOWED_COMMANDS` is not `all`, include required commands (`curl`, `ss`, `jq`, etc.) in the allowlist.
- From inside the Kali container, use `host.docker.internal` to reach host-published app ports.

## Claude Prompt Examples

Copy/paste these into Claude Code to run automated checks:

### Smoke Test

```text
Use kali-lab MCP and run these smoke tests:
1) run_allowed("curl -i http://host.docker.internal:3051/health")
2) run_allowed("curl -I http://host.docker.internal:5273")
3) run_allowed("curl -s http://host.docker.internal:3051/api/auth/session")
4) run_allowed("ss -tulpen")
Then summarize status codes, failures, and likely root cause.
```

### Login Flow Test

```text
Use kali-lab MCP for login flow test:
1) run_allowed("curl -i -X POST http://host.docker.internal:3051/api/auth/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"changeme123"}'")
2) If token/cookie returned, call:
   run_allowed("curl -i http://host.docker.internal:3051/api/auth/session -H 'Authorization: Bearer <TOKEN>'")
Report whether auth works end-to-end.
```

### Regression Check

```text
Use kali-lab MCP for regression check after fix:
- run_allowed("curl -i http://host.docker.internal:3051/health")
- run_allowed("curl -i http://host.docker.internal:3051/api/containers")
- run_allowed("curl -I http://host.docker.internal:5273")
Compare with expected outcomes:
- /health = 200
- frontend HEAD = 200/304
- API should not return 5xx
Return pass/fail checklist.
```
