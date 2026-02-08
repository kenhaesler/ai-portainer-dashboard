"""Grype MCP Server — Container image and filesystem vulnerability scanning."""

import json
import os
import subprocess

from mcp.server.fastmcp import FastMCP

HOST = os.getenv("MCP_HOST", "0.0.0.0")
PORT = int(os.getenv("MCP_PORT", "8000"))
SCAN_TIMEOUT = 120

mcp = FastMCP(
    "grype-mcp",
    stateless_http=True,
    json_response=True,
    host=HOST,
    port=PORT,
)


def _run_grype(args: list[str], timeout: int = SCAN_TIMEOUT) -> str:
    """Execute grype CLI and return output."""
    cmd = ["grype"] + args
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
        # Grype returns exit code 1 when vulnerabilities found with --fail-on
        if proc.returncode not in (0, 1):
            return json.dumps({
                "error": f"grype exited with code {proc.returncode}",
                "stderr": proc.stderr[-2000:],
            })
        return proc.stdout if proc.stdout else json.dumps({"message": "No output", "stderr": proc.stderr[-2000:]})
    except subprocess.TimeoutExpired:
        return json.dumps({"error": f"Scan timed out after {timeout}s"})
    except FileNotFoundError:
        return json.dumps({"error": "grype binary not found"})


@mcp.tool()
def scan_image(image: str, severity: str = "") -> str:
    """Scan a container image for vulnerabilities.

    Args:
        image: Container image reference (e.g. "nginx:latest", "alpine:3.19")
        severity: Minimum severity filter — negligible, low, medium, high, critical (optional)
    """
    args = [image.strip(), "-o", "json"]
    if severity.strip():
        sev = severity.strip().lower()
        valid = ("negligible", "low", "medium", "high", "critical")
        if sev not in valid:
            return json.dumps({"error": f"Invalid severity. Must be one of: {', '.join(valid)}"})
        args.extend(["--fail-on", sev])
    return _run_grype(args)


@mcp.tool()
def scan_dir(path: str) -> str:
    """Scan a local directory for vulnerabilities in its dependencies.

    Args:
        path: Directory path to scan (e.g. "/app", "/project")
    """
    return _run_grype([f"dir:{path.strip()}", "-o", "json"])


@mcp.tool()
def scan_sbom(path: str) -> str:
    """Scan an SBOM file for known vulnerabilities.

    Args:
        path: Path to SBOM file (CycloneDX or SPDX format)
    """
    return _run_grype([f"sbom:{path.strip()}", "-o", "json"])


@mcp.tool()
def db_status() -> str:
    """Check the status of the local Grype vulnerability database."""
    return _run_grype(["db", "status", "-o", "json"], timeout=30)


@mcp.tool()
def db_update() -> str:
    """Update the local Grype vulnerability database to the latest version."""
    return _run_grype(["db", "update", "-o", "json"], timeout=60)


if __name__ == "__main__":
    mcp.run(transport="streamable-http")
