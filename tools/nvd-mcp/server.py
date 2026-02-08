"""NVD MCP Server — National Vulnerability Database CVE lookups."""

import json
import os

import httpx
from mcp.server.fastmcp import FastMCP

HOST = os.getenv("MCP_HOST", "0.0.0.0")
PORT = int(os.getenv("MCP_PORT", "8000"))
NVD_API_KEY = os.getenv("NVD_API_KEY", "")
NVD_BASE_URL = "https://services.nvd.nist.gov/rest/json/cves/2.0"
REQUEST_TIMEOUT = 30

mcp = FastMCP(
    "nvd-mcp",
    stateless_http=True,
    json_response=True,
    host=HOST,
    port=PORT,
)


def _headers() -> dict[str, str]:
    """Build request headers, including API key if available."""
    headers: dict[str, str] = {"Accept": "application/json"}
    if NVD_API_KEY:
        headers["apiKey"] = NVD_API_KEY
    return headers


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
    cve_id = cve_id.strip().upper()
    if not cve_id.startswith("CVE-"):
        return json.dumps({"error": "Invalid CVE ID format. Expected CVE-YYYY-NNNNN"})

    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
        resp = await client.get(
            NVD_BASE_URL,
            params={"cveId": cve_id},
            headers=_headers(),
        )

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
    results = max(1, min(results, 50))

    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
        resp = await client.get(
            NVD_BASE_URL,
            params={
                "keywordSearch": keyword.strip(),
                "resultsPerPage": results,
            },
            headers=_headers(),
        )

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
    mcp.run(transport="streamable-http")
