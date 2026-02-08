"""Tests for the Snyk MCP server tools."""

import json
from unittest.mock import patch, MagicMock

import pytest

from server import (
    snyk_test,
    snyk_code_test,
    snyk_container_test,
    snyk_iac_test,
    snyk_version,
    snyk_auth_status,
)


SAMPLE_SNYK_OUTPUT = json.dumps({
    "ok": False,
    "vulnerabilities": [
        {
            "id": "SNYK-JS-LODASH-1234",
            "title": "Prototype Pollution",
            "severity": "high",
            "packageName": "lodash",
            "version": "4.17.20",
        }
    ],
    "dependencyCount": 42,
})


def _mock_run(stdout=SAMPLE_SNYK_OUTPUT, returncode=0, stderr=""):
    """Create a mock subprocess.run result."""
    result = MagicMock()
    result.stdout = stdout
    result.returncode = returncode
    result.stderr = stderr
    return result


class TestSnykTest:
    @patch("server.subprocess.run")
    def test_basic_scan(self, mock_run):
        mock_run.return_value = _mock_run()
        result = snyk_test("/app")
        parsed = json.loads(result)

        assert "vulnerabilities" in parsed
        args = mock_run.call_args[0][0]
        assert args == ["snyk", "test", "/app", "--json"]

    @patch("server.subprocess.run")
    def test_with_package_manager(self, mock_run):
        mock_run.return_value = _mock_run()
        snyk_test("/app", package_manager="npm")

        args = mock_run.call_args[0][0]
        assert "--package-manager" in args
        assert "npm" in args

    @patch("server.subprocess.run")
    def test_vulns_found_exit_1(self, mock_run):
        """Snyk returns exit code 1 when vulns found — should still return output."""
        mock_run.return_value = _mock_run(returncode=1)
        result = snyk_test("/app")
        parsed = json.loads(result)
        assert "vulnerabilities" in parsed

    @patch("server.subprocess.run")
    def test_failure_exit_2(self, mock_run):
        mock_run.return_value = _mock_run(returncode=2, stderr="authentication required")
        result = json.loads(snyk_test("/app"))
        assert "error" in result
        assert "exited with code 2" in result["error"]

    @patch("server.subprocess.run")
    def test_timeout(self, mock_run):
        from subprocess import TimeoutExpired

        mock_run.side_effect = TimeoutExpired(cmd="snyk", timeout=120)
        result = json.loads(snyk_test("/app"))
        assert "timed out" in result["error"]

    @patch("server.subprocess.run")
    def test_snyk_not_found(self, mock_run):
        mock_run.side_effect = FileNotFoundError()
        result = json.loads(snyk_test("/app"))
        assert "not found" in result["error"]

    @patch("server.subprocess.run")
    def test_strips_whitespace(self, mock_run):
        mock_run.return_value = _mock_run()
        snyk_test("  /app  ")
        args = mock_run.call_args[0][0]
        assert args[2] == "/app"


class TestSnykCodeTest:
    @patch("server.subprocess.run")
    def test_basic_scan(self, mock_run):
        mock_run.return_value = _mock_run()
        snyk_code_test("/project")

        args = mock_run.call_args[0][0]
        assert args == ["snyk", "code", "test", "/project", "--json"]


class TestSnykContainerTest:
    @patch("server.subprocess.run")
    def test_basic_scan(self, mock_run):
        mock_run.return_value = _mock_run()
        snyk_container_test("nginx:latest")

        args = mock_run.call_args[0][0]
        assert args == ["snyk", "container", "test", "nginx:latest", "--json"]


class TestSnykIacTest:
    @patch("server.subprocess.run")
    def test_basic_scan(self, mock_run):
        mock_run.return_value = _mock_run()
        snyk_iac_test("/infra/main.tf")

        args = mock_run.call_args[0][0]
        assert args == ["snyk", "iac", "test", "/infra/main.tf", "--json"]


class TestSnykVersion:
    @patch("server.subprocess.run")
    def test_version(self, mock_run):
        mock_run.return_value = _mock_run(stdout="1.1234.0")
        result = snyk_version()
        assert "1.1234.0" in result


class TestSnykAuthStatus:
    @patch("server.subprocess.run")
    def test_auth_check(self, mock_run):
        mock_run.return_value = _mock_run(stdout='{"authenticated":true}')
        result = json.loads(snyk_auth_status())
        assert result["authenticated"] is True
