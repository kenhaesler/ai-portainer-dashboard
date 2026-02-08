"""Snyk MCP Server — Vulnerability scanning (SCA, SAST, IaC, Container)."""

import json
import os
import subprocess

from mcp.server.fastmcp import FastMCP

HOST = os.getenv("MCP_HOST", "0.0.0.0")
PORT = int(os.getenv("MCP_PORT", "8000"))
SCAN_TIMEOUT = 120

mcp = FastMCP(
    "snyk-mcp",
    stateless_http=True,
    json_response=True,
    host=HOST,
    port=PORT,
)


def _run_snyk(args: list[str], timeout: int = SCAN_TIMEOUT) -> str:
    """Execute snyk CLI and return output."""
    cmd = ["snyk"] + args
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
        # Snyk exit codes: 0=no vulns, 1=vulns found, 2=failure, 3=no supported projects
        if proc.returncode in (0, 1):
            return proc.stdout if proc.stdout else json.dumps({"message": "No output", "stderr": proc.stderr[-2000:]})
        return json.dumps({
            "error": f"snyk exited with code {proc.returncode}",
            "stderr": proc.stderr[-2000:],
            "stdout": proc.stdout[-2000:],
        })
    except subprocess.TimeoutExpired:
        return json.dumps({"error": f"Scan timed out after {timeout}s"})
    except FileNotFoundError:
        return json.dumps({"error": "snyk binary not found"})


@mcp.tool()
def snyk_test(path: str, package_manager: str = "") -> str:
    """Run Snyk open-source dependency scan (SCA) on a project.

    Args:
        path: Path to the project directory or manifest file
        package_manager: Optional package manager hint (npm, pip, maven, gradle, etc.)
    """
    args = ["test", path.strip(), "--json"]
    if package_manager.strip():
        args.extend(["--package-manager", package_manager.strip()])
    return _run_snyk(args)


@mcp.tool()
def snyk_code_test(path: str) -> str:
    """Run Snyk Code static analysis (SAST) on source code.

    Args:
        path: Path to the project directory to analyze
    """
    return _run_snyk(["code", "test", path.strip(), "--json"])


@mcp.tool()
def snyk_container_test(image: str) -> str:
    """Scan a container image for known vulnerabilities.

    Args:
        image: Container image reference (e.g. "nginx:latest", "alpine:3.19")
    """
    return _run_snyk(["container", "test", image.strip(), "--json"])


@mcp.tool()
def snyk_iac_test(path: str) -> str:
    """Scan Infrastructure as Code files for security misconfigurations.

    Args:
        path: Path to IaC files (Terraform, CloudFormation, Kubernetes YAML, etc.)
    """
    return _run_snyk(["iac", "test", path.strip(), "--json"])


@mcp.tool()
def snyk_version() -> str:
    """Get the installed Snyk CLI version."""
    return _run_snyk(["version"], timeout=10)


@mcp.tool()
def snyk_auth_status() -> str:
    """Check Snyk authentication status."""
    return _run_snyk(["auth", "--token", os.getenv("SNYK_TOKEN", ""), "--json"], timeout=15)


if __name__ == "__main__":
    mcp.run(transport="streamable-http")
