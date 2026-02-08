"""Tests for the Grype MCP server tools."""

import json
from unittest.mock import patch, MagicMock

import pytest

from server import scan_image, scan_dir, scan_sbom, db_status, db_update


SAMPLE_GRYPE_OUTPUT = json.dumps({
    "matches": [
        {
            "vulnerability": {
                "id": "CVE-2024-1234",
                "severity": "High",
                "description": "Buffer overflow in libfoo",
            },
            "artifact": {
                "name": "libfoo",
                "version": "1.2.3",
            },
        }
    ],
    "source": {"type": "image", "target": {"userInput": "nginx:latest"}},
})


def _mock_run(stdout=SAMPLE_GRYPE_OUTPUT, returncode=0, stderr=""):
    """Create a mock subprocess.run result."""
    result = MagicMock()
    result.stdout = stdout
    result.returncode = returncode
    result.stderr = stderr
    return result


class TestScanImage:
    @patch("server.subprocess.run")
    def test_basic_scan(self, mock_run):
        mock_run.return_value = _mock_run()
        result = scan_image("nginx:latest")
        parsed = json.loads(result)

        assert "matches" in parsed
        mock_run.assert_called_once()
        args = mock_run.call_args[0][0]
        assert args == ["grype", "nginx:latest", "-o", "json"]

    @patch("server.subprocess.run")
    def test_with_severity_filter(self, mock_run):
        mock_run.return_value = _mock_run()
        scan_image("alpine:3.19", severity="high")

        args = mock_run.call_args[0][0]
        assert "--fail-on" in args
        assert "high" in args

    def test_invalid_severity(self):
        result = json.loads(scan_image("nginx:latest", severity="extreme"))
        assert "error" in result
        assert "Invalid severity" in result["error"]

    @patch("server.subprocess.run")
    def test_strips_whitespace(self, mock_run):
        mock_run.return_value = _mock_run()
        scan_image("  nginx:latest  ")

        args = mock_run.call_args[0][0]
        assert args[1] == "nginx:latest"

    @patch("server.subprocess.run")
    def test_timeout(self, mock_run):
        from subprocess import TimeoutExpired

        mock_run.side_effect = TimeoutExpired(cmd="grype", timeout=120)
        result = json.loads(scan_image("huge-image:latest"))
        assert "timed out" in result["error"]

    @patch("server.subprocess.run")
    def test_grype_not_found(self, mock_run):
        mock_run.side_effect = FileNotFoundError()
        result = json.loads(scan_image("nginx:latest"))
        assert "not found" in result["error"]

    @patch("server.subprocess.run")
    def test_grype_error_exit(self, mock_run):
        mock_run.return_value = _mock_run(returncode=2, stderr="fatal error", stdout="")
        result = json.loads(scan_image("nginx:latest"))
        assert "error" in result
        assert "exited with code 2" in result["error"]


class TestScanDir:
    @patch("server.subprocess.run")
    def test_basic_scan(self, mock_run):
        mock_run.return_value = _mock_run()
        scan_dir("/app")

        args = mock_run.call_args[0][0]
        assert args == ["grype", "dir:/app", "-o", "json"]


class TestScanSbom:
    @patch("server.subprocess.run")
    def test_basic_scan(self, mock_run):
        mock_run.return_value = _mock_run()
        scan_sbom("/data/sbom.json")

        args = mock_run.call_args[0][0]
        assert args == ["grype", "sbom:/data/sbom.json", "-o", "json"]


class TestDbStatus:
    @patch("server.subprocess.run")
    def test_status(self, mock_run):
        mock_run.return_value = _mock_run(stdout='{"built":"2024-01-01"}')
        result = json.loads(db_status())
        assert "built" in result


class TestDbUpdate:
    @patch("server.subprocess.run")
    def test_update(self, mock_run):
        mock_run.return_value = _mock_run(stdout='{"updated":true}')
        result = json.loads(db_update())
        assert result["updated"] is True
