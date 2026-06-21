import sys
import unittest
from pathlib import Path

import pandas as pd
from fastapi import HTTPException


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from analysis_api_service import build_advanced_analysis_response, build_preopen_analysis_response  # noqa: E402
from daytrade_context_service import (  # noqa: E402
    build_daytrade_event_context,
    build_daytrade_quote_context,
    parse_event_timestamp,
)
from market_data_api import build_market_search_response, build_market_universe_response  # noqa: E402
from material_event_service import (  # noqa: E402
    external_research_links,
    material_events_for_ticker,
    material_item,
    summarize_material_items,
)
from market_ranking_api import build_market_rankings_response  # noqa: E402
from price_history_service import fetch_price_history  # noqa: E402


def _identity(items, *_args, **_kwargs):
    return items


class BackendApiModuleTests(unittest.TestCase):
    def _price_frame(self, close=100):
        return pd.DataFrame(
            {
                "Open": [close - 1],
                "High": [close + 1],
                "Low": [close - 2],
                "Close": [close],
                "Volume": [1000],
            }
        )

    def test_price_history_prefers_yfinance_and_sets_source_flags(self):
        calls = []

        payload = fetch_price_history(
            ticker="4980.T",
            period="6mo",
            interval="1d",
            yfinance_history=lambda ticker, period, interval: calls.append("yfinance") or self._price_frame(101),
            yahoo_chart_history=lambda ticker: calls.append("yahoo") or self._price_frame(102),
            stooq_history=lambda ticker: calls.append("stooq") or self._price_frame(103),
            synthetic_history=lambda ticker: calls.append("synthetic") or self._price_frame(104),
            clean_price_history=lambda frame: frame,
        )

        self.assertEqual(calls, ["yfinance"])
        self.assertEqual(payload["Close"].iloc[-1], 101)
        self.assertEqual(payload.attrs["source"], "yfinance")
        self.assertFalse(payload.attrs["synthetic"])

    def test_price_history_falls_back_to_yahoo_stooq_then_synthetic(self):
        yahoo = self._price_frame(202)
        yahoo.attrs["source"] = "yahoo_chart"
        calls = []

        payload = fetch_price_history(
            ticker="4980.T",
            period="6mo",
            interval="1d",
            yfinance_history=lambda *args: calls.append("yfinance") or pd.DataFrame(),
            yahoo_chart_history=lambda ticker: calls.append("yahoo") or yahoo,
            stooq_history=lambda ticker: calls.append("stooq") or self._price_frame(203),
            synthetic_history=lambda ticker: calls.append("synthetic") or self._price_frame(204),
            clean_price_history=lambda frame: frame,
        )

        self.assertEqual(calls, ["yfinance", "yahoo"])
        self.assertEqual(payload.attrs["source"], "yahoo_chart")
        self.assertFalse(payload.attrs["synthetic"])

        stooq = self._price_frame(303)
        synthetic = self._price_frame(404)
        calls = []
        payload = fetch_price_history(
            ticker="4980.T",
            period="6mo",
            interval="1d",
            yfinance_history=lambda *args: calls.append("yfinance") or pd.DataFrame(),
            yahoo_chart_history=lambda ticker: calls.append("yahoo") or None,
            stooq_history=lambda ticker: calls.append("stooq") or stooq,
            synthetic_history=lambda ticker: calls.append("synthetic") or synthetic,
            clean_price_history=lambda frame: frame,
        )

        self.assertEqual(calls, ["yfinance", "yahoo", "stooq"])
        self.assertEqual(payload.attrs["source"], "stooq_free_api")
        self.assertFalse(payload.attrs["synthetic"])

        calls = []
        payload = fetch_price_history(
            ticker="4980.T",
            period="6mo",
            interval="1d",
            yfinance_history=lambda *args: calls.append("yfinance") or (_ for _ in ()).throw(RuntimeError("rate limited")),
            yahoo_chart_history=lambda ticker: calls.append("yahoo") or None,
            stooq_history=lambda ticker: calls.append("stooq") or pd.DataFrame(),
            synthetic_history=lambda ticker: calls.append("synthetic") or synthetic.copy(),
            clean_price_history=lambda frame: frame,
        )

        self.assertEqual(calls, ["yfinance", "yahoo", "stooq", "synthetic"])
        self.assertEqual(payload.attrs["source"], "synthetic")
        self.assertTrue(payload.attrs["synthetic"])

    def test_material_event_summary_prioritizes_recent_negative_disclosures(self):
        now = pd.Timestamp("2026-06-17 09:00:00").to_pydatetime()
        disclosure = material_item(
            "業績予想の下方修正に関するお知らせ",
            source="TDnet無料RSS",
            published_at="2026-06-16T12:00:00",
            kind="disclosure",
            now=now,
        )
        news = material_item(
            "新製品を発表",
            source="Yahoo Finance",
            published_at="2026-06-16T10:00:00",
            kind="news",
            now=now,
        )

        payload = summarize_material_items(
            news_items=[news],
            disclosure_items=[disclosure],
            earnings_items=[],
        )

        self.assertEqual(payload["tone"], "negative")
        self.assertEqual(payload["materialScore"], 0.0)
        self.assertTrue(payload["hasNegative"])
        self.assertEqual(payload["recentOfficialDisclosureCount"], 1)

    def test_material_summary_uses_japanese_when_no_event_is_available(self):
        payload = summarize_material_items(
            news_items=[],
            disclosure_items=[],
            earnings_items=[],
        )

        self.assertEqual(payload["summary"], "直近の重要材料は確認できませんでした。")

    def test_material_events_for_ticker_uses_injected_feeds_and_jquants(self):
        now = pd.Timestamp("2026-06-17 09:00:00").to_pydatetime()

        class FakeResponse:
            content = """
                <rss><channel><item>
                    <title>4980 決算短信 上方修正</title>
                    <link>https://example.invalid/tdnet</link>
                    <pubDate>Tue, 16 Jun 2026 12:00:00 +0900</pubDate>
                </item></channel></rss>
            """.encode("utf-8")

            def raise_for_status(self):
                return None

        payload = material_events_for_ticker(
            "4980.T",
            "Dexerials",
            include_jquants=True,
            normalize_ticker=lambda value: str(value).upper(),
            yahoo_news_provider=lambda ticker: [
                {
                    "title": "自己株式取得を発表",
                    "publisher": "Yahoo Finance",
                    "providerPublishTime": int(pd.Timestamp("2026-06-16 11:00:00").timestamp()),
                }
            ],
            http_get=lambda *args, **kwargs: FakeResponse(),
            tdnet_recent_rss_url="https://example.invalid/recent.rss",
            tdnet_code_url_template="https://example.invalid/{code}.rss",
            research_packet=lambda ticker: {
                "latestStatement": {
                    "disclosedDate": "2026-06-16T09:30:00",
                    "type": "決算短信",
                    "earningsPerShare": "120.5",
                }
            },
            now=now,
        )

        self.assertEqual(payload["tone"], "positive")
        self.assertTrue(payload["materialAvailable"])
        self.assertGreaterEqual(payload["recentOfficialDisclosureCount"], 2)
        self.assertIn("TDnet無料RSS", payload["sources"])
        self.assertIn("J-Quants fins/statements", payload["sources"])

    def test_external_research_links_are_built_without_server_dependencies(self):
        links = external_research_links(
            "4980.T",
            "Dexerials",
            normalize_ticker=lambda value: str(value).upper(),
            tdnet_code_url_template="https://example.invalid/tdnet/{code}.rss",
        )

        self.assertEqual(links[0]["kind"], "price")
        self.assertTrue(any(link["kind"] == "disclosure" and "4980" in link["url"] for link in links))

    def test_daytrade_context_builds_quote_and_event_context_without_server(self):
        now = pd.Timestamp("2026-06-17 00:00:00", tz="UTC").to_pydatetime()

        class FakeSymbol:
            fast_info = {"bid": 1000, "ask": 1002, "lastPrice": 1001}
            news = [
                {
                    "title": "自己株式取得を発表",
                    "publisher": "Yahoo Finance",
                    "providerPublishTime": int(pd.Timestamp("2026-06-16 23:00:00", tz="UTC").timestamp()),
                }
            ]
            calendar = {"Earnings Date": [now + pd.Timedelta(days=2)]}

        quote = build_daytrade_quote_context("4980.T", symbol_provider=lambda ticker: FakeSymbol())
        event = build_daytrade_event_context(
            "4980.T",
            symbol_provider=lambda ticker: FakeSymbol(),
            positive_keywords=("自己株式取得",),
            negative_keywords=("下方修正",),
            important_keywords=("決算",),
            now=now,
        )

        self.assertEqual(quote["source"], "YFINANCE_FAST_INFO")
        self.assertEqual(quote["bid"], 1000)
        self.assertEqual(event["tone"], "positive")
        self.assertTrue(event["hasRecentMaterial"])
        self.assertTrue(event["hasUpcomingEarnings"])

    def test_daytrade_event_timestamp_accepts_iso_epoch_and_rfc822(self):
        self.assertIsNotNone(parse_event_timestamp("2026-06-17T00:00:00Z"))
        self.assertIsNotNone(parse_event_timestamp(1781654400))
        self.assertIsNotNone(parse_event_timestamp("Wed, 17 Jun 2026 09:00:00 +0900"))

    def test_preopen_analysis_response_attaches_material_context(self):
        payload = build_preopen_analysis_response(
            ticker="4980.T",
            info={"name": "Dexerials"},
            material_events_for_ticker=lambda ticker, name, include_jquants=False: {
                "materialAvailable": True,
                "materialScore": 0.8,
                "summary": f"{ticker} {name}",
            },
            preopen_for_ticker=lambda ticker, info, optional_feeds=None: {
                "ticker": ticker,
                "score": 72,
                "decisionLabel": "翌朝監視候補",
                "feedScore": optional_feeds["materialScore"],
            },
        )

        self.assertEqual(payload["ticker"], "4980.T")
        self.assertEqual(payload["feedScore"], 0.8)
        self.assertTrue(payload["material"]["materialAvailable"])

    def test_preopen_analysis_response_raises_when_engine_unavailable(self):
        with self.assertRaises(HTTPException) as raised:
            build_preopen_analysis_response(
                ticker="4980.T",
                info={"name": "Dexerials"},
                material_events_for_ticker=lambda *args, **kwargs: {},
                preopen_for_ticker=lambda *args, **kwargs: None,
            )

        self.assertEqual(raised.exception.status_code, 503)

    def test_advanced_analysis_response_handles_history_and_value_errors(self):
        frame = pd.DataFrame({"Close": [100, 102]})
        payload = build_advanced_analysis_response(
            ticker="4980.T",
            get_stock_data=lambda ticker, period, interval: frame,
            build_advanced_report=lambda ticker, hist, capital_jpy, risk_pct: {
                "ticker": ticker,
                "bars": len(hist),
                "capital": capital_jpy,
                "riskPct": risk_pct,
            },
            initial_cash=1_000_000,
        )

        self.assertEqual(payload["bars"], 2)
        self.assertEqual(payload["capital"], 1_000_000)

        with self.assertRaises(HTTPException) as no_engine:
            build_advanced_analysis_response(
                ticker="4980.T",
                get_stock_data=lambda *args, **kwargs: frame,
                build_advanced_report=None,
                initial_cash=1_000_000,
            )
        self.assertEqual(no_engine.exception.status_code, 503)

        with self.assertRaises(HTTPException) as no_data:
            build_advanced_analysis_response(
                ticker="4980.T",
                get_stock_data=lambda *args, **kwargs: pd.DataFrame(),
                build_advanced_report=lambda *args, **kwargs: {},
                initial_cash=1_000_000,
            )
        self.assertEqual(no_data.exception.status_code, 404)

        with self.assertRaises(HTTPException) as bad_input:
            build_advanced_analysis_response(
                ticker="4980.T",
                get_stock_data=lambda *args, **kwargs: frame,
                build_advanced_report=lambda *args, **kwargs: (_ for _ in ()).throw(ValueError("bad history")),
                initial_cash=1_000_000,
            )
        self.assertEqual(bad_input.exception.status_code, 422)

    def test_market_search_uses_snapshot_order_before_unpriced_universe(self):
        universe = {
            "1301.T": {"name": "Kyokuyo", "market_section": "Prime", "sector": "Foods"},
            "7203.T": {"name": "Toyota", "market_section": "Prime", "sector": "Transport"},
        }
        snapshot = {"items": [{"ticker": "7203.T", "price": 3000, "source": "yfinance"}]}

        payload = build_market_search_response(
            query="",
            market="",
            sector="",
            limit=2,
            load_market_universe=lambda: universe,
            load_market_snapshot=lambda: snapshot,
            market_snapshot_items=lambda snap: snap.get("items", []),
            hydrate_market_search_prices=lambda entries, snapshot_items: [
                {"ticker": ticker, "price": (snapshot_items.get(ticker) or {}).get("price")}
                for ticker, _info in entries
            ],
        )

        self.assertEqual([item["ticker"] for item in payload["items"]], ["7203.T", "1301.T"])

    def test_market_universe_response_reports_counts_and_snapshot_sample(self):
        universe = {
            "1301.T": {"name": "Kyokuyo", "market_section": "Prime", "sector": "Foods"},
            "7203.T": {"name": "Toyota", "market_section": "Prime", "sector": "Transport"},
        }
        snapshot = {
            "items": [{"ticker": "7203.T", "price": 3000, "source": "yfinance"}],
            "generatedAt": "2026-06-17T00:00:00+09:00",
            "analyzedCount": 1,
            "provider": "unit-test",
        }

        payload = build_market_universe_response(
            load_market_universe=lambda: universe,
            load_market_snapshot=lambda: snapshot,
            market_snapshot_items=lambda snap: snap.get("items", []),
            market_search_item=lambda ticker, info, item: {
                "ticker": ticker,
                "name": info["name"],
                "price": (item or {}).get("price"),
            },
            universe_source="unit-master",
        )

        self.assertEqual(payload["count"], 2)
        self.assertEqual(payload["source"], "unit-master")
        self.assertEqual(payload["snapshot"]["analyzedCount"], 1)
        self.assertEqual(payload["sample"][0]["ticker"], "7203.T")
        self.assertEqual(payload["sample"][0]["price"], 3000)

    def test_market_rankings_response_keeps_source_flags_and_best_available(self):
        snapshot = {
            "generatedAt": "2026-06-17T00:00:00+09:00",
            "source": "cache",
            "provider": "unit-test",
            "isCached": True,
            "universeCount": 2,
            "analyzedCount": 2,
            "items": [],
            "rankings": {
                "surge": [
                    {"ticker": "4980.T", "score": 90},
                    {"ticker": "7203.T", "score": 80},
                ]
            },
        }
        ranked_calls = {}

        def rank_market_items(items, kind):
            ranked_calls["kind"] = kind
            return items

        payload = build_market_rankings_response(
            kind="surge",
            limit=2,
            budget=500000,
            market_status={"isOpen": False},
            load_market_snapshot=lambda: snapshot,
            load_market_universe=lambda: {"4980.T": {"name": "Dexerials"}},
            market_snapshot_items=lambda snap: snap.get("items", []),
            market_context_freshness=lambda snap: {},
            market_context_items_from_snapshot=lambda snap, freshness: [],
            market_context_integrity=lambda *args, **kwargs: {"ok": True},
            attach_market_master_metadata=_identity,
            market_quality_overlay=lambda item: {**item, "qualityOverlay": True},
            attach_material_events=_identity,
            attach_candidate_quality=_identity,
            attach_market_relative_context=lambda items, *_args, **_kwargs: items,
            rank_with_material_refresh=lambda items, *_args, **_kwargs: items,
            attach_advanced_cross_engine_checks=lambda items, *_args, **_kwargs: items,
            rank_by_audited_opportunity=lambda items, *_args, **_kwargs: items,
            rank_market_items=rank_market_items,
            select_best_ranked_opportunity=lambda items, **_kwargs: items[0],
            select_best_available_opportunity=lambda items, selected: selected,
            yahoo_finance_gainers=lambda limit: [],
            data_source_flags=lambda source, cached=False: {
                "dataSource": source,
                "isCached": cached,
            },
            json_safe=lambda payload: payload,
            fallback_candidate_pool={},
            stocks={},
            market_item_from_stock_payload=lambda payload: payload,
            stock_payload=lambda ticker, info: {"ticker": ticker, **info},
            snapshot_payload=lambda items, count, source: {"items": items, "universeCount": count, "source": source},
            yahoo_finance_gainers_url="https://example.invalid/gainers",
        )

        self.assertEqual(ranked_calls["kind"], "surge")
        self.assertEqual(payload["dataSource"], "cache")
        self.assertTrue(payload["isCached"])
        self.assertEqual(payload["bestAvailableOpportunity"]["ticker"], "4980.T")
        self.assertEqual([item["ticker"] for item in payload["items"]], ["4980.T", "7203.T"])


if __name__ == "__main__":
    unittest.main()
