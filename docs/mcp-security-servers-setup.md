# Security MCP Servers Setup

Three security-focused MCP servers for vulnerability scanning and CVE intelligence, designed to work with the dashboard's LLM chat assistant via the existing MCP orchestrator.

| Server | Purpose | Tools | Port |
|--------|---------|-------|------|
| **NVD MCP** | National Vulnerability Database CVE lookups | 2 | 9090 |
| **Grype MCP** | Container image & filesystem vulnerability scanning | 5 | 8788 |
| **Snyk MCP** | SCA, SAST, IaC, and container scanning | 6 | 8789 |

## Prerequisites

### Required

- Main dashboard stack running (`docker compose -f docker/docker-compose.dev.yml up -d`) — this creates the `dashboard-net` network

### Optional API Keys

| Key | Purpose | Get It |
|-----|---------|--------|
| `NVD_API_KEY` | Higher NVD rate limits (5 → 50 req/30s) | [nvd.nist.gov/developers](https://nvd.nist.gov/developers/request-an-api-key) |
| `SNYK_TOKEN` | Required for Snyk scans | [app.snyk.io/account](https://app.snyk.io/account) |

Add these to your `.env` file:

```ini
NVD_API_KEY=your-key-here
SNYK_TOKEN=your-token-here
```

## Quick Start

```bash
# 1. Start the main dashboard stack (creates dashboard-net)
docker compose -f docker/docker-compose.dev.yml up -d

# 2. Start security MCP servers
docker compose -f docker/docker-compose.security-mcp.yml up -d --build

# 3. Verify all servers respond
curl http://localhost:9090/mcp    # NVD
curl http://localhost:8788/mcp    # Grype
curl http://localhost:8789/mcp    # Snyk
```

## Register in Dashboard

Navigate to **Settings > MCP Servers > Add** and register each server:

| Name | Transport | URL |
|------|-----------|-----|
| `nvd` | `http` | `http://nvd-mcp:8000/mcp` |
| `grype` | `http` | `http://grype-mcp:8000/mcp` |
| `snyk` | `http` | `http://snyk-mcp:8000/mcp` |

> **Note:** Use the Docker service names (`nvd-mcp`, `grype-mcp`, `snyk-mcp`) since the backend connects via the `dashboard-net` Docker network. The `localhost` ports (9090, 8788, 8789) are for external debugging only.

## Tool Reference

### NVD MCP

| Tool | Description | Args |
|------|-------------|------|
| `get_cve` | Fetch details for a specific CVE | `cve_id` (e.g. "CVE-2024-1234") |
| `search_cves` | Search NVD by keyword | `keyword`, `results` (1-50, default 10) |

Returns: CVSS scores, descriptions, CWE IDs, references.

### Grype MCP

| Tool | Description | Args |
|------|-------------|------|
| `scan_image` | Scan container image for vulns | `image`, `severity` (optional filter) |
| `scan_dir` | Scan directory dependencies | `path` |
| `scan_sbom` | Scan SBOM file | `path` (CycloneDX/SPDX) |
| `db_status` | Check vuln database status | — |
| `db_update` | Update vuln database | — |

Severity filter values: `negligible`, `low`, `medium`, `high`, `critical`

### Snyk MCP

| Tool | Description | Args |
|------|-------------|------|
| `snyk_test` | Open-source dependency scan (SCA) | `path`, `package_manager` (optional) |
| `snyk_code_test` | Static analysis (SAST) | `path` |
| `snyk_container_test` | Container image scan | `image` |
| `snyk_iac_test` | Infrastructure as Code scan | `path` |
| `snyk_version` | Get CLI version | — |
| `snyk_auth_status` | Check auth status | — |

## Example LLM Prompts

### CVE Research

```text
Look up CVE-2024-3094 and tell me the severity, affected software, and recommended remediation.
```

### Image Security Audit

```text
Scan the nginx:latest image for vulnerabilities and summarize any critical or high severity issues.
```

### Dependency Check

```text
Run a Snyk SCA scan on /app and identify the top 5 most severe vulnerabilities with fix recommendations.
```

### Combined Security Assessment

```text
For our nginx:latest container:
1. Scan it with Grype for image vulnerabilities
2. Look up the top 3 CVEs in NVD for full details
3. Summarize the risk level and recommended actions
```

## Stopping the Servers

```bash
docker compose -f docker/docker-compose.security-mcp.yml down
```

To also remove built images:

```bash
docker compose -f docker/docker-compose.security-mcp.yml down --rmi local
```

## Resource Limits

| Server | CPU | Memory | Reason |
|--------|-----|--------|--------|
| NVD MCP | 0.5 | 256 MB | Lightweight HTTP client |
| Grype MCP | 1.0 | 1 GB | Large image scans need memory |
| Snyk MCP | 1.0 | 1 GB | Full SCA/SAST analysis |

## Troubleshooting

### "Rate limited" from NVD

NVD allows 5 requests per 30 seconds without an API key. Set `NVD_API_KEY` in `.env` for 50 req/30s.

### Grype scan times out

Large images (e.g. `kalilinux/kali-rolling`) can take >60s. The default timeout is 120s. If consistently timing out, the image may be too large for the container's memory limit — increase `memory` in the compose file.

### Snyk "authentication required"

Snyk requires a token for all scan types. Get a free token at [app.snyk.io/account](https://app.snyk.io/account) and set `SNYK_TOKEN` in `.env`.

### Container can't reach NVD API

Ensure the container has internet access. If behind a proxy, set `HTTP_PROXY`/`HTTPS_PROXY` environment variables in the compose file.

### "dashboard-net not found"

Start the main dashboard stack first — it creates the `dashboard-net` network:

```bash
docker compose -f docker/docker-compose.dev.yml up -d
```
