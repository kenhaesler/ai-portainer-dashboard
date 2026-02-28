"""Tests for the NVD MCP server tools."""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from server import (
    MAX_CVE_ID_LENGTH,
    HOST,
    BearerTokenMiddleware,
    _format_cve,
    _sanitize_keyword,
    get_cve,
    search_cves,
)


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


# --- Default host binding tests ---


class TestDefaultConfig:
    def test_default_host_is_localhost(self):
        """Default host must be 127.0.0.1 (not 0.0.0.0) to avoid exposing on all interfaces."""
        assert HOST == "127.0.0.1"


# --- _sanitize_keyword tests ---


class TestSanitizeKeyword:
    def test_strips_whitespace(self):
        assert _sanitize_keyword("  log4j  ") == "log4j"

    def test_removes_control_characters(self):
        assert _sanitize_keyword("log4j\x00\x01\x1f") == "log4j"

    def test_removes_high_control_characters(self):
        assert _sanitize_keyword("test\x7f\x80\x9f") == "test"

    def test_truncates_long_keywords(self):
        long_keyword = "a" * 500
        result = _sanitize_keyword(long_keyword)
        assert len(result) == 256

    def test_preserves_valid_keyword(self):
        assert _sanitize_keyword("apache log4j") == "apache log4j"

    def test_empty_after_sanitization(self):
        assert _sanitize_keyword("\x00\x01\x02") == ""


# --- BearerTokenMiddleware tests ---


class TestBearerTokenMiddleware:
    @pytest.mark.asyncio
    async def test_no_token_configured_passes_through(self):
        """When MCP_AUTH_TOKEN is empty, all requests pass through."""
        middleware = BearerTokenMiddleware(app=None)
        request = MagicMock()
        call_next = AsyncMock(return_value=MagicMock(status_code=200))

        with patch("server.MCP_AUTH_TOKEN", ""):
            result = await middleware.dispatch(request, call_next)

        call_next.assert_awaited_once_with(request)
        assert result.status_code == 200

    @pytest.mark.asyncio
    async def test_missing_auth_header_returns_401(self):
        """Missing Authorization header should return 401."""
        middleware = BearerTokenMiddleware(app=None)
        request = MagicMock()
        request.headers = {}
        call_next = AsyncMock()

        with patch("server.MCP_AUTH_TOKEN", "secret-token"):
            result = await middleware.dispatch(request, call_next)

        assert result.status_code == 401
        call_next.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_wrong_auth_scheme_returns_401(self):
        """Non-Bearer auth scheme should return 401."""
        middleware = BearerTokenMiddleware(app=None)
        request = MagicMock()
        request.headers = {"Authorization": "Token not-a-bearer-scheme"}
        call_next = AsyncMock()

        with patch("server.MCP_AUTH_TOKEN", "secret-token"):
            result = await middleware.dispatch(request, call_next)

        assert result.status_code == 401
        call_next.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_invalid_token_returns_403(self):
        """Wrong bearer token should return 403."""
        middleware = BearerTokenMiddleware(app=None)
        request = MagicMock()
        request.headers = {"Authorization": "Bearer wrong-token"}
        call_next = AsyncMock()

        with patch("server.MCP_AUTH_TOKEN", "secret-token"):
            result = await middleware.dispatch(request, call_next)

        assert result.status_code == 403
        call_next.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_valid_token_passes_through(self):
        """Correct bearer token should pass request through."""
        middleware = BearerTokenMiddleware(app=None)
        request = MagicMock()
        request.headers = {"Authorization": "Bearer correct-token"}
        call_next = AsyncMock(return_value=MagicMock(status_code=200))

        with patch("server.MCP_AUTH_TOKEN", "correct-token"):
            result = await middleware.dispatch(request, call_next)

        call_next.assert_awaited_once_with(request)
        assert result.status_code == 200


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

        with patch("server._nvd_query", new_callable=AsyncMock, return_value=resp):
            result = json.loads(await get_cve("CVE-2024-1234"))

        assert result["id"] == "CVE-2024-1234"
        assert result["cvss"]["baseScore"] == 9.8

    @pytest.mark.asyncio
    async def test_cve_not_found(self):
        resp = _mock_response(200, {"vulnerabilities": []})

        with patch("server._nvd_query", new_callable=AsyncMock, return_value=resp):
            result = json.loads(await get_cve("CVE-2099-0001"))

        assert "error" in result
        assert "not found" in result["error"]

    @pytest.mark.asyncio
    async def test_rate_limited(self):
        resp = _mock_response(403)

        with patch("server._nvd_query", new_callable=AsyncMock, return_value=resp):
            result = json.loads(await get_cve("CVE-2024-1234"))

        assert "Rate limited" in result["error"]

    @pytest.mark.asyncio
    async def test_normalizes_cve_id(self):
        """Lowercase/whitespace input should be normalized."""
        resp = _mock_response(200, {"vulnerabilities": [_make_vuln(cve_id="CVE-2024-1234")]})

        with patch("server._nvd_query", new_callable=AsyncMock, return_value=resp) as mock_query:
            result = json.loads(await get_cve("  cve-2024-1234  "))

        assert result["id"] == "CVE-2024-1234"
        mock_query.assert_awaited_once_with({"cveId": "CVE-2024-1234"})

    @pytest.mark.asyncio
    async def test_cve_id_control_chars_stripped(self):
        """Control characters in CVE ID should be stripped before querying."""
        resp = _mock_response(200, {"vulnerabilities": [_make_vuln(cve_id="CVE-2024-1234")]})

        with patch("server._nvd_query", new_callable=AsyncMock, return_value=resp) as mock_query:
            result = json.loads(await get_cve("CVE-2024-\x001234"))

        assert result["id"] == "CVE-2024-1234"
        mock_query.assert_awaited_once_with({"cveId": "CVE-2024-1234"})

    @pytest.mark.asyncio
    async def test_cve_id_too_long_rejected(self):
        """CVE ID exceeding MAX_CVE_ID_LENGTH should be rejected."""
        long_id = "CVE-" + "1" * (MAX_CVE_ID_LENGTH + 1)
        result = json.loads(await get_cve(long_id))
        assert "error" in result
        assert "too long" in result["error"].lower()


# --- search_cves tool tests ---


class TestSearchCves:
    @pytest.mark.asyncio
    async def test_successful_search(self):
        resp = _mock_response(200, {"totalResults": 1, "vulnerabilities": [_make_vuln()]})

        with patch("server._nvd_query", new_callable=AsyncMock, return_value=resp):
            result = json.loads(await search_cves("log4j"))

        assert result["totalResults"] == 1
        assert len(result["vulnerabilities"]) == 1

    @pytest.mark.asyncio
    async def test_clamps_results(self):
        resp = _mock_response(200, {"totalResults": 0, "vulnerabilities": []})

        with patch("server._nvd_query", new_callable=AsyncMock, return_value=resp) as mock_query:
            await search_cves("test", results=100)

        # Should clamp to 50
        call_args = mock_query.call_args
        assert call_args[0][0]["resultsPerPage"] == 50

    @pytest.mark.asyncio
    async def test_rate_limited(self):
        resp = _mock_response(403)

        with patch("server._nvd_query", new_callable=AsyncMock, return_value=resp):
            result = json.loads(await search_cves("nginx"))

        assert "Rate limited" in result["error"]

    @pytest.mark.asyncio
    async def test_empty_keyword_rejected(self):
        """Keyword that is empty after sanitization should return error."""
        result = json.loads(await search_cves("\x00\x01\x02"))
        assert "error" in result
        assert "empty" in result["error"].lower()

    @pytest.mark.asyncio
    async def test_keyword_sanitization_applied(self):
        """Control characters should be stripped from keyword before querying."""
        resp = _mock_response(200, {"totalResults": 0, "vulnerabilities": []})

        with patch("server._nvd_query", new_callable=AsyncMock, return_value=resp) as mock_query:
            await search_cves("log4j\x00\x01injection")

        call_args = mock_query.call_args
        assert call_args[0][0]["keywordSearch"] == "log4jinjection"
