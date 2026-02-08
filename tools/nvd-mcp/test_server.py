"""Tests for the NVD MCP server tools."""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from server import _format_cve, get_cve, search_cves


# --- _format_cve unit tests ---


def _make_vuln(cve_id="CVE-2024-1234", description="Test vuln", base_score=9.8, severity="CRITICAL"):
    """Build a minimal NVD vulnerability object for testing."""
    return {
        "cve": {
            "id": cve_id,
            "descriptions": [{"lang": "en", "value": description}],
            "published": "2024-01-15T00:00:00.000",
            "lastModified": "2024-01-20T00:00:00.000",
            "metrics": {
                "cvssMetricV31": [
                    {
                        "cvssData": {
                            "version": "3.1",
                            "baseScore": base_score,
                            "baseSeverity": severity,
                            "vectorString": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
                        }
                    }
                ]
            },
            "weaknesses": [
                {"description": [{"lang": "en", "value": "CWE-79"}]},
            ],
            "references": [
                {"url": "https://example.com/advisory", "source": "vendor"},
            ],
        }
    }


def _mock_response(status_code=200, json_data=None):
    """Create a mock httpx response with sync json() method."""
    resp = MagicMock()
    resp.status_code = status_code
    resp.json.return_value = json_data or {}
    resp.text = json.dumps(json_data) if json_data else ""
    return resp


class TestFormatCve:
    def test_extracts_id(self):
        result = _format_cve(_make_vuln(cve_id="CVE-2024-9999"))
        assert result["id"] == "CVE-2024-9999"

    def test_extracts_description(self):
        result = _format_cve(_make_vuln(description="Remote code execution"))
        assert result["description"] == "Remote code execution"

    def test_extracts_cvss(self):
        result = _format_cve(_make_vuln(base_score=7.5, severity="HIGH"))
        assert result["cvss"]["baseScore"] == 7.5
        assert result["cvss"]["baseSeverity"] == "HIGH"
        assert result["cvss"]["version"] == "3.1"

    def test_extracts_cwes(self):
        result = _format_cve(_make_vuln())
        assert "CWE-79" in result["cwes"]

    def test_extracts_references(self):
        result = _format_cve(_make_vuln())
        assert len(result["references"]) == 1
        assert result["references"][0]["url"] == "https://example.com/advisory"

    def test_handles_empty_cve(self):
        result = _format_cve({"cve": {}})
        assert result["id"] == "unknown"
        assert result["cvss"] == {}
        assert result["cwes"] == []

    def test_prefers_english_description(self):
        vuln = _make_vuln()
        vuln["cve"]["descriptions"] = [
            {"lang": "es", "value": "Vulnerabilidad"},
            {"lang": "en", "value": "Vulnerability"},
        ]
        result = _format_cve(vuln)
        assert result["description"] == "Vulnerability"


# --- get_cve tool tests ---


class TestGetCve:
    @pytest.mark.asyncio
    async def test_invalid_cve_format(self):
        result = json.loads(await get_cve("not-a-cve"))
        assert "error" in result
        assert "Invalid CVE ID" in result["error"]

    @pytest.mark.asyncio
    async def test_successful_lookup(self):
        resp = _mock_response(200, {"vulnerabilities": [_make_vuln(cve_id="CVE-2024-1234")]})

        mock_client_instance = AsyncMock()
        mock_client_instance.get.return_value = resp

        with patch("server.httpx.AsyncClient") as mock_cls:
            mock_cls.return_value.__aenter__.return_value = mock_client_instance
            mock_cls.return_value.__aexit__.return_value = False

            result = json.loads(await get_cve("CVE-2024-1234"))

        assert result["id"] == "CVE-2024-1234"
        assert result["cvss"]["baseScore"] == 9.8

    @pytest.mark.asyncio
    async def test_cve_not_found(self):
        resp = _mock_response(200, {"vulnerabilities": []})

        mock_client_instance = AsyncMock()
        mock_client_instance.get.return_value = resp

        with patch("server.httpx.AsyncClient") as mock_cls:
            mock_cls.return_value.__aenter__.return_value = mock_client_instance
            mock_cls.return_value.__aexit__.return_value = False

            result = json.loads(await get_cve("CVE-2099-0001"))

        assert "error" in result
        assert "not found" in result["error"]

    @pytest.mark.asyncio
    async def test_rate_limited(self):
        resp = _mock_response(403)

        mock_client_instance = AsyncMock()
        mock_client_instance.get.return_value = resp

        with patch("server.httpx.AsyncClient") as mock_cls:
            mock_cls.return_value.__aenter__.return_value = mock_client_instance
            mock_cls.return_value.__aexit__.return_value = False

            result = json.loads(await get_cve("CVE-2024-1234"))

        assert "Rate limited" in result["error"]

    @pytest.mark.asyncio
    async def test_normalizes_cve_id(self):
        """Lowercase/whitespace input should be normalized."""
        resp = _mock_response(200, {"vulnerabilities": [_make_vuln(cve_id="CVE-2024-1234")]})

        mock_client_instance = AsyncMock()
        mock_client_instance.get.return_value = resp

        with patch("server.httpx.AsyncClient") as mock_cls:
            mock_cls.return_value.__aenter__.return_value = mock_client_instance
            mock_cls.return_value.__aexit__.return_value = False

            result = json.loads(await get_cve("  cve-2024-1234  "))

        assert result["id"] == "CVE-2024-1234"


# --- search_cves tool tests ---


class TestSearchCves:
    @pytest.mark.asyncio
    async def test_successful_search(self):
        resp = _mock_response(200, {"totalResults": 1, "vulnerabilities": [_make_vuln()]})

        mock_client_instance = AsyncMock()
        mock_client_instance.get.return_value = resp

        with patch("server.httpx.AsyncClient") as mock_cls:
            mock_cls.return_value.__aenter__.return_value = mock_client_instance
            mock_cls.return_value.__aexit__.return_value = False

            result = json.loads(await search_cves("log4j"))

        assert result["totalResults"] == 1
        assert len(result["vulnerabilities"]) == 1

    @pytest.mark.asyncio
    async def test_clamps_results(self):
        resp = _mock_response(200, {"totalResults": 0, "vulnerabilities": []})

        mock_client_instance = AsyncMock()
        mock_client_instance.get.return_value = resp

        with patch("server.httpx.AsyncClient") as mock_cls:
            mock_cls.return_value.__aenter__.return_value = mock_client_instance
            mock_cls.return_value.__aexit__.return_value = False

            await search_cves("test", results=100)

        # Should clamp to 50
        call_kwargs = mock_client_instance.get.call_args
        assert call_kwargs[1]["params"]["resultsPerPage"] == 50

    @pytest.mark.asyncio
    async def test_rate_limited(self):
        resp = _mock_response(403)

        mock_client_instance = AsyncMock()
        mock_client_instance.get.return_value = resp

        with patch("server.httpx.AsyncClient") as mock_cls:
            mock_cls.return_value.__aenter__.return_value = mock_client_instance
            mock_cls.return_value.__aexit__.return_value = False

            result = json.loads(await search_cves("nginx"))

        assert "Rate limited" in result["error"]
