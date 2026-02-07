# Kali MCP Server (Claude Code)

## Use with Docker Compose (repo stack)

`kali-mcp` is already included in `docker-compose.dev.yml` and `docker-compose.local.yml`.

1. Set command policy in `.env`:

```ini
# Restrictive allowlist (recommended)
KALI_MCP_ALLOWED_COMMANDS=whoami,id,uname,ip,df,free,ps,ss,ls,cat

# Or allow everything (high risk)
# KALI_MCP_ALLOWED_COMMANDS=all
```

2. Start service with the stack:

```bash
docker compose -f docker-compose.dev.yml up -d --build kali-mcp
```

3. Register in Claude Code:

```bash
claude mcp add --transport http kali-lab http://127.0.0.1:8787/mcp
claude mcp list
claude mcp get kali-lab
```

4. If prompted, run `/mcp` in Claude Code to complete auth.

## Test app via MCP (Claude Code)

After registration, use `run_allowed` to execute black-box checks against your running stack.

Example checks:
- Backend health:
  - `curl -i http://host.docker.internal:3051/health`
- Frontend status:
  - `curl -I http://host.docker.internal:5273`
- Port visibility:
  - `ss -tulpen`

Tips:
- If you are not using `KALI_MCP_ALLOWED_COMMANDS=all`, make sure required commands are in the allowlist (`curl`, `ss`, `jq`, etc.).
- Use `host.docker.internal` from the container to reach host-exposed ports.

### Claude prompt examples (copy/paste)

```text
Use kali-lab MCP and run these smoke tests:
1) run_allowed("curl -i http://host.docker.internal:3051/health")
2) run_allowed("curl -I http://host.docker.internal:5273")
3) run_allowed("curl -s http://host.docker.internal:3051/api/auth/session")
4) run_allowed("ss -tulpen")
Then summarize status codes, failures, and likely root cause.
```

```text
Use kali-lab MCP for login flow test:
1) run_allowed("curl -i -X POST http://host.docker.internal:3051/api/auth/login -H 'Content-Type: application/json' -d '{\"username\":\"admin\",\"password\":\"changeme123\"}'")
2) If token/cookie returned, call:
   run_allowed("curl -i http://host.docker.internal:3051/api/auth/session -H 'Authorization: Bearer <TOKEN>'")
Report whether auth works end-to-end.
```

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

## Build (standalone)

```bash
docker build -t kali-mcp:latest tools/kali-mcp
```

## Run

```bash
docker run --rm -p 8787:8000 \
  -e ALLOWED_COMMANDS="whoami,id,uname,ip,df,free,ps,ss,ls,cat" \
  kali-mcp:latest
```

## Register in Claude Code

```bash
claude mcp add --transport http kali-lab http://127.0.0.1:8787/mcp
claude mcp list
claude mcp get kali-lab
```

## Notes

- MCP endpoint is `http://127.0.0.1:8787/mcp`.
- `run_allowed` executes commands from `ALLOWED_COMMANDS`; set `ALLOWED_COMMANDS=all` to allow all commands.
- Keep this container isolated and do not broaden command allowlists without review.
