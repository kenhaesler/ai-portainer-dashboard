# Security MCP Servers Research

> **Date**: 2026-02-08
> **Status**: Research complete, ready for implementation planning
> **Context**: Expanding the dashboard's security capabilities via MCP tool calling

---

## Overview

Research into 4 security-focused MCP servers that can be integrated into the AI Portainer Dashboard's existing MCP orchestrator to provide container vulnerability scanning, code analysis, and vulnerability intelligence through the LLM chat assistant.

### The Fundamental Difference: What Each Tool Actually Is

| Tool | Category | One-liner |
|------|----------|-----------|
| **Trivy** | All-in-one scanner | "Swiss Army knife" — scans containers, code, IaC, secrets, licenses, SBOMs |
| **Grype** | Focused vulnerability scanner | "Precision rifle" — SBOM-first scanning with highest accuracy |
| **Snyk** | Managed security platform | "Security concierge" — scanning + fix PRs + SAST + proprietary intelligence |
| **NVD** | Vulnerability database | "Encyclopedia" — enrichment/lookup, NOT a scanner |

---

## Detailed Comparison Matrix

| Feature | Trivy | Grype | Snyk | NVD MCP |
|---------|-------|-------|------|---------|
| **Type** | Scanner | Scanner | Scanner + Platform | Database lookup |
| **Scans containers?** | Yes | Yes | Yes | No |
| **Scans code (SAST)?** | No | No | **Yes (Snyk Code)** | No |
| **Scans IaC?** | Yes (Dockerfile, Terraform, K8s) | No | Yes | No |
| **Detects secrets?** | Yes | No | No | No |
| **License scanning?** | Yes | No | Yes (paid) | No |
| **SBOM generation?** | Yes (CycloneDX, SPDX) | Via Syft companion | Yes | No |
| **VEX support?** | No | **Yes** | No | No |
| **Fix suggestions?** | No | No | **Yes (auto PRs)** | No |
| **Vulnerability DB** | NVD + 9 vendor DBs | GitHub Advisory + NVD | Proprietary + NVD | NVD only |
| **DB update frequency** | Every 6 hours | Multiple times/day | Continuous | Continuous |
| **Pricing** | Free (Apache 2.0) | Free (Apache 2.0) | Freemium (400 tests/mo free) | Free (MIT) |
| **MCP transport** | stdio / SSE / HTTP | stdio only | stdio (via CLI) | stdio / SSE |
| **MCP tools count** | ~7 tools | 9 tools | 11 tools | 2 tools |

---

## Tool 1: Trivy MCP — The All-in-One Scanner

**Repository**: [aquasecurity/trivy-mcp](https://github.com/aquasecurity/trivy-mcp) (MIT license)
**MCP version**: v0.0.20 | **Trivy version**: v0.69.1

### MCP Tools Exposed

- `natural_language_scan` — Query security in plain language
- `filesystem_scan` — Scan project directories
- `image_scan` — Scan container images for CVEs
- `remote_repo_analysis` — Analyze remote git repos
- `assurance_integration` — Optional Aqua Platform integration

### What Makes It Unique

- **Broadest coverage** — One tool handles vulns + misconfigs + secrets + licenses + SBOMs
- **Vendor-priority database** — Uses vendor severity over NVD (fewer false positives)
- **Fastest scanning** — Seconds for typical images, local caching for subsequent scans
- **Air-gapped support** — Full offline operation with pre-downloaded databases
- **Resource needs**: ~100m CPU / 128Mi memory (up to 500m/512Mi for large scans)

### Scanning Targets Supported

- Container images (Docker, OCI)
- Local filesystems (project directories)
- Git repositories (remote and local)
- Kubernetes clusters and manifests
- Infrastructure as Code (Terraform, CloudFormation, Kubernetes YAML, Dockerfile)
- SBOM files (CycloneDX, SPDX consumption)
- Binary artifacts
- Cloud configurations (AWS, Azure, GCP)

### Vulnerability Databases Used

Trivy aggregates data from multiple sources, prioritizing vendor-specific advisories:

- NVD (National Vulnerability Database) — fallback for severity scoring
- GitHub Advisory Database
- OS-specific databases: Red Hat, Debian, Ubuntu, Alpine, SUSE, Oracle Linux, Amazon Linux, Photon OS, CBL-Mariner
- 9+ additional vendor-specific sources
- OSV (Open Source Vulnerability Database)
- Bitnami Vulnerability Database

Database updated every 6 hours via GitHub Container Registry (GHCR).

### SBOM Capabilities

Bidirectional SBOM support:
- **Generation**: CycloneDX (JSON/XML), SPDX (JSON/tag-value)
- **Consumption**: Reads external SBOMs and scans for vulnerabilities

### Output Formats

JSON, Table, SARIF, CycloneDX, SPDX, Template (Go), GitHub Security tab

### Best For Dashboard

Scanning container images managed by Portainer. User asks "scan nginx:latest" and gets an immediate vulnerability report.

---

## Tool 2: Grype MCP — The Accuracy Specialist

**Repository**: [anchore/grype-mcp](https://github.com/anchore/grype-mcp) (Apache 2.0)
**MCP version**: v0.4.0

### MCP Tools Exposed (9 total)

| Tool | Purpose |
|------|---------|
| `find_grype` | Check if Grype is installed |
| `update_grype` | Install/upgrade Grype |
| `get_db_info` | Vulnerability DB status |
| `update_db` | Refresh vulnerability database |
| `scan_dir` | Scan project directories |
| `scan_purl` | Scan individual packages (e.g., `pkg:npm/lodash@4.17.20`) |
| `scan_image` | Scan container images |
| `search_vulns` | Query by CVE/package/CPE |
| `get_vuln_details` | Deep-dive into CVE info |

### What Makes It Unique

- **27% more findings than Trivy** in academic research (Montana State University, 927 Docker images)
- **SBOM-first architecture** — Syft generates SBOM, Grype scans it (decoupled, reusable)
- **VEX support** — Suppress known false positives with Vulnerability Exploitability eXchange documents
- **Ecosystem-based matching** — GitHub Advisory matching by package ecosystem (not just CPE), reducing false positives
- **Smallest database updates** — Incremental downloads (bandwidth-friendly)

### Syft Integration

Syft is Anchore's SBOM generation tool. The SBOM-first workflow:

```
1. Syft scans artifact → Generates SBOM (CycloneDX/SPDX/Syft JSON)
2. Grype scans SBOM → Identifies vulnerabilities in components
3. Grype outputs results → Multiple formats (CycloneDX, SPDX, SARIF, JSON)
```

Key advantage: Separating SBOM generation from scanning enables reusable SBOMs, decoupled workflows, and VEX support for suppressing false positives.

### Grype vs Trivy: Head-to-Head

| Aspect | Grype | Trivy |
|--------|-------|-------|
| **Philosophy** | Specialized vulnerability detection with exceptional accuracy | All-in-one scanner (vulnerabilities, misconfigurations, secrets, SBOM, licenses) |
| **Vulnerability Coverage** | 603,259 vulns across 927 test images | 473,661 vulns across same test set |
| **Detection Rate** | Found vulns in 84.6% of cases where results differed | Lower detection rate |
| **False Positives** | Lower (ecosystem-based matching) | Higher (CPE-based matching) |
| **Speed** | Slower (thoroughness) | Faster (direct scanning) |
| **Database Updates** | Incremental (small downloads) | Full updates (larger downloads) |
| **SBOM Tool** | Uses Syft (separate tool) | Built-in generation |
| **VEX Support** | Yes | No |
| **Beyond Vulns** | No | Yes (secrets, misconfigs, license scanning) |

### Best For Dashboard

Second-opinion scanning and SBOM generation. Especially valuable for `scan_purl` — user asks "is lodash 4.17.20 vulnerable?" and gets an instant answer without scanning an entire image.

---

## Tool 3: Snyk MCP — The Managed Security Platform

**Repository**: [snyk/studio-mcp](https://github.com/snyk/studio-mcp) (Apache 2.0, closed to contributions)
**Status**: Early Access, available on all tiers including free

### MCP Tools Exposed (11 total)

| Tool | Purpose |
|------|---------|
| `snyk_sca_scan` | Dependency vulnerability analysis |
| `snyk_code_scan` | **Static code analysis (SAST)** — unique to Snyk |
| `snyk_iac_scan` | Infrastructure-as-Code scanning |
| `snyk_container_scan` | Container image scanning |
| `snyk_sbom_scan` | SBOM analysis |
| `snyk_aibom` | AI Bill of Materials |
| `snyk_trust` | Trust scoring |
| `snyk_auth` / `snyk_logout` / `snyk_auth_status` | Authentication management |
| `snyk_version` | Version info |

### What Makes It Unique

- **SAST capability** — The only tool that finds code-level vulnerabilities (XSS, SQLi, business logic flaws). Trivy and Grype cannot do this.
- **Proprietary vulnerability database** — Snyk researchers discover and publish vulns before NVD (often weeks ahead)
- **Priority Score** — 0-1,000 scale combining CVSS + exploit maturity + social signals (better than raw CVSS)
- **Automated fix PRs** — Suggests and generates pull requests with dependency upgrades

### Free Tier Limits

| Scan Type | Monthly Limit |
|-----------|---------------|
| SCA (dependencies) | 400 tests |
| Code (SAST) | 100 tests |
| IaC | 300 tests |
| Container | 100 tests |

Unlimited tests for public repositories. MCP server uses CLI (not API), so it's fully usable on free tier.

### Snyk vs Open-Source Tools

| Feature | Snyk | Trivy/Grype |
|---------|------|-------------|
| **SAST (code analysis)** | Yes (Snyk Code) | No |
| **SCA (dependency scanning)** | Yes | Yes (best-in-class) |
| **Proprietary database** | NVD + Snyk research | Public DBs only |
| **Priority Score** | 0-1,000 scale | CVSS only |
| **Automated fix PRs** | Yes | No |
| **Managed service** | Yes | No |
| **Cost** | Freemium ($0-25+/mo) | Free (OSS) |

### Best For Dashboard

SAST scanning of the dashboard's own codebase, and the proprietary database catching vulns before they hit NVD. Requires API key.

---

## Tool 4: NVD MCP — The Vulnerability Encyclopedia

**Repository**: [marcoeg/mcp-nvd](https://github.com/marcoeg/mcp-nvd) (MIT license)

### MCP Tools Exposed (2 tools)

| Tool | Parameters | Purpose |
|------|-----------|---------|
| `get_cve` | `cve_id`, `concise` | Look up specific CVE details |
| `search_cve` | `keyword`, `exact_match`, `results` (1-2000) | Search CVEs by keyword |

### What Makes It Unique

- **NOT a scanner** — This is the critical difference. NVD doesn't scan your containers; it explains what vulnerabilities mean.
- **Authoritative source** — U.S. government-maintained, CVSS scoring, CPE matching, CWE classification
- **Investigation tool** — When a scanner flags CVE-2024-1234, NVD tells you the CVSS breakdown, affected versions, patch links, exploit status
- **331,624+ CVE records** with continuous updates

### NVD API Rate Limits

| Authentication | Rate Limit |
|----------------|------------|
| Without API key | 5 requests / 30 seconds |
| With API key (free) | 50 requests / 30 seconds |

### NVD Data Includes

- **CVSS Scores** — Base, temporal, environmental across v2.0, v3.0, v3.1, v4.0
- **CPE Matching** — Identifies affected products and version ranges
- **CWE Mapping** — Root cause weakness categorization
- **Reference Tagging** — Categorized links to patches, exploits, vendor advisories
- **KEV Status** — Known Exploited Vulnerabilities catalog inclusion

### How NVD Complements Scanners

```
┌──────────────────────────────────────────────────────────────┐
│ Container Scanner (Trivy/Grype/Snyk)                         │
│ Finds: CVE-2024-1234 in nginx:1.21                           │
└───────────────┬──────────────────────────────────────────────┘
                │
                v
┌──────────────────────────────────────────────────────────────┐
│ NVD MCP Server: get_cve("CVE-2024-1234")                     │
│ Returns:                                                      │
│ - CVSS 9.8 (Critical) - Remote Code Execution                │
│ - CWE-787: Out-of-bounds Write                               │
│ - CPE: Affects nginx 1.18.0 through 1.21.6                   │
│ - References: Patch available, exploit published              │
│ - KEV: Yes (actively exploited in the wild)                   │
└──────────────────────────────────────────────────────────────┘
```

### Alternative Vulnerability Database MCP Servers

| MCP Server | Repository | Data Source | Key Features |
|------------|------------|-------------|--------------|
| **NVD MCP** | [marcoeg/mcp-nvd](https://github.com/marcoeg/mcp-nvd) | NIST NVD API v2.0 | CVSS/CPE/CWE enrichment, keyword search |
| **OSV.dev MCP** | [gleicon/mcp-osv](https://github.com/gleicon/mcp-osv) | OSV.dev (24+ sources) | Multi-source aggregation, faster updates than NVD |
| **CVE-Search MCP** | [roadwy/cve-search_mcp](https://github.com/roadwy/cve-search_mcp) | CVE-Search API | Vendor/product-centric queries, CAPEC enrichment |

### Best For Dashboard

Enrichment layer. Scanner finds CVE, LLM queries NVD, explains severity, affected versions, and patch availability in natural language.

---

## Use Case Decision Tree

```
"I need to scan a container image for vulnerabilities"
  -> Trivy (fastest, broadest) or Grype (most accurate)

"I need to find vulnerabilities in our source code"
  -> Snyk (only option with SAST)

"A scanner flagged CVE-2024-1234, what does it mean?"
  -> NVD MCP (lookup + CVSS breakdown + references)

"Is this specific npm package vulnerable?"
  -> Grype scan_purl (instant, package-level query)

"Scan our Dockerfile for misconfigurations"
  -> Trivy (misconfiguration detection) or Snyk (IaC scanning)

"Find secrets accidentally committed to our repo"
  -> Trivy (secret detection built-in)

"Generate an SBOM for compliance"
  -> Trivy (built-in) or Grype+Syft (SBOM-first workflow)

"Get automated fix PRs for vulnerabilities"
  -> Snyk (only option with auto-fix)
```

---

## Recommended Integration Order

| Priority | Tool | Why | Effort |
|----------|------|-----|--------|
| **1st** | **Trivy MCP** | Broadest coverage, fastest scans, open-source, best fit for container dashboard | Low (stdio, Docker) |
| **2nd** | **NVD MCP** | Enrichment for any CVE found by Trivy — explains severity and provides context | Low (stdio, Python) |
| **3rd** | **Grype MCP** | Second-opinion scanning + `scan_purl` for individual package queries + VEX | Low (stdio, Python) |
| **4th** | **Snyk MCP** | SAST capability + proprietary DB, but requires API key and has rate limits | Medium (auth setup) |

### Hybrid Example Flow

```
User: "Is my nginx container secure?"
  -> Trivy MCP: image_scan("nginx:latest") -> finds CVE-2024-1234
  -> NVD MCP: get_cve("CVE-2024-1234") -> CVSS 9.8, RCE, patch in 1.21.7
  -> LLM: "Your nginx has a critical remote code execution vulnerability.
           Upgrade to nginx 1.21.7 to fix it. [patch link]"
```

---

## Broader Security MCP Ecosystem

Beyond the 4 recommended tools, the security MCP landscape includes:

### Comprehensive Security Collections

- **FuzzingLabs Security Hub** ([GitHub](https://github.com/FuzzingLabs/mcp-security-hub)) — 28 Dockerized MCP servers covering Nmap, Shodan, Nuclei, SQLMap, YARA, VirusTotal, gitleaks, BloodHound, Burp Suite, radare2, and more

### MCP Security Auditing Tools

| Tool | Repository | Purpose |
|------|-----------|---------|
| **MCP-Scan** | [invariantlabs-ai/mcp-scan](https://github.com/invariantlabs-ai/mcp-scan) | Security scanner for MCP servers themselves |
| **mcpserver-audit** | [ModelContextProtocol-Security/mcpserver-audit](https://github.com/ModelContextProtocol-Security/mcpserver-audit) | Validate MCP servers are safe before use |
| **MCP Security Checklist** | [slowmist/MCP-Security-Checklist](https://github.com/slowmist/MCP-Security-Checklist) | Comprehensive security checklist for MCP deployments |

### SIEM & Log Analysis

| Tool | Repository | Status |
|------|-----------|--------|
| **Elastic (ELK) MCP** | [elastic.co MCP docs](https://www.elastic.co/docs/solutions/search/mcp) | Official |
| **Splunk MCP** | Official (controlled availability) | Early access |

---

## Security Considerations for MCP Integration

### Containerization Best Practices

```bash
# Run each MCP server in its own hardened container
docker run -i --init --rm \
  --read-only \
  --user 1000:1000 \
  --cap-drop=ALL \
  --memory=1g \
  --cpus=1.0 \
  <mcp-server-image>
```

### Security Controls

1. Run each MCP server in its own container with `--read-only --cap-drop=ALL`
2. Network-isolate MCP containers (no outbound except required endpoints)
3. Use `disabled_tools` array (already in dashboard schema) to allowlist specific tools
4. Audit log all tool invocations (already implemented via `writeAuditLog()`)
5. Sanitize scan results before displaying (redact internal IPs, credentials)
6. Rate-limit scanning operations
7. Run [MCP-Scan](https://github.com/invariantlabs-ai/mcp-scan) against new MCP servers before integration

### Known MCP Risks (2026)

- **Prompt injection** via compromised MCP servers
- **Tool permission abuse** — combining tools to exfiltrate data
- **Lookalike tools** — silently replacing trusted tools
- 492-1,800+ MCP servers found exposed to internet without hardening

---

## Existing Dashboard MCP Infrastructure

The dashboard already has a production-ready MCP orchestrator:

| File | Purpose |
|------|---------|
| `backend/src/services/mcp-manager.ts` | Connection lifecycle (stdio/SSE/HTTP transports) |
| `backend/src/services/mcp-tool-bridge.ts` | Schema conversion (MCP -> Ollama format), prefixed routing |
| `backend/src/routes/mcp.ts` | Admin REST API for server CRUD (admin role required) |
| `backend/src/sockets/llm-chat.ts` | Two-phase tool calling (native Ollama first, text-based fallback) |
| `backend/src/db/migrations/024_mcp_servers.sql` | MCP server config storage |

New security MCP servers plug in via `POST /api/mcp/servers` with automatic tool discovery.

---

## Sources

### Trivy
- [aquasecurity/trivy-mcp](https://github.com/aquasecurity/trivy-mcp)
- [trivy.dev](https://trivy.dev/)
- [Playbooks MCP listing](https://playbooks.com/mcp/aquasecurity/trivy-mcp)
- [Trivy Air-Gap Documentation](https://trivy.dev/docs/latest/advanced/air-gap/)
- [Aqua Security Trivy Product Page](https://www.aquasec.com/products/trivy/)

### Grype
- [anchore/grype-mcp](https://github.com/anchore/grype-mcp)
- [Montana State University: Grype vs Trivy Research](https://www.montana.edu/cyber/products/Grype_Vs_Trivy_Boles_et_al.pdf)
- [OpsDigest: Trivy vs Grype](https://opsdigest.com/digests/trivy-vs-grype-choosing-the-right-vulnerability-scanner/)
- [Anchore Open Source](https://anchore.com/opensource/)

### Snyk
- [snyk/studio-mcp](https://github.com/snyk/studio-mcp)
- [sammcj/mcp-snyk (community)](https://github.com/sammcj/mcp-snyk)
- [Aikido: Snyk vs Trivy](https://www.aikido.dev/blog/snyk-vs-trivy)

### NVD
- [marcoeg/mcp-nvd](https://github.com/marcoeg/mcp-nvd)
- [NVD API Documentation](https://nvd.nist.gov/developers)
- [GitGuardian: Vulnerability DBs Compared](https://blog.gitguardian.com/open-source-vulnerability-databases-comparison/)
- [gleicon/mcp-osv (OSV alternative)](https://github.com/gleicon/mcp-osv)
- [roadwy/cve-search_mcp (CVE-Search alternative)](https://github.com/roadwy/cve-search_mcp)

### Security Best Practices
- [eSentire: MCP Security Vulnerabilities](https://www.esentire.com/blog/model-context-protocol-security-critical-vulnerabilities-every-ciso-should-address-in-2025)
- [Docker: MCP Security Explained](https://www.docker.com/blog/mcp-security-explained/)
- [Akto: MCP Best Practices 2026](https://www.akto.io/blog/mcp-security-best-practices)
- [Palo Alto: MCP Attack Vectors](https://unit42.paloaltonetworks.com/model-context-protocol-attack-vectors/)
- [FuzzingLabs Security Hub](https://github.com/FuzzingLabs/mcp-security-hub)
- [invariantlabs-ai/mcp-scan](https://github.com/invariantlabs-ai/mcp-scan)
