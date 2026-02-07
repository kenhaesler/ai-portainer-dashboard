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
