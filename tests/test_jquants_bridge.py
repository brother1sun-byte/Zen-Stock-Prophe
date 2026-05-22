import os
import unittest
from unittest.mock import patch

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

import jquants_bridge  # noqa: E402


class _Response:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code

    def raise_for_status(self):
        if self.status_code >= 400:
            raise jquants_bridge.requests.HTTPError(response=self)

    def json(self):
        return self._payload


class _Session:
    def __init__(self):
        self.posts = []
        self.gets = []

    def post(self, url, params=None, timeout=None):
        self.posts.append((url, params, timeout))
        return _Response({"idToken": "id-token"})

    def get(self, url, params=None, headers=None, timeout=None):
        self.gets.append((url, params, headers, timeout))
        if url.endswith("/v2/equities/bars/daily"):
            return _Response({"daily_quotes": [{"Date": params["date"], "Code": "49800", "Close": 2400.0, "Volume": 900}]})
        if url.endswith("/listed/info"):
            return _Response({"info": [{"Date": "2026-05-08", "CompanyName": "Dexerials", "MarketCodeName": "Prime"}]})
        if url.endswith("/prices/daily_quotes"):
            return _Response({"daily_quotes": [{"Date": "2026-05-08", "Code": "49800", "Close": 2481.0, "Volume": 1000}]})
        if url.endswith("/fins/statements"):
            return _Response({"statements": [{"DisclosedDate": "2026-05-08", "NetSales": 100, "EarningsPerShare": 12.3}]})
        return _Response({})


class JQuantsBridgeTests(unittest.TestCase):
    def test_normalize_jpx_code_accepts_dot_t_suffix(self):
        self.assertEqual(jquants_bridge.normalize_jpx_code("4980.T"), "4980")
        self.assertEqual(jquants_bridge.normalize_jpx_code("72030"), "7203")

    def test_research_packet_is_safe_when_token_missing(self):
        with patch.dict(os.environ, {}, clear=True):
            packet = jquants_bridge.research_packet("4980.T")

        self.assertFalse(packet["configured"])
        self.assertFalse(packet["available"])
        self.assertEqual(packet["executionImpact"], "research_only")

    def test_research_packet_fetches_read_only_sources_with_refresh_token(self):
        session = _Session()
        with patch.dict(os.environ, {"JQUANTS_REFRESH_TOKEN": "refresh-token"}, clear=True):
            packet = jquants_bridge.research_packet("4980.T", session=session)

        self.assertTrue(packet["available"])
        self.assertEqual(packet["issue"]["name"], "Dexerials")
        self.assertEqual(packet["latestQuote"]["close"], 2481.0)
        self.assertEqual(packet["latestStatement"]["earningsPerShare"], 12.3)
        self.assertEqual(len(session.posts), 3)
        self.assertEqual(len(session.gets), 3)
        self.assertTrue(all(call[2]["Authorization"] == "Bearer id-token" for call in session.gets))

    def test_api_key_mode_uses_delayed_jquants_and_recent_fallback(self):
        session = _Session()

        def recent_provider(code):
            return {
                "source": "test-recent",
                "delayed": False,
                "date": "2026-05-08",
                "close": 2481.0,
            }

        with patch.dict(os.environ, {"JQUANTS_API_KEY": "api-key"}, clear=True):
            packet = jquants_bridge.research_packet("4980.T", session=session, recent_provider=recent_provider)

        self.assertTrue(packet["available"])
        self.assertEqual(packet["mode"], "API_KEY")
        self.assertEqual(packet["latestQuote"]["source"], "test-recent")
        self.assertEqual(packet["latestQuote"]["close"], 2481.0)
        self.assertEqual(packet["delayedQuote"]["source"], "J-Quants V2 delayed official")
        self.assertEqual(packet["delayedQuote"]["close"], 2400.0)
        self.assertEqual(packet["dataPolicy"]["recentWindowDays"], 84)
        self.assertEqual(session.gets[0][2]["x-api-key"], "api-key")


if __name__ == "__main__":
    unittest.main()
