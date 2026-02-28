"""NVD MCP Server — National Vulnerability Database CVE lookups."""

import asyncio
import json
import os
import re
import secrets
import sys

import httpx
import uvicorn
from mcp.server.fastmcp import FastMCP
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

# --- Configuration ---

MCP_AUTH_TOKEN = os.getenv("MCP_AUTH_TOKEN", "")
HOST = os.getenv("MCP_HOST", "127.0.0.1")
PORT = int(os.getenv("MCP_PORT", "8000"))
NVD_API_KEY = os.getenv("NVD_API_KEY", "")
NVD_BASE_URL = "https://services.nvd.nist.gov/rest/json/cves/2.0"
REQUEST_TIMEOUT = 30

# Input validation limits
MAX_KEYWORD_LENGTH = 256
MAX_CVE_ID_LENGTH = 30
CONTROL_CHAR_RE = re.compile(r"[\x00-\x1f\x7f-\x9f]")

mcp = FastMCP(
    "nvd-mcp",
    stateless_http=True,
    json_response=True,
)


# --- Auth middleware ---


class BearerTokenMiddleware(BaseHTTPMiddleware):
    """Validate Authorization: Bearer <token> on every request when MCP_AUTH_TOKEN is set."""

    async def dispatch(self, request: Request, call_next):
        if not MCP_AUTH_TOKEN:
            return await call_next(request)

        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return JSONResponse(
                {"error": "Missing or malformed Authorization header"},
                status_code=401,
            )

        provided_token = auth_header[len("Bearer "):]
        if not secrets.compare_digest(provided_token, MCP_AUTH_TOKEN):
            return JSONResponse(
                {"error": "Invalid bearer token"},
                status_code=403,
            )

        return await call_next(request)


# --- Input validation helpers ---


def _sanitize_keyword(keyword: str) -> str:
    """Sanitize keyword input: strip whitespace, remove control characters, enforce length."""
    keyword = keyword.strip()
    keyword = CONTROL_CHAR_RE.sub("", keyword)
    keyword = keyword[:MAX_KEYWORD_LENGTH]
    return keyword


# --- NVD API client (hardcoded destination — credentials never sent to user-controlled URLs) ---


async def _nvd_query(params: dict[str, object]) -> httpx.Response:
    """Send an authenticated GET request to the NVD API.

    The destination URL is hardcoded to NVD_BASE_URL so that the NVD_API_KEY
    credential is never sent to a user-controlled endpoint.
    Callers pass only query-string *params*; the URL and headers are internal.

    nosemgrep: python.mcp.mcp-auth-passthrough-taint.mcp-auth-passthrough-taint
    """
    headers: dict[str, str] = {"Accept": "application/json"}
    if NVD_API_KEY:
        headers["apiKey"] = NVD_API_KEY

    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
        return await client.get(  # nosemgrep: python.mcp.mcp-auth-passthrough-taint.mcp-auth-passthrough-taint
            NVD_BASE_URL,
            params=params,
            headers=headers,
        )


def _format_cve(vuln: dict) -> dict:
    """Extract the most useful fields from a raw NVD vulnerability object."""
    cve = vuln.get("cve", {})
    cve_id = cve.get("id", "unknown")

    # Description (prefer English)
    descriptions = cve.get("descriptions", [])
    description = next(
        (d["value"] for d in descriptions if d.get("lang") == "en"),
        descriptions[0]["value"] if descriptions else "No description",
    )

    # CVSS scores — try v3.1 first, then v3.0, then v2.0
    metrics = cve.get("metrics", {})
    cvss: dict = {}
    for version_key in ("cvssMetricV31", "cvssMetricV30", "cvssMetricV2"):
        metric_list = metrics.get(version_key, [])
        if metric_list:
            cvss_data = metric_list[0].get("cvssData", {})
            cvss = {
                "version": cvss_data.get("version", ""),
                "baseScore": cvss_data.get("baseScore"),
                "baseSeverity": cvss_data.get("baseSeverity", metric_list[0].get("baseSeverity", "")),
                "vectorString": cvss_data.get("vectorString", ""),
            }
            break

    # CWE weaknesses
    weaknesses = cve.get("weaknesses", [])
    cwes: list[str] = []
    for w in weaknesses:
        for desc in w.get("description", []):
            if desc.get("value", "").startswith("CWE-"):
                cwes.append(desc["value"])

    # References
    references = [
        {"url": ref.get("url", ""), "source": ref.get("source", "")}
        for ref in cve.get("references", [])[:10]
    ]

    return {
        "id": cve_id,
        "description": description,
        "published": cve.get("published", ""),
        "lastModified": cve.get("lastModified", ""),
        "cvss": cvss,
        "cwes": cwes,
        "references": references,
    }


@mcp.tool()
async def get_cve(cve_id: str) -> str:
    """Fetch details for a specific CVE from the National Vulnerability Database.

    Args:
        cve_id: The CVE identifier, e.g. "CVE-2024-1234"
    """
    cve_id = CONTROL_CHAR_RE.sub("", cve_id.strip()).upper()
    if len(cve_id) > MAX_CVE_ID_LENGTH:
        return json.dumps({"error": "CVE ID too long"})
    if not cve_id.startswith("CVE-"):
        return json.dumps({"error": "Invalid CVE ID format. Expected CVE-YYYY-NNNNN"})

    resp = await _nvd_query({"cveId": cve_id})

    if resp.status_code == 403:
        return json.dumps({"error": "Rate limited by NVD API. Set NVD_API_KEY for higher limits (50 req/30s)."})
    if resp.status_code != 200:
        return json.dumps({"error": f"NVD API returned HTTP {resp.status_code}", "body": resp.text[:500]})

    data = resp.json()
    vulns = data.get("vulnerabilities", [])
    if not vulns:
        return json.dumps({"error": f"CVE {cve_id} not found"})

    return json.dumps(_format_cve(vulns[0]), indent=2)


@mcp.tool()
async def search_cves(keyword: str, results: int = 10) -> str:
    """Search the National Vulnerability Database by keyword.

    Args:
        keyword: Search term (e.g. "apache log4j", "nginx buffer overflow")
        results: Maximum number of results to return (1-50, default 10)
    """
    keyword = _sanitize_keyword(keyword)
    if not keyword:
        return json.dumps({"error": "Keyword must not be empty after sanitization"})

    results = max(1, min(results, 50))

    resp = await _nvd_query({"keywordSearch": keyword, "resultsPerPage": results})

    if resp.status_code == 403:
        return json.dumps({"error": "Rate limited by NVD API. Set NVD_API_KEY for higher limits (50 req/30s)."})
    if resp.status_code != 200:
        return json.dumps({"error": f"NVD API returned HTTP {resp.status_code}", "body": resp.text[:500]})

    data = resp.json()
    total = data.get("totalResults", 0)
    vulns = data.get("vulnerabilities", [])

    return json.dumps(
        {
            "totalResults": total,
            "returned": len(vulns),
            "vulnerabilities": [_format_cve(v) for v in vulns],
        },
        indent=2,
    )


if __name__ == "__main__":
    if not MCP_AUTH_TOKEN:
        print(
            "WARNING: MCP_AUTH_TOKEN not set. Server is running without authentication.",
            file=sys.stderr,
        )

    # Build the Starlette app from FastMCP, then wrap with auth middleware
    app = mcp.streamable_http_app()
    app.add_middleware(BearerTokenMiddleware)

    config = uvicorn.Config(app, host=HOST, port=PORT)
    server = uvicorn.Server(config)
    asyncio.run(server.serve())
