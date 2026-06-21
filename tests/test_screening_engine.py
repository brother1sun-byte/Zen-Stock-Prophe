import sys
import unittest
import math
import asyncio
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

import server  # noqa: E402
from daytrade_engine import BoardSnapshot, build_signal_ticket, validate_entry  # noqa: E402
from market_fallbacks import choose_best_opportunities, ensure_market_snapshot  # noqa: E402


def fresh_business_index(periods: int) -> pd.DatetimeIndex:
    end = server.dt.datetime.now(server.JST).date()
    while end.weekday() >= 5:
        end -= server.dt.timedelta(days=1)
    return pd.bdate_range(end=end, periods=periods)


class ScreeningEngineTests(unittest.TestCase):
    def setUp(self):
        server.MARKET_REVIEW_CACHE.clear()
        server.MARKET_REVIEW_INFLIGHT.clear()
        server.PRICE_HISTORY_CACHE.clear()
        server.PRICE_HISTORY_INFLIGHT.clear()

    def test_fastapi_uses_lifespan_and_initializes_database(self):
        self.assertEqual(server.app.router.on_startup, [])

        async def run_lifespan():
            with patch.object(server, "init_db") as init_db:
                async with server.app.router.lifespan_context(server.app):
                    init_db.assert_called_once_with()

        asyncio.run(run_lifespan())

    def test_market_rankings_reuses_shared_cache_for_identical_requests(self):
        payload = {
            "kind": "surge",
            "generatedAt": "2026-06-20T00:00:00+00:00",
            "items": [{"ticker": "7203.T"}],
        }

        with patch.object(server, "build_market_rankings_response", return_value=payload) as build:
            first = server.market_rankings(kind="surge", limit=30, budget=500_000)
            second = server.market_rankings(kind="surge", limit=30, budget=500_000)

        self.assertIs(first, second)
        self.assertEqual(build.call_count, 1)

    def test_market_rankings_singleflights_concurrent_identical_requests(self):
        build_started = threading.Event()
        release_build = threading.Event()
        payload = {
            "kind": "surge",
            "generatedAt": "2026-06-20T00:00:00+00:00",
            "items": [{"ticker": "7203.T"}],
        }

        def slow_build(**_kwargs):
            build_started.set()
            self.assertTrue(release_build.wait(timeout=2))
            return payload

        with patch.object(server, "build_market_rankings_response", side_effect=slow_build) as build:
            with ThreadPoolExecutor(max_workers=2) as pool:
                first_future = pool.submit(server.market_rankings, "surge", 30, 500_000)
                self.assertTrue(build_started.wait(timeout=1))
                second_future = pool.submit(server.market_rankings, "surge", 30, 500_000)
                release_build.set()
                first = first_future.result(timeout=3)
                second = second_future.result(timeout=3)

        self.assertIs(first, second)
        self.assertEqual(build.call_count, 1)

    def test_material_enrichment_runs_independent_tickers_concurrently_and_keeps_order(self):
        second_started = threading.Event()
        first_observed_overlap = []

        def material_lookup(ticker, _name, include_jquants=False):
            if ticker == "1111.T":
                first_observed_overlap.append(second_started.wait(timeout=0.5))
            else:
                second_started.set()
            return {"available": True, "ticker": ticker, "includeJquants": include_jquants}

        items = [
            {"ticker": "1111.T", "name": "First"},
            {"ticker": "2222.T", "name": "Second"},
        ]
        with patch.object(server, "material_events_for_ticker", side_effect=material_lookup):
            enriched = server._attach_material_events(items)

        self.assertEqual([item["ticker"] for item in enriched], ["1111.T", "2222.T"])
        self.assertEqual([item["material"]["ticker"] for item in enriched], ["1111.T", "2222.T"])
        self.assertEqual(first_observed_overlap, [True])

    def test_quality_enrichment_runs_independent_tickers_concurrently_and_keeps_order(self):
        second_started = threading.Event()
        first_observed_overlap = []

        def quality_lookup(ticker):
            if ticker == "1111.T":
                first_observed_overlap.append(second_started.wait(timeout=0.5))
            else:
                second_started.set()
            return {"ticker": ticker, "dataQuality": {"source": "test"}}

        items = [
            {"ticker": "1111.T", "name": "First"},
            {"ticker": "2222.T", "name": "Second"},
        ]
        with patch.object(server, "quality_for_ticker", side_effect=quality_lookup):
            enriched = server._attach_candidate_quality(items, limit=2)

        self.assertEqual([item["ticker"] for item in enriched], ["1111.T", "2222.T"])
        self.assertEqual([item["candidateQuality"]["ticker"] for item in enriched], ["1111.T", "2222.T"])
        self.assertEqual(first_observed_overlap, [True])

    def test_stock_history_reuses_short_lived_cache_for_identical_requests(self):
        history = pd.DataFrame(
            {
                "Open": [100.0, 101.0],
                "High": [102.0, 103.0],
                "Low": [99.0, 100.0],
                "Close": [101.0, 102.0],
                "Volume": [1000, 1200],
            }
        )

        with patch.object(server, "fetch_price_history", return_value=history) as fetch:
            first = server.get_stock_data("7203.T", period="1y", interval="1d")
            second = server.get_stock_data("7203.T", period="1y", interval="1d")

        self.assertEqual(fetch.call_count, 1)
        self.assertIsNot(first, second)
        pd.testing.assert_frame_equal(first, second)

    def test_normalize_jpx_code_handles_excel_numeric_codes(self):
        self.assertEqual(server._normalize_jpx_code(7203.0), "7203")
        self.assertEqual(server._normalize_jpx_code("4980.0"), "4980")
        self.assertEqual(server._normalize_jpx_code("130A"), "130A")

    def test_market_ticker_validation_rejects_unsafe_input(self):
        self.assertEqual(server.validate_market_ticker("4980"), "4980.T")
        self.assertEqual(server.validate_market_ticker("^N225"), "^N225")
        with self.assertRaises(Exception):
            server.validate_market_ticker("../../secret")

    def test_get_stocks_returns_json_safe_numpy_scalars(self):
        original_stocks = server.STOCKS
        original_stock_payload = server._stock_payload
        try:
            server.STOCKS = {"1111.T": {"name": "Json Safe"}}
            server._stock_payload = lambda ticker, info: {
                "ticker": ticker,
                "name": info["name"],
                "candidateScore": np.float64(72.5),
                "liquidityOk": np.bool_(True),
            }

            payload = server.get_stocks()
        finally:
            server.STOCKS = original_stocks
            server._stock_payload = original_stock_payload

        self.assertIsInstance(payload[0]["candidateScore"], float)
        self.assertIsInstance(payload[0]["liquidityOk"], bool)

    def test_smooth_breakout_is_not_rejected_as_overhead_resistance(self):
        prices = [100 + i for i in range(252)]
        highs = [price * 1.02 for price in prices]
        lows = [price * 0.98 for price in prices]

        rr = server.calculate_risk_reward(prices[-1], highs, lows, prices)

        self.assertGreaterEqual(rr["rr_ratio"], 2.0)
        self.assertTrue(rr["is_favorable"])
        self.assertEqual(rr["blocking_resistance_zones"], [])

    def test_display_candidates_keep_watchlist_depth_when_one_treasure_exists(self):
        treasure = [{"ticker": "1803.T", "score": 99}]
        review = [{"ticker": "7203.T", "score": 78}, {"ticker": "6758.T", "score": 76}]
        prefilter = [{"ticker": "7203.T", "score": 72}, {"ticker": "8306.T", "score": 68}]

        merged = server._merge_display_candidates(treasure, review, prefilter)

        self.assertEqual([item["ticker"] for item in merged], ["1803.T", "7203.T", "6758.T", "8306.T"])

    def test_only_dexerials_is_canonical_fixed_watch_candidate(self):
        self.assertEqual(list(server.MUST_INCLUDE), ["4980.T"])
        self.assertIn("4980.T", server.STOCKS)
        self.assertEqual(server.MUST_INCLUDE["4980.T"]["candidate_rank"], 1)
        self.assertEqual(server.MUST_INCLUDE["4980.T"]["candidate_score"], 100)

    def test_publish_watchlist_preserves_dexerials_first(self):
        original_stocks = server.STOCKS
        try:
            published = server._publish_watchlist_candidates([
                {"ticker": "7203.T", "score": 78, "reason": "test", "info": {"name": "Toyota", "emoji": "TY"}},
            ])
        finally:
            server.STOCKS = original_stocks

        self.assertNotIn("6503.T", published)
        self.assertEqual(published["4980.T"]["candidate_rank"], 1)
        self.assertEqual(published["7203.T"]["candidate_rank"], 2)

    def test_stock_payload_uses_live_history_score_for_pinned_candidate(self):
        closes = [100 - index * 0.3 for index in range(90)]
        frame = pd.DataFrame(
            {
                "Open": [value * 1.002 for value in closes],
                "High": [value * 1.01 for value in closes],
                "Low": [value * 0.99 for value in closes],
                "Close": closes,
                "Volume": [200000 for _ in closes],
            },
            index=pd.date_range("2026-01-01", periods=len(closes), freq="B"),
        )

        original_get_stock_data = server.get_stock_data
        try:
            server.get_stock_data = lambda *args, **kwargs: frame
            payload = server._stock_payload("4980.T", server.MUST_INCLUDE["4980.T"])
        finally:
            server.get_stock_data = original_get_stock_data

        self.assertNotEqual(payload["candidateScore"], server.MUST_INCLUDE["4980.T"]["candidate_score"])
        self.assertEqual(payload["publishedCandidateScore"], server.MUST_INCLUDE["4980.T"]["candidate_score"])
        self.assertEqual(payload["candidateRank"], 1)

    def test_get_stock_data_uses_yahoo_chart_before_synthetic_fallback(self):
        frame = pd.DataFrame(
            {
                "Open": [4000, 4100],
                "High": [4120, 4210],
                "Low": [3980, 4050],
                "Close": [4093, 4052],
                "Volume": [3090200, 2800000],
            },
            index=pd.date_range("2026-05-22", periods=2, freq="B"),
        )
        frame.attrs["source"] = "yahoo_chart"

        class _FailingTicker:
            def __init__(self, *_args, **_kwargs):
                pass

            def history(self, *_args, **_kwargs):
                raise RuntimeError("rate limited")

        original_ticker = server.yf.Ticker
        original_yahoo_chart = server._history_from_yahoo_chart
        try:
            server.yf.Ticker = _FailingTicker
            server._history_from_yahoo_chart = lambda ticker: frame
            hist = server.get_stock_data("4980.T")
        finally:
            server.yf.Ticker = original_ticker
            server._history_from_yahoo_chart = original_yahoo_chart

        self.assertEqual(hist["Close"].iloc[-1], 4052)
        self.assertEqual(hist.attrs["source"], "yahoo_chart")
        self.assertFalse(hist.attrs["synthetic"])

    def test_market_universe_filters_to_domestic_jpx_issues(self):
        original_path = server.JPX_UNIVERSE_PATH
        original_url = server.JPX_LISTED_ISSUES_URL
        try:
            frame = pd.DataFrame(
                [
                    {"Local Code": "4980", "Name (English)": "Dexerials", "Section/Products": "Prime Market (Domestic)", "33 Sector(name)": "Chemicals"},
                    {"Local Code": "7203", "Name (English)": "Toyota", "Section/Products": "Prime Market (Domestic)", "33 Sector(name)": "Transportation Equipment"},
                    {"Local Code": "9999", "Name (English)": "Foreign Test", "Section/Products": "Prime Market (Foreign)", "33 Sector(name)": "Foreign"},
                ]
            )
            path = ROOT / "tmp_jpx_universe_test.xlsx"
            frame.to_excel(path, index=False)
            server.JPX_UNIVERSE_PATH = str(path)
            server.JPX_LISTED_ISSUES_URL = ""

            universe = server.load_market_universe()
        finally:
            server.JPX_UNIVERSE_PATH = original_path
            server.JPX_LISTED_ISSUES_URL = original_url
            if "path" in locals() and path.exists():
                path.unlink()

        self.assertIn("4980.T", universe)
        self.assertIn("7203.T", universe)
        self.assertNotIn("9999.T", universe)
        self.assertTrue(universe["4980.T"]["must_include"])

    def test_market_snapshot_keeps_full_items_for_search_prices(self):
        items = [
            {"ticker": "1301.T", "name": "Kyokuyo", "price": 4100, "changePct": 1.2},
            {"ticker": "7203.T", "name": "Toyota", "price": 3000, "changePct": -0.4},
        ]

        snapshot = server._snapshot_payload(items, universe_count=2, source="unit-test")

        self.assertEqual(snapshot["items"], items)
        self.assertEqual(server._market_snapshot_items(snapshot)[0]["ticker"], "1301.T")

    def test_ensure_market_snapshot_preserves_existing_snapshot(self):
        snapshot = {"generatedAt": "2026-06-17T00:00:00+09:00", "items": [{"ticker": "4980.T"}]}

        result = ensure_market_snapshot(
            snapshot,
            fallback_candidate_pool={},
            stocks={},
            load_market_universe=lambda: {"4980.T": {"name": "Dexerials"}},
            market_item_from_stock_payload=lambda payload: payload,
            stock_payload=lambda ticker, info: {"ticker": ticker, **info},
            snapshot_payload=lambda items, count, source: {"items": items, "universeCount": count, "source": source},
        )

        self.assertIs(result, snapshot)

    def test_ensure_market_snapshot_builds_watchlist_fallback_when_missing(self):
        result = ensure_market_snapshot(
            None,
            fallback_candidate_pool={"4980.T": {"name": "Dexerials"}},
            stocks={"7203.T": {"name": "Toyota"}},
            load_market_universe=lambda: {"4980.T": {"name": "Dexerials"}, "7203.T": {"name": "Toyota"}},
            market_item_from_stock_payload=lambda payload: {"ticker": payload["ticker"], "name": payload["name"]},
            stock_payload=lambda ticker, info: {"ticker": ticker, "name": info["name"]},
            snapshot_payload=lambda items, count, source: {"items": items, "universeCount": count, "source": source},
        )

        self.assertEqual(result["source"], "live_watchlist_fallback")
        self.assertEqual(result["universeCount"], 2)
        self.assertEqual([item["ticker"] for item in result["items"]], ["4980.T", "7203.T"])

    def test_choose_best_opportunities_requires_cross_engine_when_any_candidate_has_it(self):
        observed = {}

        def fake_select_best_ranked(items, require_cross_engine_check=False):
            observed["require_cross_engine_check"] = require_cross_engine_check
            return items[0]

        best_source, best_available = choose_best_opportunities(
            [
                {"ticker": "4980.T", "advancedCrossEngineCheck": {"status": "aligned"}},
                {"ticker": "7203.T"},
            ],
            select_best_ranked_opportunity=fake_select_best_ranked,
            select_best_available_opportunity=lambda items, selected: items[1] if selected else None,
        )

        self.assertTrue(observed["require_cross_engine_check"])
        self.assertEqual(best_source["ticker"], "4980.T")
        self.assertEqual(best_available["ticker"], "7203.T")

    def test_market_universe_sample_uses_priced_snapshot_items(self):
        original_load_universe = server.load_market_universe
        original_load_snapshot = server._load_market_snapshot
        try:
            server.load_market_universe = lambda: {
                "1301.T": {"name": "Kyokuyo", "market_section": "Prime Market", "sector": "Foods"},
                "7203.T": {"name": "Toyota", "market_section": "Prime Market", "sector": "Transport"},
            }
            server._load_market_snapshot = lambda: {
                "items": [
                    {"ticker": "7203.T", "name": "Toyota", "price": 3000, "changePct": 0.5, "source": "yfinance"}
                ],
                "rankings": {},
                "generatedAt": "2026-05-23T00:00:00+00:00",
                "analyzedCount": 1,
                "provider": "unit-test",
            }

            payload = server.market_universe()
        finally:
            server.load_market_universe = original_load_universe
            server._load_market_snapshot = original_load_snapshot

        self.assertEqual(payload["sample"][0]["ticker"], "7203.T")
        self.assertEqual(payload["sample"][0]["price"], 3000)

    def test_empty_market_search_prioritizes_priced_snapshot_items(self):
        original_load_universe = server.load_market_universe
        original_load_snapshot = server._load_market_snapshot
        try:
            server.load_market_universe = lambda: {
                "1301.T": {"name": "Kyokuyo", "market_section": "Prime Market", "sector": "Foods"},
                "7203.T": {"name": "Toyota", "market_section": "Prime Market", "sector": "Transport"},
            }
            server._load_market_snapshot = lambda: {
                "items": [
                    {"ticker": "7203.T", "name": "Toyota", "price": 3000, "changePct": 0.5, "source": "yfinance"}
                ],
                "rankings": {},
            }

            payload = server.market_search(q="", market="", sector="", limit=1)
        finally:
            server.load_market_universe = original_load_universe
            server._load_market_snapshot = original_load_snapshot

        self.assertEqual(payload["items"][0]["ticker"], "7203.T")
        self.assertEqual(payload["items"][0]["price"], 3000)

    def test_market_search_hydrates_missing_prices_from_live_history(self):
        original_load_universe = server.load_market_universe
        original_load_snapshot = server._load_market_snapshot
        original_download = server.yf.download
        original_history_from_download = server._history_from_download
        try:
            server.load_market_universe = lambda: {
                "1301.T": {"name": "Kyokuyo", "market_section": "Prime Market", "sector": "Foods"},
            }
            server._load_market_snapshot = lambda: {"items": [], "rankings": {}}
            frame = pd.DataFrame(
                {
                    "Open": [4000, 4050],
                    "High": [4100, 4150],
                    "Low": [3980, 4040],
                    "Close": [4050, 4120],
                    "Volume": [120000, 130000],
                },
                index=pd.date_range("2026-05-21", periods=2, freq="B"),
            )
            server.yf.download = lambda *args, **kwargs: object()
            server._history_from_download = lambda downloaded, ticker: frame

            payload = server.market_search(q="1301", market="", sector="", limit=1)
        finally:
            server.load_market_universe = original_load_universe
            server._load_market_snapshot = original_load_snapshot
            server.yf.download = original_download
            server._history_from_download = original_history_from_download

        self.assertEqual(payload["items"][0]["ticker"], "1301.T")
        self.assertEqual(payload["items"][0]["price"], 4120)
        self.assertEqual(payload["items"][0]["source"], "yfinance")

    def test_market_search_falls_back_to_yahoo_chart_when_yfinance_missing(self):
        original_load_universe = server.load_market_universe
        original_load_snapshot = server._load_market_snapshot
        original_download = server.yf.download
        original_history_from_download = server._history_from_download
        original_history_from_stooq = server._history_from_stooq
        original_history_from_yahoo_chart = server._history_from_yahoo_chart
        try:
            server.load_market_universe = lambda: {
                "7203.T": {"name": "Toyota", "market_section": "Prime Market", "sector": "Transport"},
            }
            server._load_market_snapshot = lambda: {"items": [], "rankings": {}}
            frame = pd.DataFrame(
                {
                    "Open": [2960, 2980],
                    "High": [3020, 3030],
                    "Low": [2950, 2970],
                    "Close": [2978, 2987],
                    "Volume": [21000000, 16000000],
                },
                index=pd.date_range("2026-05-21", periods=2, freq="B"),
            )
            frame.attrs["source"] = "yahoo_chart"
            server.yf.download = lambda *args, **kwargs: None
            server._history_from_download = lambda downloaded, ticker: None
            server._history_from_stooq = lambda ticker: None
            server._history_from_yahoo_chart = lambda ticker: frame

            payload = server.market_search(q="7203", market="", sector="", limit=1)
        finally:
            server.load_market_universe = original_load_universe
            server._load_market_snapshot = original_load_snapshot
            server.yf.download = original_download
            server._history_from_download = original_history_from_download
            server._history_from_stooq = original_history_from_stooq
            server._history_from_yahoo_chart = original_history_from_yahoo_chart

        self.assertEqual(payload["items"][0]["ticker"], "7203.T")
        self.assertEqual(payload["items"][0]["price"], 2987)
        self.assertEqual(payload["items"][0]["source"], "yahoo_chart")

    def test_intraday_opportunity_uses_500k_budget_and_single_share_unit(self):
        today = server.dt.datetime.now(server.JST).date().isoformat()
        item = {
            "ticker": "7203.T",
            "name": "Toyota",
            "price": 2987,
            "changePct": 0.3,
            "volumeRatio": 1.6,
            "surgeScore": 72,
            "candidateScore": 68,
            "overheatRisk": 12,
            "liquidityOk": True,
            "liquidityGrade": "deep",
            "momentum5Pct": 3.2,
            "targetPrice": 3077,
            "stopLoss": 2927,
            "latestBarDate": today,
            "candidateQuality": {
                "backtest": {
                    "sampleCount": 8,
                    "riskAdjustedReturnPct": 1.0,
                    "profitFactor": 1.4,
                }
            },
            "material": {
                "tone": "positive",
                "materialScore": 0.8,
                "freshnessVerdict": "fresh",
                "hasNegative": False,
                "hasRecentImportant": True,
                "recentOfficialDisclosureCount": 1,
            },
        }

        opportunity = server._build_intraday_opportunity(item, budget_jpy=500_000)

        self.assertEqual(opportunity["ticker"], "7203.T")
        self.assertEqual(opportunity["shares"], 167)
        self.assertEqual(opportunity["maxBudgetShares"], 167)
        self.assertEqual(opportunity["positionSizingVerdict"], "normal")
        self.assertEqual(opportunity["budgetJpy"], 500_000)
        self.assertEqual(opportunity["budgetUsedJpy"], 498_829)
        self.assertGreater(opportunity["targetProfitJpy"], 0)
        self.assertGreater(opportunity["confidencePct"], 50)
        self.assertGreater(opportunity["opportunityScore"], 0)
        self.assertEqual(opportunity["riskAdjustedExpectedJpy"], opportunity["opportunityScore"])
        self.assertEqual(opportunity["scoreBreakdown"]["finalOpportunityScore"], opportunity["opportunityScore"])
        self.assertIn("riskPenaltyJpy", opportunity["scoreBreakdown"])
        self.assertIn("auditMultiplier", opportunity["scoreBreakdown"])
        self.assertIn("whyBuy", opportunity)
        self.assertIn("whyNotBuy", opportunity)
        self.assertIn("invalidConditions", opportunity)
        self.assertIn("dataFreshness", opportunity)
        self.assertIn("decisionAudit", opportunity)
        self.assertTrue(opportunity["decisionAudit"]["gates"])

        visible_copy = [
            *opportunity["whyBuy"],
            *opportunity["whyNotBuy"],
            *opportunity["invalidConditions"],
            *opportunity["expertWarnings"],
            *(item["label"] for item in opportunity["expertChecklist"]),
        ]
        english_fragments = (
            "official material",
            "Stop-loss",
            "Liquidity is",
            "Overheat risk",
            "No major blocker",
            "Break below",
            "Cannot reach target",
            "Material/news source",
            "Spread, board depth",
            "Price freshness",
            "Material reliability",
            "Evidence strength",
            "Market context",
        )
        self.assertFalse(any(fragment in text for text in visible_copy for fragment in english_fragments))

    def test_intraday_opportunity_penalizes_negative_material(self):
        base = {
            "ticker": "7203.T",
            "name": "Toyota",
            "price": 2500,
            "changePct": 2.0,
            "volumeRatio": 2.0,
            "surgeScore": 80,
            "candidateScore": 80,
            "overheatRisk": 10,
            "liquidityOk": True,
            "momentum5Pct": 4.0,
            "targetPrice": 2625,
            "stopLoss": 2440,
        }

        positive = server._build_intraday_opportunity({
            **base,
            "material": {"tone": "positive", "summary": "上方修正を発表"},
        }, budget_jpy=500_000)
        negative = server._build_intraday_opportunity({
            **base,
            "material": {"tone": "negative", "summary": "下方修正を発表"},
        }, budget_jpy=500_000)

        self.assertGreater(positive["confidencePct"], negative["confidencePct"])
        self.assertTrue(any("悪材料" in item for item in negative["whyNotBuy"]))
        self.assertGreater(
            negative["scoreBreakdown"]["materialReliabilityPenaltyJpy"],
            positive["scoreBreakdown"]["materialReliabilityPenaltyJpy"],
        )

    def test_intraday_opportunity_penalizes_unconfirmed_material_in_score_breakdown(self):
        base = {
            "ticker": "MATQ.T",
            "name": "Material Quality",
            "price": 1000,
            "changePct": 3.0,
            "volumeRatio": 2.2,
            "surgeScore": 84,
            "candidateScore": 82,
            "overheatRisk": 10,
            "liquidityOk": True,
            "liquidityGrade": "tradable",
            "turnoverJpy": 800_000_000,
            "momentum5Pct": 5,
            "targetPrice": 1060,
            "stopLoss": 985,
            "latestBarDate": server.dt.datetime.now(server.JST).date().isoformat(),
            "candidateQuality": {
                "backtest": {
                    "sampleCount": 8,
                    "winRate": 64,
                    "riskAdjustedReturnPct": 0.8,
                    "profitFactor": 1.4,
                }
            },
            "marketRelative": {
                "available": True,
                "riskOff": False,
                "sectorTailwind": True,
                "sectorHeadwind": False,
                "relativeToMarketPct": 1.0,
                "summary": "市場平均 +0.20% / 上昇比率 60.0% / sector平均 +0.80%",
            },
        }
        official = server._build_intraday_opportunity(
            {
                **base,
                "material": {
                    "tone": "positive",
                    "materialScore": 0.9,
                    "summary": "上方修正を発表",
                    "freshnessVerdict": "fresh",
                    "hasRecentImportant": True,
                    "recentOfficialDisclosureCount": 1,
                },
            },
            budget_jpy=500_000,
        )
        news_only = server._build_intraday_opportunity(
            {
                **base,
                "material": {
                    "tone": "positive",
                    "materialScore": 0.9,
                    "summary": "報道で新製品が伝わる",
                    "freshnessVerdict": "fresh",
                    "hasRecentImportant": True,
                    "recentOfficialDisclosureCount": 0,
                },
            },
            budget_jpy=500_000,
        )
        unconfirmed = server._build_intraday_opportunity(
            {**base, "material": {"tone": "unconfirmed", "summary": "未確認"}},
            budget_jpy=500_000,
        )

        self.assertEqual(official["scoreBreakdown"]["materialReliabilityGrade"], "official_confirmed")
        self.assertEqual(official["scoreBreakdown"]["materialReliabilityPenaltyJpy"], 0)
        self.assertEqual(news_only["scoreBreakdown"]["materialReliabilityGrade"], "news_only")
        self.assertGreater(news_only["scoreBreakdown"]["materialReliabilityPenaltyJpy"], 0)
        self.assertEqual(unconfirmed["scoreBreakdown"]["materialReliabilityGrade"], "unconfirmed")
        self.assertGreater(
            unconfirmed["scoreBreakdown"]["materialReliabilityPenaltyJpy"],
            news_only["scoreBreakdown"]["materialReliabilityPenaltyJpy"],
        )
        self.assertGreater(official["opportunityScore"], news_only["opportunityScore"])
        self.assertGreater(news_only["opportunityScore"], unconfirmed["opportunityScore"])
        self.assertTrue(any("材料信頼度の控除" in item for item in unconfirmed["whyNotBuy"]))

    def test_intraday_opportunity_decision_audit_passes_only_verified_setups(self):
        base = {
            "ticker": "AUDT.T",
            "name": "Audit Test",
            "price": 1000,
            "changePct": 2.8,
            "volumeRatio": 2.4,
            "surgeScore": 84,
            "candidateScore": 82,
            "overheatRisk": 12,
            "liquidityOk": True,
            "liquidityGrade": "tradable",
            "momentum5Pct": 5.0,
            "targetPrice": 1060,
            "stopLoss": 985,
            "latestBarDate": server.dt.datetime.now(server.JST).date().isoformat(),
            "candidateQuality": {
                "backtest": {
                    "sampleCount": 12,
                    "winRate": 66,
                    "riskAdjustedReturnPct": 1.1,
                    "profitFactor": 1.7,
                }
            },
            "marketRelative": {
                "available": True,
                "riskOff": False,
                "sectorTailwind": True,
                "sectorHeadwind": False,
                "relativeToMarketPct": 1.2,
                "summary": "市場平均 +0.30% / 上昇比率 62.0% / sector平均 +1.00%",
            },
        }
        verified = server._build_intraday_opportunity({
            **base,
            "material": {
                "tone": "positive",
                "materialScore": 0.9,
                "summary": "上方修正を発表",
                "freshnessVerdict": "fresh",
                "hasRecentImportant": True,
                "recentOfficialDisclosureCount": 1,
            },
        }, budget_jpy=500_000)
        rejected = server._build_intraday_opportunity({
            **base,
            "liquidityOk": False,
            "liquidityGrade": "thin",
            "material": {
                "tone": "negative",
                "materialScore": 0,
                "summary": "下方修正を発表",
                "freshnessVerdict": "fresh",
                "hasNegative": True,
                "recentOfficialDisclosureCount": 1,
            },
            "marketRelative": {
                **base["marketRelative"],
                "riskOff": True,
                "sectorTailwind": False,
                "sectorHeadwind": True,
                "summary": "市場平均 -1.20% / 上昇比率 25.0% / sector平均 -1.80%",
            },
        }, budget_jpy=500_000)

        self.assertEqual(verified["decisionAudit"]["verdict"], "PASS")
        self.assertEqual(rejected["decisionAudit"]["verdict"], "REJECT")
        self.assertGreater(verified["opportunityScore"], rejected["opportunityScore"])
        self.assertGreater(rejected["decisionAudit"]["failedHighCount"], 0)
        self.assertEqual(verified["scoreBreakdown"]["auditMultiplier"], 1.0)
        self.assertEqual(rejected["scoreBreakdown"]["auditMultiplier"], 0.35)
        self.assertEqual(rejected["scoreBreakdown"]["finalOpportunityScore"], rejected["opportunityScore"])
        self.assertTrue(any("監査判定" in item for item in rejected["whyNotBuy"]))
        failed_ids = {gate["id"] for gate in rejected["decisionAudit"]["gates"] if not gate["ok"]}
        self.assertIn("liquidity", failed_ids)
        self.assertIn("material", failed_ids)

    def test_intraday_opportunity_penalizes_execution_risk_for_thin_low_price_names(self):
        base = {
            "ticker": "LIQD.T",
            "name": "Liquidity Test",
            "price": 120,
            "changePct": 6.0,
            "volumeRatio": 1.8,
            "surgeScore": 88,
            "candidateScore": 84,
            "overheatRisk": 20,
            "momentum5Pct": 6.0,
            "targetPrice": 132,
            "stopLoss": 116,
            "latestBarDate": server.dt.datetime.now(server.JST).date().isoformat(),
            "candidateQuality": {
                "backtest": {
                    "sampleCount": 8,
                    "winRate": 64,
                    "riskAdjustedReturnPct": 0.9,
                    "profitFactor": 1.4,
                }
            },
            "material": {
                "tone": "positive",
                "materialScore": 0.8,
                "summary": "上方修正を発表",
                "freshnessVerdict": "fresh",
                "hasRecentImportant": True,
                "recentOfficialDisclosureCount": 1,
            },
            "marketRelative": {
                "available": True,
                "riskOff": False,
                "sectorTailwind": True,
                "sectorHeadwind": False,
                "relativeToMarketPct": 1.0,
                "summary": "市場平均 +0.20% / 上昇比率 60.0% / sector平均 +0.80%",
            },
        }
        liquid = server._build_intraday_opportunity(
            {
                **base,
                "ticker": "DEEP.T",
                "turnoverJpy": 2_000_000_000,
                "liquidityOk": True,
                "liquidityGrade": "deep",
            },
            budget_jpy=500_000,
        )
        thin = server._build_intraday_opportunity(
            {
                **base,
                "ticker": "THIN.T",
                "turnoverJpy": 20_000_000,
                "liquidityOk": False,
                "liquidityGrade": "thin",
            },
            budget_jpy=500_000,
        )

        self.assertGreater(thin["scoreBreakdown"]["executionRiskPenaltyJpy"], liquid["scoreBreakdown"]["executionRiskPenaltyJpy"])
        self.assertGreater(thin["scoreBreakdown"]["executionRiskBps"], liquid["scoreBreakdown"]["executionRiskBps"])
        self.assertLess(thin["opportunityScore"], liquid["opportunityScore"])
        self.assertTrue(any("約定コスト見積り" in item for item in thin["whyNotBuy"]))

    def test_intraday_opportunity_exposes_expert_risk_controls(self):
        item = {
            "ticker": "RISK.T",
            "name": "Risk Control Test",
            "price": 83,
            "changePct": 9.2,
            "volumeRatio": 0.7,
            "surgeScore": 91,
            "candidateScore": 88,
            "overheatRisk": 78,
            "momentum5Pct": 8.0,
            "targetPrice": 90,
            "stopLoss": 80,
            "turnoverJpy": 18_000_000,
            "liquidityOk": False,
            "liquidityGrade": "thin",
            "latestBarDate": server.dt.datetime.now(server.JST).date().isoformat(),
            "candidateQuality": {
                "backtest": {
                    "sampleCount": 6,
                    "winRate": 52,
                    "riskAdjustedReturnPct": -0.2,
                    "profitFactor": 0.8,
                }
            },
            "material": {
                "tone": "unconfirmed",
                "materialScore": 0,
                "summary": "重要材料未確認",
                "freshnessVerdict": "unknown",
                "hasRecentImportant": False,
                "recentOfficialDisclosureCount": 0,
            },
            "marketRelative": {
                "available": True,
                "riskOff": True,
                "sectorTailwind": False,
                "sectorHeadwind": True,
                "relativeToMarketPct": -1.5,
                "summary": "市場地合いが弱い",
            },
        }

        opportunity = server._build_intraday_opportunity(item, budget_jpy=500_000)

        self.assertEqual(opportunity["setupQualityGrade"], "D")
        self.assertEqual(opportunity["expertRiskLevel"], "critical")
        self.assertEqual(opportunity["tradeReadiness"], "avoid")
        self.assertEqual(opportunity["positionSizingVerdict"], "skip")
        self.assertEqual(opportunity["shares"], 0)
        self.assertEqual(opportunity["budgetUsedJpy"], 0)
        self.assertEqual(opportunity["recommendedShares"], 0)
        self.assertGreater(opportunity["maxBudgetShares"], 0)
        self.assertEqual(opportunity["scoreBreakdown"]["positionSizeFraction"], 0)
        self.assertTrue(any("建玉サイズ補正" in item for item in opportunity["whyNotBuy"]))
        self.assertTrue(opportunity["expertWarnings"])
        self.assertTrue(any(check["label"] == "流動性" and not check["ok"] for check in opportunity["expertChecklist"]))
        self.assertEqual(opportunity["scoreBreakdown"]["tradeReadiness"], "avoid")

    def test_intraday_opportunity_reduces_size_for_review_candidate(self):
        today = server.dt.datetime.now(server.JST).date().isoformat()
        item = {
            "ticker": "REDUCE.T",
            "name": "Reduced Size Test",
            "price": 1000,
            "changePct": 2.5,
            "volumeRatio": 2.2,
            "surgeScore": 80,
            "candidateScore": 82,
            "overheatRisk": 12,
            "liquidityOk": True,
            "liquidityGrade": "deep",
            "turnoverJpy": 1_600_000_000,
            "targetPrice": 1050,
            "stopLoss": 985,
            "latestBarDate": today,
            "candidateQuality": {
                "backtest": {
                    "sampleCount": 8,
                    "winRate": 64,
                    "riskAdjustedReturnPct": 1.0,
                    "profitFactor": 1.5,
                }
            },
            "material": {
                "tone": "positive",
                "materialScore": 0.9,
                "summary": "official positive",
                "freshnessVerdict": "fresh",
                "hasRecentImportant": True,
                "hasNegative": False,
                "recentOfficialDisclosureCount": 1,
                "officialDisclosureCount": 1,
            },
            "marketRelative": {
                "available": True,
                "riskOff": False,
                "sectorTailwind": False,
                "sectorHeadwind": True,
                "relativeToMarketPct": -0.8,
                "summary": "sector headwind",
            },
        }

        opportunity = server._build_intraday_opportunity(item, budget_jpy=500_000)

        self.assertEqual(opportunity["tradeReadiness"], "review")
        self.assertEqual(opportunity["positionSizingVerdict"], "reduced")
        self.assertGreater(opportunity["maxBudgetShares"], opportunity["shares"])
        self.assertEqual(opportunity["recommendedShares"], opportunity["shares"])
        self.assertGreater(opportunity["maxBudgetUsedJpy"], opportunity["budgetUsedJpy"])
        self.assertEqual(opportunity["scoreBreakdown"]["positionSizeFraction"], 0.25)
        self.assertTrue(any("建玉サイズ補正" in item for item in opportunity["whyNotBuy"]))

    def test_best_intraday_opportunity_prefers_tradeable_candidate_over_avoid(self):
        today = server.dt.datetime.now(server.JST).date().isoformat()
        official_material = {
            "tone": "positive",
            "materialScore": 0.9,
            "summary": "official positive",
            "freshnessVerdict": "fresh",
            "hasRecentImportant": True,
            "hasNegative": False,
            "recentOfficialDisclosureCount": 1,
            "officialDisclosureCount": 1,
        }
        candidate_quality = {
            "backtest": {
                "sampleCount": 8,
                "winRate": 64,
                "riskAdjustedReturnPct": 1.0,
                "profitFactor": 1.5,
            }
        }
        avoid_high_profit = {
            "ticker": "AVOID.T",
            "name": "Avoid High Profit",
            "price": 1000,
            "changePct": 12.0,
            "volumeRatio": 0.6,
            "surgeScore": 99,
            "candidateScore": 94,
            "overheatRisk": 82,
            "liquidityOk": False,
            "liquidityGrade": "thin",
            "turnoverJpy": 18_000_000,
            "targetPrice": 1600,
            "stopLoss": 970,
            "latestBarDate": today,
            "candidateQuality": candidate_quality,
            "material": {"tone": "negative", "materialScore": 0, "freshnessVerdict": "fresh", "hasNegative": True},
        }
        reviewable_lower_profit = {
            "ticker": "READY.T",
            "name": "Ready Lower Profit",
            "price": 1000,
            "changePct": 2.2,
            "volumeRatio": 2.2,
            "surgeScore": 78,
            "candidateScore": 80,
            "overheatRisk": 8,
            "liquidityOk": True,
            "liquidityGrade": "deep",
            "turnoverJpy": 1_500_000_000,
            "targetPrice": 1030,
            "stopLoss": 990,
            "latestBarDate": today,
            "candidateQuality": candidate_quality,
            "material": official_material,
        }

        best = server._best_intraday_opportunity([avoid_high_profit, reviewable_lower_profit], 500_000)

        self.assertEqual(best["ticker"], "READY.T")
        self.assertNotEqual(best["tradeReadiness"], "avoid")

    def test_select_best_ranked_opportunity_ignores_blocked_or_skipped_candidates(self):
        blocked = {
            "ticker": "BLOCK.T",
            "advancedCrossEngineCheck": {"status": "blocked"},
            "intradayOpportunity": {
                "ticker": "BLOCK.T",
                "tradeReadiness": "ready",
                "positionSizingVerdict": "normal",
                "advancedCrossEngineCheck": {"status": "blocked"},
                "shares": 100,
                "budgetUsedJpy": 100000,
                "expectedProfitJpy": 1000,
                "opportunityScore": 1000,
            },
        }
        skipped = {
            "ticker": "SKIP.T",
            "intradayOpportunity": {
                "ticker": "SKIP.T",
                "tradeReadiness": "avoid",
                "positionSizingVerdict": "skip",
                "shares": 0,
                "budgetUsedJpy": 0,
                "expectedProfitJpy": 0,
                "opportunityScore": 0,
            },
        }
        reviewable = {
            "ticker": "REVIEW.T",
            "intradayOpportunity": {
                "ticker": "REVIEW.T",
                "tradeReadiness": "review",
                "positionSizingVerdict": "reduced",
                "advancedCrossEngineCheck": {"status": "review"},
                "decisionAudit": {"verdict": "REVIEW"},
                "shares": 100,
                "budgetUsedJpy": 100000,
                "expectedProfitJpy": 1000,
                "opportunityScore": 1000,
            },
        }

        self.assertIsNone(server._select_best_ranked_opportunity([blocked, skipped, reviewable]))
        fallback = server._select_best_available_opportunity([blocked, skipped])
        self.assertEqual(fallback["ticker"], "BLOCK.T")
        self.assertTrue(fallback["isFallbackCandidate"])
        self.assertEqual(fallback["availabilityMode"], "BEST_AVAILABLE")
        self.assertIn(fallback["simpleAction"], {"待つ", "見送り寄り"})

    def test_select_best_ranked_opportunity_requires_completed_cross_check_when_requested(self):
        unchecked = {
            "ticker": "UNCHECKED.T",
            "intradayOpportunity": {
                "ticker": "UNCHECKED.T",
                "tradeReadiness": "ready",
                "positionSizingVerdict": "normal",
                "decisionAudit": {"verdict": "PASS"},
                "shares": 100,
                "budgetUsedJpy": 100000,
                "expectedProfitJpy": 1000,
                "opportunityScore": 1000,
            },
        }
        pending = {
            "ticker": "PENDING.T",
            "advancedCrossEngineCheck": {"status": "pending"},
            "intradayOpportunity": {
                "ticker": "PENDING.T",
                "tradeReadiness": "ready",
                "positionSizingVerdict": "normal",
                "advancedCrossEngineCheck": {"status": "pending"},
                "decisionAudit": {"verdict": "PASS"},
                "shares": 100,
                "budgetUsedJpy": 100000,
                "expectedProfitJpy": 1000,
                "opportunityScore": 1000,
            },
        }
        reviewable = {
            "ticker": "REVIEW.T",
            "advancedCrossEngineCheck": {"status": "review"},
            "intradayOpportunity": {
                "ticker": "REVIEW.T",
                "tradeReadiness": "review",
                "positionSizingVerdict": "reduced",
                "advancedCrossEngineCheck": {"status": "review"},
                "decisionAudit": {"verdict": "REVIEW"},
                "shares": 100,
                "budgetUsedJpy": 100000,
                "expectedProfitJpy": 1000,
                "opportunityScore": 1000,
            },
        }

        self.assertEqual(server._select_best_ranked_opportunity([unchecked, pending, reviewable])["ticker"], "UNCHECKED.T")
        strict_best = server._select_best_ranked_opportunity(
            [unchecked, pending, reviewable],
            require_cross_engine_check=True,
        )
        self.assertIsNone(strict_best)
        self.assertIsNone(server._select_best_ranked_opportunity([unchecked, pending], require_cross_engine_check=True))

    def test_select_best_ranked_opportunity_rejects_zero_share_candidate(self):
        zero_share = {
            "ticker": "ZERO.T",
            "advancedCrossEngineCheck": {"status": "review"},
            "intradayOpportunity": {
                "ticker": "ZERO.T",
                "tradeReadiness": "review",
                "positionSizingVerdict": "reduced",
                "advancedCrossEngineCheck": {"status": "review"},
                "shares": 0,
                "budgetUsedJpy": 0,
                "expectedProfitJpy": 500,
                "opportunityScore": 100,
            },
        }
        valid = {
            "ticker": "VALID.T",
            "advancedCrossEngineCheck": {"status": "review"},
            "intradayOpportunity": {
                "ticker": "VALID.T",
                "tradeReadiness": "ready",
                "positionSizingVerdict": "normal",
                "advancedCrossEngineCheck": {"status": "aligned"},
                "decisionAudit": {"verdict": "PASS"},
                "shares": 100,
                "budgetUsedJpy": 100000,
                "expectedProfitJpy": 500,
                "opportunityScore": 100,
            },
        }

        self.assertEqual(server._select_best_ranked_opportunity([zero_share, valid], require_cross_engine_check=True)["ticker"], "VALID.T")
        self.assertIsNone(server._select_best_ranked_opportunity([zero_share], require_cross_engine_check=True))

    def test_best_available_opportunity_prefers_expected_profit_when_strict_best_is_empty(self):
        low = {
            "ticker": "LOW.T",
            "intradayOpportunity": {
                "ticker": "LOW.T",
                "tradeReadiness": "review",
                "positionSizingVerdict": "reduced",
                "advancedCrossEngineCheck": {"status": "blocked"},
                "shares": 100,
                "budgetUsedJpy": 100000,
                "expectedProfitJpy": 300,
                "opportunityScore": 300,
                "confidencePct": 58,
            },
        }
        high = {
            "ticker": "HIGH.T",
            "intradayOpportunity": {
                "ticker": "HIGH.T",
                "tradeReadiness": "review",
                "positionSizingVerdict": "reduced",
                "advancedCrossEngineCheck": {"status": "blocked"},
                "shares": 100,
                "budgetUsedJpy": 100000,
                "expectedProfitJpy": 900,
                "opportunityScore": 900,
                "confidencePct": 62,
            },
        }

        fallback = server._select_best_available_opportunity([low, high])

        self.assertEqual(fallback["ticker"], "HIGH.T")
        self.assertEqual(fallback["displayDecision"], "WATCH_ONLY")
        self.assertTrue(fallback["isFallbackCandidate"])

    def test_intraday_opportunity_public_reason_text_is_readable_japanese(self):
        item = {
            "ticker": "TEXT.T",
            "name": "Text Test",
            "price": 1000,
            "changePct": 4.5,
            "volumeRatio": 2.8,
            "surgeScore": 92,
            "candidateScore": 86,
            "overheatRisk": 18,
            "liquidityOk": True,
            "liquidityGrade": "tradable",
            "volumeConfirmed": True,
            "turnoverJpy": 400_000_000,
            "momentum5Pct": 5.5,
            "momentum20Pct": 7.2,
            "targetPrice": 1060,
            "stopLoss": 985,
            "latestBarDate": server.dt.datetime.now(server.JST).date().isoformat(),
            "candidateQuality": {
                "backtest": {
                    "sampleCount": 6,
                    "riskAdjustedReturnPct": 1.4,
                    "profitFactor": 1.3,
                    "winRate": 61,
                }
            },
            "material": {
                "tone": "positive",
                "materialScore": 72,
                "latestAgeDays": 1,
                "freshnessVerdict": "fresh",
                "hasRecentImportant": True,
                "hasNegative": False,
                "recentOfficialDisclosureCount": 1,
                "summary": "決算修正と出来高増加を確認。",
                "sources": ["TDnet"],
            },
            "marketRelative": {
                "available": True,
                "riskOff": False,
                "sectorTailwind": True,
                "sectorHeadwind": False,
                "relativeToMarketPct": 2.0,
                "summary": "市場比で強い値動き。",
                "tone": "risk_on",
            },
        }
        opportunity = server._build_intraday_opportunity(item, 1_000_000)
        visible_text = " ".join(
            [
                opportunity["reason"],
                *(opportunity["whyBuy"] or []),
                *(opportunity["whyNotBuy"] or []),
                *(opportunity["invalidConditions"] or []),
                opportunity["decisionAudit"]["label"],
                *[
                    f"{gate['label']} {gate['detail']}"
                    for gate in opportunity["decisionAudit"]["gates"]
                ],
                opportunity["disclaimer"],
            ]
        )
        mojibake_fragments = tuple(chr(code) for code in (0x7e3a, 0x7e1d, 0x8b41, 0x8700, 0x8373, 0x87a2, 0x8c6c, 0x8413, 0x8b5a, 0x87f6, 0x9695, 0x9082, 0x9b2f, 0x9677, 0x9aea, 0x8b4c, 0x00e3, 0x00e6)) + ("????",)
        self.assertFalse(any(fragment in visible_text for fragment in mojibake_fragments))
        self.assertIn("条件一致スコア", visible_text)
        self.assertIn("リスク・リワード", visible_text)

    def test_public_backend_labels_do_not_contain_mojibake_fragments(self):
        profile = server._surge_profile(
            price=1000,
            closes=[900 + index for index in range(90)],
            volume=300000,
            avg_vol20=180000,
            turnover=300000000,
            change_pct=4.2,
            momentum5=3.5,
            momentum20=8.0,
            rsi=64,
        )
        payload = {
            "marketStatus": server.tokyo_market_status(server.dt.datetime(2026, 6, 6, 10, tzinfo=server.JST)),
            "fallbackPool": server.FALLBACK_CANDIDATE_POOL,
            "externalLinks": server.external_research_links("7203.T", "Toyota"),
            "surgeProfile": profile,
            "exitPlan": server.build_exit_plan(
                ticker="TEXT.T",
                shares=100,
                avg_cost=1000,
                hist=None,
                market_context={"tone": "NORMAL", "summary": "", "riskOff": False},
            ),
            "executionPlan": server.TechnicalAnalyzer.analyze([100 + index for index in range(80)], 190),
        }

        def collect_strings(value):
            if isinstance(value, str):
                return [value]
            if isinstance(value, dict):
                found = []
                for item in value.values():
                    found.extend(collect_strings(item))
                return found
            if isinstance(value, list):
                found = []
                for item in value:
                    found.extend(collect_strings(item))
                return found
            return []

        visible_text = " ".join(collect_strings(payload))
        mojibake_fragments = tuple(chr(code) for code in (0x7e3a, 0x7e1d, 0x8b41, 0x8700, 0x8373, 0x87a2, 0x8c6c, 0x8413, 0x8b5a, 0x87f6, 0x9695, 0x9082, 0x9b2f, 0x9677, 0x9aea, 0x8b4c, 0x00e3, 0x00e6)) + ("????",)

        self.assertFalse(any(fragment in visible_text for fragment in mojibake_fragments))
        for english_fragment in (
            "Risk exit",
            "Scale out",
            "Take profit",
            "Trailing stop hit",
            "Simulator-only exit plan",
            "No decisive technical signal",
            "20-day momentum",
            "Profit/loss",
            "Market closed",
            "Tokyo market is closed",
            "manual verification",
        ):
            self.assertNotIn(english_fragment, visible_text)
        self.assertIn("三菱電機", visible_text)
        self.assertIn("TDnet無料RSS", visible_text)
        self.assertIn("20日高値更新", visible_text)
        self.assertIn("保有継続", visible_text)
        self.assertIn("短期トレンド", visible_text)

    def test_http_text_decoder_preserves_shift_jis_japanese(self):
        class ShiftJisResponse:
            content = "日本株 値上がり率".encode("cp932")
            encoding = "ISO-8859-1"
            apparent_encoding = "SHIFT_JIS"

        decoded = server._decode_http_text(ShiftJisResponse())

        self.assertEqual(decoded, "日本株 値上がり率")
        self.assertNotIn("\ufffd", decoded)

    def test_intraday_opportunity_caps_stale_or_unconfirmed_material(self):
        base = {
            "ticker": "MATL.T",
            "name": "Material Test",
            "price": 1000,
            "changePct": 3.0,
            "volumeRatio": 2.5,
            "surgeScore": 90,
            "candidateScore": 88,
            "overheatRisk": 5,
            "liquidityOk": True,
            "momentum5Pct": 6.0,
            "targetPrice": 1060,
            "stopLoss": 985,
            "latestBarDate": server.dt.datetime.now(server.JST).date().isoformat(),
        }

        official_fresh = server._build_intraday_opportunity({
            **base,
            "material": {
                "tone": "positive",
                "materialScore": 0.9,
                "summary": "上方修正を発表",
                "freshnessVerdict": "fresh",
                "hasRecentImportant": True,
                "recentOfficialDisclosureCount": 1,
            },
        }, budget_jpy=500_000)
        stale_news = server._build_intraday_opportunity({
            **base,
            "material": {
                "tone": "positive",
                "materialScore": 0.9,
                "summary": "古い上方修正記事",
                "freshnessVerdict": "stale",
                "latestAgeDays": 30,
                "hasRecentImportant": False,
                "recentOfficialDisclosureCount": 0,
            },
        }, budget_jpy=500_000)
        unconfirmed = server._build_intraday_opportunity({
            **base,
            "material": {"tone": "unconfirmed", "summary": "未確認"},
        }, budget_jpy=500_000)

        self.assertGreater(official_fresh["confidencePct"], stale_news["confidencePct"])
        self.assertLessEqual(stale_news["confidencePct"], 84)
        self.assertLessEqual(unconfirmed["confidencePct"], 86)
        self.assertTrue(any("材料が古く" in item for item in stale_news["whyNotBuy"]))
        self.assertTrue(any("公式開示" in item for item in stale_news["whyNotBuy"]))

    def test_intraday_opportunity_penalizes_stale_daily_price_data(self):
        today = server.dt.datetime.now(server.JST).date()
        base = {
            "ticker": "7203.T",
            "name": "Toyota",
            "price": 2500,
            "changePct": 2.0,
            "volumeRatio": 2.0,
            "surgeScore": 80,
            "candidateScore": 80,
            "overheatRisk": 10,
            "liquidityOk": True,
            "momentum5Pct": 4.0,
            "targetPrice": 2625,
            "stopLoss": 2440,
            "material": {"tone": "positive", "summary": "confirmed catalyst"},
        }

        fresh = server._build_intraday_opportunity({
            **base,
            "latestBarDate": today.isoformat(),
        }, budget_jpy=500_000)
        stale = server._build_intraday_opportunity({
            **base,
            "latestBarDate": (today - server.dt.timedelta(days=10)).isoformat(),
        }, budget_jpy=500_000)

        self.assertGreater(fresh["confidencePct"], stale["confidencePct"])
        self.assertGreater(fresh["opportunityScore"], stale["opportunityScore"])
        self.assertTrue(fresh["dataFreshness"]["priceOk"])
        self.assertFalse(stale["dataFreshness"]["priceOk"])
        self.assertTrue(any("日足価格データが古い" in item for item in stale["whyNotBuy"]))

    def test_history_context_uses_jst_latest_bar_age_helper(self):
        frame = pd.DataFrame(
            {
                "Open": [100, 101, 102],
                "High": [102, 103, 104],
                "Low": [99, 100, 101],
                "Close": [101, 102, 103],
                "Volume": [100000, 110000, 120000],
            },
            index=pd.date_range("2026-06-01", periods=3, freq="B"),
        )
        latest_label = frame.index[-1].date().isoformat()
        original_latest_bar_age_days = server._latest_bar_age_days
        try:
            server._latest_bar_age_days = lambda value: 4 if value == latest_label else 99
            context = server.build_history_context(frame)
        finally:
            server._latest_bar_age_days = original_latest_bar_age_days

        self.assertEqual(context["latestBarDate"], latest_label)
        self.assertEqual(context["latestBarAgeDays"], 4)
        self.assertTrue(context["freshness"]["priceOk"])

    def test_intraday_opportunity_uses_pattern_backtest_expectancy(self):
        base_item = {
            "ticker": "BTST.T",
            "name": "Backtested",
            "price": 1000,
            "targetPrice": 1040,
            "stopLoss": 985,
            "surgeScore": 65,
            "candidateScore": 68,
            "volumeRatio": 1.8,
            "momentum5Pct": 4,
            "changePct": 2,
            "overheatRisk": 12,
            "liquidityOk": True,
            "material": {"tone": "important", "summary": "unit"},
            "latestBarDate": server.dt.datetime.now(server.JST).date().isoformat(),
        }
        strong = server._build_intraday_opportunity(
            {
                **base_item,
                "candidateQuality": {
                    "backtest": {
                        "sampleCount": 8,
                        "winRate": 62,
                        "riskAdjustedReturnPct": 0.9,
                        "profitFactor": 1.8,
                    }
                },
            },
            500_000,
        )
        weak = server._build_intraday_opportunity(
            {
                **base_item,
                "candidateQuality": {
                    "backtest": {
                        "sampleCount": 8,
                        "winRate": 42,
                        "riskAdjustedReturnPct": -0.7,
                        "profitFactor": 0.7,
                    }
                },
            },
            500_000,
        )

        self.assertGreater(strong["confidencePct"], weak["confidencePct"])
        self.assertLessEqual(weak["confidencePct"], 88.0)
        self.assertGreater(strong["opportunityScore"], weak["opportunityScore"])
        self.assertTrue(any("類似翌日検証" in reason for reason in strong["whyBuy"]))
        self.assertIn("類似パターンの翌日期待値が弱い", weak["whyNotBuy"])

    def test_intraday_opportunity_penalizes_weak_market_relative_context(self):
        base_item = {
            "ticker": "SECT.T",
            "name": "Sector Test",
            "price": 1000,
            "targetPrice": 1040,
            "stopLoss": 985,
            "surgeScore": 72,
            "candidateScore": 74,
            "volumeRatio": 2.1,
            "momentum5Pct": 5,
            "changePct": 2.5,
            "overheatRisk": 10,
            "liquidityOk": True,
            "material": {"tone": "important", "summary": "unit"},
            "latestBarDate": server.dt.datetime.now(server.JST).date().isoformat(),
        }
        tailwind = server._build_intraday_opportunity(
            {
                **base_item,
                "marketRelative": {
                    "available": True,
                    "riskOff": False,
                    "sectorTailwind": True,
                    "sectorHeadwind": False,
                    "relativeToMarketPct": 1.5,
                    "summary": "市場平均 +0.40% / 上昇比率 60.0% / sector平均 +1.20%",
                },
            },
            500_000,
        )
        headwind = server._build_intraday_opportunity(
            {
                **base_item,
                "marketRelative": {
                    "available": True,
                    "riskOff": True,
                    "sectorTailwind": False,
                    "sectorHeadwind": True,
                    "relativeToMarketPct": -0.5,
                    "summary": "市場平均 -1.10% / 上昇比率 25.0% / sector平均 -1.70%",
                },
            },
            500_000,
        )

        self.assertGreater(tailwind["confidencePct"], headwind["confidencePct"])
        self.assertLessEqual(headwind["confidencePct"], 88)
        self.assertTrue(any("市場地合いが弱い" in item for item in headwind["whyNotBuy"]))

    def test_market_rankings_attaches_relative_market_context(self):
        original_load_snapshot = server._load_market_snapshot
        original_market_status = server.tokyo_market_status
        original_material = server._attach_material_events
        original_quality = server.quality_for_ticker
        today = server.dt.datetime.now(server.JST).date().isoformat()
        try:
            server.tokyo_market_status = lambda: {"isOpen": True, "phase": "REGULAR_SESSION", "label": "取引中", "message": "open"}
            server._attach_material_events = lambda items: items
            server.quality_for_ticker = lambda ticker: None
            server._load_market_snapshot = lambda: {
                "source": "unit-test",
                "provider": "unit-test-provider",
                "universeCount": 4,
                "analyzedCount": 4,
                "items": [
                    {"ticker": "A.T", "sector": "Tech", "changePct": 3.0, "price": 1000, "volume": 200000, "turnoverJpy": 200000000},
                    {"ticker": "B.T", "sector": "Tech", "changePct": 1.0, "price": 1000, "volume": 200000, "turnoverJpy": 200000000},
                    {"ticker": "C.T", "sector": "Retail", "changePct": -1.5, "price": 1000, "volume": 200000, "turnoverJpy": 200000000},
                    {"ticker": "D.T", "sector": "Retail", "changePct": -2.0, "price": 1000, "volume": 200000, "turnoverJpy": 200000000},
                ],
                "rankings": {
                    "surge": [
                        {
                            "ticker": "A.T",
                            "name": "Alpha",
                            "sector": "Tech",
                            "price": 1000,
                            "changePct": 3.0,
                            "volume": 200000,
                            "turnoverJpy": 200000000,
                            "volumeRatio": 2,
                            "surgeScore": 80,
                            "candidateScore": 70,
                            "overheatRisk": 8,
                            "liquidityOk": True,
                            "targetPrice": 1040,
                            "stopLoss": 985,
                        }
                    ]
                },
            }

            payload = server.market_rankings(kind="surge", limit=1, budget=500_000)
        finally:
            server._load_market_snapshot = original_load_snapshot
            server.tokyo_market_status = original_market_status
            server._attach_material_events = original_material
            server.quality_for_ticker = original_quality

        context = payload["items"][0]["marketRelative"]
        self.assertTrue(context["available"])
        self.assertEqual(context["sector"], "Tech")
        self.assertGreater(context["relativeToMarketPct"], 0)
        self.assertIn("marketRelative", payload["items"][0]["intradayOpportunity"])

    def test_material_events_combines_tdnet_and_news(self):
        pubdate = server.email.utils.format_datetime(
            server.dt.datetime.now(server.dt.timezone(server.dt.timedelta(hours=9)))
        )
        publish_ts = int(server.dt.datetime.now().timestamp())

        class Response:
            content = f"""<?xml version='1.0' encoding='UTF-8'?>
            <rss><channel><item>
              <title>テスト社（証券コード4980）:2026年３月期決算短信</title>
              <link>https://example.test/tdnet.pdf</link>
              <pubDate>{pubdate}</pubDate>
            </item></channel></rss>""".encode("utf-8")

            def raise_for_status(self):
                return None

        class Ticker:
            news = [{
                "title": "テスト社が上方修正を発表",
                "publisher": "Test News",
                "link": "https://example.test/news",
                "providerPublishTime": publish_ts,
            }]

        original_get = server.requests.get
        original_ticker = server.yf.Ticker
        try:
            server.requests.get = lambda *args, **kwargs: Response()
            server.yf.Ticker = lambda ticker: Ticker()
            material = server.material_events_for_ticker("4980.T", "テスト社")
        finally:
            server.requests.get = original_get
            server.yf.Ticker = original_ticker

        self.assertTrue(material["available"])
        self.assertIn(material["tone"], {"positive", "important"})
        self.assertGreaterEqual(len(material["items"]), 2)
        self.assertEqual(material["freshnessVerdict"], "fresh")
        self.assertGreaterEqual(material["recentImportantCount"], 1)
        self.assertGreaterEqual(material["officialDisclosureCount"], 1)
        self.assertIn("有料APIは使用しません", material["officialNote"])

    def test_material_datetime_normalizes_timezone_for_age_checks(self):
        parsed = server._parse_material_datetime("2026-05-24T08:01:00+00:00")

        self.assertEqual(parsed, "2026-05-24T17:01")
        self.assertIsInstance(server._material_age_days(parsed), int)

    def test_statement_material_item_uses_readable_japanese_title(self):
        item = server._statement_material_item({
            "disclosedDate": "2026-06-02",
            "type": "",
            "earningsPerShare": "123.45",
            "forecastDividendPerShareAnnual": "56.00",
        })

        self.assertIsNotNone(item)
        self.assertEqual(item["kind"], "earnings")
        self.assertIn("J-Quants財務", item["title"])
        self.assertIn("財務開示", item["title"])
        self.assertIn("年間配当予想", item["title"])

    def test_tdnet_items_prefer_free_code_specific_rss(self):
        pubdate = server.email.utils.format_datetime(
            server.dt.datetime.now(server.dt.timezone(server.dt.timedelta(hours=9)))
        )

        class Response:
            content = f"""<?xml version='1.0' encoding='UTF-8'?>
            <rss><channel><item>
              <title>決算短信を開示</title>
              <link>https://example.test/tdnet-code.pdf</link>
              <pubDate>{pubdate}</pubDate>
            </item></channel></rss>""".encode("utf-8")

            def raise_for_status(self):
                return None

        called_urls = []
        original_get = server.requests.get
        try:
            def fake_get(url, *args, **kwargs):
                called_urls.append(url)
                return Response()

            server.requests.get = fake_get
            items = server._tdnet_recent_items("4980.T", "Dexerials")
        finally:
            server.requests.get = original_get

        self.assertEqual(len(items), 1)
        self.assertIn("/4980.rss", called_urls[0])
        self.assertEqual(items[0]["source"], "TDnet無料RSS")

    def test_history_from_stooq_uses_free_api_key_when_configured(self):
        class Response:
            text = "Date,Open,High,Low,Close,Volume\n2026-05-21,100,110,95,108,120000\n2026-05-22,108,112,105,111,130000\n"

            def raise_for_status(self):
                return None

        original_key = server.STOOQ_API_KEY
        original_get = server.requests.get
        try:
            server.STOOQ_API_KEY = "free-test-key"
            captured = {}

            def fake_get(url, *args, **kwargs):
                captured["url"] = url
                captured["params"] = kwargs.get("params")
                return Response()

            server.requests.get = fake_get
            frame = server._history_from_stooq("7203.T")
        finally:
            server.STOOQ_API_KEY = original_key
            server.requests.get = original_get

        self.assertIsNotNone(frame)
        self.assertEqual(frame["Close"].iloc[-1], 111)
        self.assertEqual(frame.attrs["source"], "stooq_free_api")
        self.assertEqual(captured["params"]["s"], "7203.jp")
        self.assertEqual(captured["params"]["apikey"], "free-test-key")

    def test_external_research_links_are_free_manual_confirmation_sources(self):
        labels = [item["label"] for item in server.external_research_links("7203.T", "Toyota")]

        self.assertIn("Yahoo Finance Japan", labels)
        self.assertIn("TDnet無料RSS", labels)
        self.assertIn("EDINET検索", labels)

    def test_market_rankings_returns_best_intraday_opportunity_by_risk_adjusted_expectancy(self):
        original_load_snapshot = server._load_market_snapshot
        original_market_status = server.tokyo_market_status
        original_quality = server.quality_for_ticker
        original_material = server._attach_material_events
        today = server.dt.datetime.now(server.JST).date().isoformat()
        try:
            server.tokyo_market_status = lambda: {"isOpen": True, "phase": "REGULAR_SESSION", "label": "取引中", "message": "open"}
            server.quality_for_ticker = lambda ticker: {
                "qualityScore": 82,
                "metrics": {},
                "backtest": {
                    "sampleCount": 8,
                    "winRate": 64,
                    "riskAdjustedReturnPct": 1.0,
                    "profitFactor": 1.5,
                },
                "gates": [],
                "warnings": [],
            }
            server._attach_material_events = lambda items: [
                {
                    **item,
                    "material": {
                        "tone": "positive" if item["ticker"] == "WIN1.T" else "negative",
                        "materialScore": 0.9 if item["ticker"] == "WIN1.T" else 0,
                        "summary": "unit",
                        "freshnessVerdict": "fresh",
                        "hasRecentImportant": True,
                        "hasNegative": item["ticker"] != "WIN1.T",
                        "recentOfficialDisclosureCount": 1,
                        "officialDisclosureCount": 1,
                    },
                }
                for item in items
            ]
            server._load_market_snapshot = lambda: {
                "generatedAt": "2026-05-23T00:00:00+00:00",
                "source": "unit-test",
                "provider": "unit-test-provider",
                "universeCount": 2,
                "analyzedCount": 2,
                "rankings": {
                    "surge": [
                        {
                            "rank": 1,
                            "ticker": "LOW1.T",
                            "name": "Low Probability",
                            "price": 1000,
                            "changePct": 7.8,
                            "volumeRatio": 0.6,
                            "surgeScore": 58,
                            "candidateScore": 45,
                            "overheatRisk": 76,
                            "liquidityOk": False,
                            "momentum5Pct": 1,
                            "targetPrice": 1160,
                            "stopLoss": 960,
                            "latestBarDate": today,
                        },
                        {
                            "rank": 2,
                            "ticker": "WIN1.T",
                            "name": "High Probability",
                            "price": 2500,
                            "changePct": 2.2,
                            "volumeRatio": 2.8,
                            "surgeScore": 84,
                            "candidateScore": 82,
                            "overheatRisk": 8,
                            "liquidityOk": True,
                            "liquidityGrade": "deep",
                            "momentum5Pct": 5.5,
                            "targetPrice": 2625,
                            "stopLoss": 2440,
                            "latestBarDate": today,
                        },
                    ]
                },
            }

            payload = server.market_rankings(kind="surge", limit=2, budget=500_000)
        finally:
            server._load_market_snapshot = original_load_snapshot
            server.tokyo_market_status = original_market_status
            server.quality_for_ticker = original_quality
            server._attach_material_events = original_material

        self.assertEqual(payload["budgetJpy"], 500_000)
        self.assertTrue(payload["marketStatus"]["isOpen"])
        self.assertEqual(payload["bestOpportunity"]["ticker"], "WIN1.T")
        self.assertEqual(payload["bestOpportunity"]["shares"], 200)
        low_item = next(item for item in payload["items"] if item["ticker"] == "LOW1.T")
        self.assertGreater(
            payload["bestOpportunity"]["opportunityScore"],
            low_item["intradayOpportunity"]["opportunityScore"],
        )

    def test_market_rankings_reranks_visible_items_by_audited_opportunity(self):
        original_load_snapshot = server._load_market_snapshot
        original_market_status = server.tokyo_market_status
        original_material = server._attach_material_events
        original_quality = server.quality_for_ticker
        today = server.dt.datetime.now(server.JST).date().isoformat()
        try:
            server.tokyo_market_status = lambda: {"isOpen": True, "phase": "REGULAR_SESSION", "label": "取引中", "message": "open"}
            server._attach_material_events = lambda items: [
                {
                    **item,
                    "material": {
                        "tone": "positive" if item["ticker"] == "PASS.T" else "negative",
                        "materialScore": 0.9 if item["ticker"] == "PASS.T" else 0,
                        "summary": "unit",
                        "freshnessVerdict": "fresh",
                        "hasRecentImportant": True,
                        "hasNegative": item["ticker"] != "PASS.T",
                        "recentOfficialDisclosureCount": 1,
                    },
                }
                for item in items
            ]
            server.quality_for_ticker = lambda ticker: {
                "qualityScore": 80,
                "metrics": {},
                "qualityReliability": {"grade": "strong"},
                "dataQuality": {
                    "score": 90,
                    "source": "yfinance",
                    "sourceOk": True,
                    "priceOk": True,
                    "historyDepthOk": True,
                    "latestBarDate": today,
                    "latestBarAgeDays": 0,
                },
                "backtest": {
                    "sampleCount": 8,
                    "winRate": 64,
                    "riskAdjustedReturnPct": 1.0,
                    "profitFactor": 1.5,
                },
                "gates": [],
                "warnings": [],
            }
            server._load_market_snapshot = lambda: {
                "source": "unit-test",
                "provider": "unit-test-provider",
                "universeCount": 3,
                "analyzedCount": 3,
                "items": [
                    {"ticker": "BAD.T", "sector": "Tech", "changePct": 8.0, "price": 1000, "volume": 200000, "turnoverJpy": 200000000, "latestBarDate": today},
                    {"ticker": "PASS.T", "sector": "Tech", "changePct": 2.5, "price": 1000, "volume": 200000, "turnoverJpy": 200000000, "latestBarDate": today},
                    {"ticker": "MID.T", "sector": "Tech", "changePct": 1.0, "price": 1000, "volume": 200000, "turnoverJpy": 200000000, "latestBarDate": today},
                ],
                "rankings": {
                    "surge": [
                        {
                            "ticker": "BAD.T",
                            "name": "Bad",
                            "sector": "Tech",
                            "price": 1000,
                            "changePct": 8.0,
                            "volume": 200000,
                            "turnoverJpy": 200000000,
                            "volumeRatio": 2,
                            "surgeScore": 99,
                            "candidateScore": 90,
                            "overheatRisk": 5,
                            "liquidityOk": True,
                            "liquidityGrade": "deep",
                            "targetPrice": 1060,
                            "stopLoss": 985,
                            "latestBarDate": today,
                        },
                        {
                            "ticker": "PASS.T",
                            "name": "Pass",
                            "sector": "Tech",
                            "price": 1000,
                            "changePct": 2.5,
                            "volume": 200000,
                            "turnoverJpy": 200000000,
                            "volumeRatio": 2,
                            "surgeScore": 75,
                            "candidateScore": 80,
                            "overheatRisk": 5,
                            "liquidityOk": True,
                            "liquidityGrade": "deep",
                            "targetPrice": 1060,
                            "stopLoss": 985,
                            "latestBarDate": today,
                        },
                    ]
                },
            }

            payload = server.market_rankings(kind="surge", limit=2, budget=500_000)
        finally:
            server._load_market_snapshot = original_load_snapshot
            server.tokyo_market_status = original_market_status
            server._attach_material_events = original_material
            server.quality_for_ticker = original_quality

        self.assertEqual(payload["items"][0]["ticker"], "PASS.T")
        self.assertEqual(payload["items"][0]["candidateRank"], 1)
        self.assertEqual(payload["bestOpportunity"]["ticker"], "PASS.T")
        self.assertEqual(payload["items"][1]["intradayOpportunity"]["decisionAudit"]["verdict"], "REJECT")

    def test_market_rankings_demotes_top_candidate_blocked_by_advanced_cross_check(self):
        original_load_snapshot = server._load_market_snapshot
        original_market_status = server.tokyo_market_status
        original_material = server._attach_material_events
        original_quality = server.quality_for_ticker
        original_universe = server.load_market_universe
        original_get_stock_data = server.get_stock_data
        original_build_advanced_report = server.build_advanced_report
        today = server.dt.datetime.now(server.JST).date()
        closes = [1000 + index * 2 for index in range(90)]
        frame = pd.DataFrame(
            {
                "Open": [value * 0.995 for value in closes],
                "High": [value * 1.02 for value in closes],
                "Low": [value * 0.985 for value in closes],
                "Close": closes,
                "Volume": [900_000 + index * 500 for index in range(90)],
            },
            index=fresh_business_index(len(closes)),
        )
        frame.attrs["source"] = "yfinance"
        frame.attrs["synthetic"] = False
        data_quality = {
            "score": 92,
            "source": "yfinance",
            "sourceOk": True,
            "priceOk": True,
            "historyDepthOk": True,
            "latestBarDate": today.isoformat(),
            "latestBarAgeDays": 0,
        }

        def quality(_ticker):
            return {
                "qualityScore": 86,
                "metrics": {},
                "dataQuality": data_quality,
                "qualityReliability": {"grade": "strong"},
                "backtest": {
                    "sampleCount": 8,
                    "winRate": 64,
                    "riskAdjustedReturnPct": 1.2,
                    "profitFactor": 1.5,
                },
                "gates": [],
                "warnings": [],
            }

        def advanced_report(ticker, *_args, **_kwargs):
            verdict = "DEFENSIVE" if ticker == "BLOCK.T" else "ADVANCED_READY"
            return {
                "ticker": ticker,
                "verdict": verdict,
                "actionLabel": verdict,
                "compositeScore": 42 if verdict == "DEFENSIVE" else 82,
                "analysisReliability": {"grade": "strong", "label": "strong"},
                "dataQuality": data_quality,
                "guardrails": [
                    {"id": "trend", "ok": verdict == "ADVANCED_READY"},
                    {"id": "liquidity", "ok": True},
                ],
            }

        try:
            server.tokyo_market_status = lambda: {"isOpen": True, "phase": "REGULAR_SESSION", "label": "open", "message": "open"}
            server.load_market_universe = lambda: {
                "BLOCK.T": {"name": "Blocked", "sector": "Tech", "market_section": "Prime"},
                "PASS.T": {"name": "Passed", "sector": "Tech", "market_section": "Prime"},
            }
            server.get_stock_data = lambda *_args, **_kwargs: frame
            server.build_advanced_report = advanced_report
            server.quality_for_ticker = quality
            server._attach_material_events = lambda items: [
                {
                    **item,
                    "material": {
                        "tone": "positive",
                        "materialScore": 1.0,
                        "summary": "official",
                        "freshnessVerdict": "fresh",
                        "hasRecentImportant": True,
                        "hasNegative": False,
                        "recentOfficialDisclosureCount": 1,
                        "officialDisclosureCount": 1,
                    },
                }
                for item in items
            ]
            server._load_market_snapshot = lambda: {
                "source": "unit-test",
                "provider": "unit-test-provider",
                "universeCount": 2,
                "analyzedCount": 2,
                "items": [
                    {"ticker": "BLOCK.T", "sector": "Tech", "changePct": 6.0, "price": 1000, "volume": 900000, "turnoverJpy": 900000000},
                    {"ticker": "PASS.T", "sector": "Tech", "changePct": 3.0, "price": 1000, "volume": 900000, "turnoverJpy": 900000000},
                ],
                "rankings": {
                    "surge": [
                        {
                            "rank": 1,
                            "ticker": "BLOCK.T",
                            "name": "Blocked",
                            "sector": "Tech",
                            "price": 1000,
                            "changePct": 6.0,
                            "volume": 900000,
                            "turnoverJpy": 900000000,
                            "volumeRatio": 3,
                            "surgeScore": 98,
                            "candidateScore": 92,
                            "overheatRisk": 8,
                            "liquidityOk": True,
                            "liquidityGrade": "deep",
                            "targetPrice": 1080,
                            "stopLoss": 980,
                            "latestBarDate": today.isoformat(),
                        },
                        {
                            "rank": 2,
                            "ticker": "PASS.T",
                            "name": "Passed",
                            "sector": "Tech",
                            "price": 1000,
                            "changePct": 3.0,
                            "volume": 900000,
                            "turnoverJpy": 900000000,
                            "volumeRatio": 2,
                            "surgeScore": 82,
                            "candidateScore": 86,
                            "overheatRisk": 10,
                            "liquidityOk": True,
                            "liquidityGrade": "deep",
                            "targetPrice": 1060,
                            "stopLoss": 985,
                            "latestBarDate": today.isoformat(),
                        },
                    ]
                },
            }

            payload = server.market_rankings(kind="surge", limit=2, budget=500_000)
        finally:
            server._load_market_snapshot = original_load_snapshot
            server.tokyo_market_status = original_market_status
            server._attach_material_events = original_material
            server.quality_for_ticker = original_quality
            server.load_market_universe = original_universe
            server.get_stock_data = original_get_stock_data
            server.build_advanced_report = original_build_advanced_report

        blocked_item = next(item for item in payload["items"] if item["ticker"] == "BLOCK.T")
        self.assertEqual(payload["bestOpportunity"]["ticker"], "PASS.T")
        self.assertEqual(blocked_item["advancedCrossEngineCheck"]["status"], "blocked")
        self.assertEqual(blocked_item["intradayOpportunity"]["tradeReadiness"], "avoid")
        self.assertEqual(blocked_item["intradayOpportunity"]["positionSizingVerdict"], "skip")
        self.assertEqual(blocked_item["intradayOpportunity"]["shares"], 0)

    def test_market_rankings_returns_null_best_opportunity_when_all_visible_candidates_fail_cross_engine_check(self):
        original_load_snapshot = server._load_market_snapshot
        original_market_status = server.tokyo_market_status
        original_material = server._attach_material_events
        original_quality = server.quality_for_ticker
        original_universe = server.load_market_universe
        original_get_stock_data = server.get_stock_data
        original_build_advanced_report = server.build_advanced_report
        today = server.dt.datetime.now(server.JST).date()
        closes = [1000 + index for index in range(90)]
        frame = pd.DataFrame(
            {
                "Open": [value * 0.995 for value in closes],
                "High": [value * 1.02 for value in closes],
                "Low": [value * 0.985 for value in closes],
                "Close": closes,
                "Volume": [900_000 for _ in closes],
            },
            index=fresh_business_index(len(closes)),
        )
        frame.attrs["source"] = "yfinance"
        frame.attrs["synthetic"] = False
        data_quality = {
            "score": 92,
            "source": "yfinance",
            "sourceOk": True,
            "priceOk": True,
            "historyDepthOk": True,
            "latestBarDate": today.isoformat(),
            "latestBarAgeDays": 0,
        }

        def quality(_ticker):
            return {
                "qualityScore": 86,
                "metrics": {},
                "dataQuality": data_quality,
                "qualityReliability": {"grade": "strong"},
                "backtest": {
                    "sampleCount": 8,
                    "winRate": 64,
                    "riskAdjustedReturnPct": 1.2,
                    "profitFactor": 1.5,
                },
                "gates": [],
                "warnings": [],
            }

        try:
            server.tokyo_market_status = lambda: {"isOpen": True, "phase": "REGULAR_SESSION", "label": "open", "message": "open"}
            server.load_market_universe = lambda: {
                "B001.T": {"name": "Blocked One", "sector": "Tech", "market_section": "Prime"},
                "B002.T": {"name": "Blocked Two", "sector": "Tech", "market_section": "Prime"},
            }
            server.get_stock_data = lambda *_args, **_kwargs: frame
            server.build_advanced_report = lambda ticker, *_args, **_kwargs: {
                "ticker": ticker,
                "verdict": "DEFENSIVE",
                "actionLabel": "DEFENSIVE",
                "compositeScore": 42,
                "analysisReliability": {"grade": "strong", "label": "strong"},
                "dataQuality": data_quality,
                "guardrails": [{"id": "trend", "ok": False}, {"id": "liquidity", "ok": True}],
            }
            server.quality_for_ticker = quality
            server._attach_material_events = lambda items: [
                {
                    **item,
                    "material": {
                        "tone": "positive",
                        "materialScore": 1.0,
                        "summary": "official",
                        "freshnessVerdict": "fresh",
                        "hasRecentImportant": True,
                        "hasNegative": False,
                        "recentOfficialDisclosureCount": 1,
                        "officialDisclosureCount": 1,
                    },
                }
                for item in items
            ]
            server._load_market_snapshot = lambda: {
                "source": "unit-test",
                "provider": "unit-test-provider",
                "universeCount": 2,
                "analyzedCount": 2,
                "rankings": {
                    "surge": [
                        {
                            "rank": 1,
                            "ticker": "B001.T",
                            "name": "Blocked One",
                            "sector": "Tech",
                            "price": 1000,
                            "changePct": 6.0,
                            "volume": 900000,
                            "turnoverJpy": 900000000,
                            "volumeRatio": 3,
                            "surgeScore": 98,
                            "candidateScore": 92,
                            "overheatRisk": 8,
                            "liquidityOk": True,
                            "liquidityGrade": "deep",
                            "targetPrice": 1080,
                            "stopLoss": 980,
                            "latestBarDate": today.isoformat(),
                        },
                        {
                            "rank": 2,
                            "ticker": "B002.T",
                            "name": "Blocked Two",
                            "sector": "Tech",
                            "price": 1000,
                            "changePct": 3.0,
                            "volume": 900000,
                            "turnoverJpy": 900000000,
                            "volumeRatio": 2,
                            "surgeScore": 82,
                            "candidateScore": 86,
                            "overheatRisk": 10,
                            "liquidityOk": True,
                            "liquidityGrade": "deep",
                            "targetPrice": 1060,
                            "stopLoss": 985,
                            "latestBarDate": today.isoformat(),
                        },
                    ]
                },
            }

            payload = server.market_rankings(kind="surge", limit=2, budget=500_000)
        finally:
            server._load_market_snapshot = original_load_snapshot
            server.tokyo_market_status = original_market_status
            server._attach_material_events = original_material
            server.quality_for_ticker = original_quality
            server.load_market_universe = original_universe
            server.get_stock_data = original_get_stock_data
            server.build_advanced_report = original_build_advanced_report

        self.assertIsNone(payload["bestOpportunity"])
        self.assertIsNotNone(payload["bestAvailableOpportunity"])
        self.assertEqual(len(payload["items"]), 2)
        for item in payload["items"]:
            self.assertEqual(item["advancedCrossEngineCheck"]["status"], "blocked")
            self.assertEqual(item["intradayOpportunity"]["tradeReadiness"], "avoid")
            self.assertEqual(item["intradayOpportunity"]["positionSizingVerdict"], "skip")

    def test_advanced_cross_engine_check_includes_numeric_yahoo_ticker_when_universe_is_unavailable(self):
        original_universe = server.load_market_universe
        original_get_stock_data = server.get_stock_data
        original_build_advanced_report = server.build_advanced_report
        today = server.dt.datetime.now(server.JST).date()
        closes = [1000 + index for index in range(90)]
        frame = pd.DataFrame(
            {
                "Open": [value * 0.995 for value in closes],
                "High": [value * 1.02 for value in closes],
                "Low": [value * 0.985 for value in closes],
                "Close": closes,
                "Volume": [900_000 for _ in closes],
            },
            index=fresh_business_index(len(closes)),
        )
        frame.attrs["source"] = "yfinance"
        frame.attrs["synthetic"] = False
        data_quality = {
            "score": 92,
            "source": "yfinance",
            "sourceOk": True,
            "priceOk": True,
            "historyDepthOk": True,
            "latestBarDate": today.isoformat(),
            "latestBarAgeDays": 0,
        }
        item = {
            "rank": 1,
            "ticker": "1234.T",
            "name": "Numeric Yahoo",
            "price": 1000,
            "changePct": 6.0,
            "volume": 900000,
            "turnoverJpy": 900000000,
            "volumeRatio": 3,
            "surgeScore": 98,
            "candidateScore": 92,
            "overheatRisk": 8,
            "liquidityOk": True,
            "liquidityGrade": "deep",
            "targetPrice": 1080,
            "stopLoss": 980,
            "latestBarDate": today.isoformat(),
            "source": server.YAHOO_FINANCE_GAINERS_URL,
            "material": {
                "tone": "positive",
                "materialScore": 1.0,
                "summary": "official",
                "freshnessVerdict": "fresh",
                "hasRecentImportant": True,
                "hasNegative": False,
                "recentOfficialDisclosureCount": 1,
                "officialDisclosureCount": 1,
            },
        }

        try:
            server.load_market_universe = lambda: {}
            server.get_stock_data = lambda *_args, **_kwargs: frame
            server.build_advanced_report = lambda ticker, *_args, **_kwargs: {
                "ticker": ticker,
                "verdict": "DEFENSIVE",
                "actionLabel": "DEFENSIVE",
                "compositeScore": 42,
                "analysisReliability": {"grade": "strong", "label": "strong"},
                "dataQuality": data_quality,
                "guardrails": [{"id": "trend", "ok": False}, {"id": "liquidity", "ok": True}],
            }

            enriched = server._attach_advanced_cross_engine_checks([item], limit=1, budget_jpy=500_000)
        finally:
            server.load_market_universe = original_universe
            server.get_stock_data = original_get_stock_data
            server.build_advanced_report = original_build_advanced_report

        self.assertEqual(enriched[0]["advancedCrossEngineCheck"]["status"], "blocked")
        self.assertEqual(enriched[0]["intradayOpportunity"]["tradeReadiness"], "avoid")
        self.assertEqual(enriched[0]["intradayOpportunity"]["positionSizingVerdict"], "skip")

    def test_market_rankings_refreshes_material_for_preliminary_top_candidates(self):
        original_load_snapshot = server._load_market_snapshot
        original_market_status = server.tokyo_market_status
        original_material = server._attach_material_events
        original_quality = server.quality_for_ticker
        today = server.dt.datetime.now(server.JST).date().isoformat()

        def ranking_item(index, ticker, score):
            return {
                "rank": index,
                "ticker": ticker,
                "name": ticker,
                "sector": "Tech",
                "price": 1000,
                "changePct": 2.0 + score / 100,
                "volume": 200000,
                "turnoverJpy": 200000000,
                "volumeRatio": 2,
                "surgeScore": score,
                "candidateScore": score,
                "overheatRisk": 10,
                "liquidityOk": True,
                "liquidityGrade": "deep",
                "targetPrice": 1060,
                "stopLoss": 985,
                "latestBarDate": today,
            }

        try:
            server.tokyo_market_status = lambda: {"isOpen": True, "phase": "REGULAR_SESSION", "label": "open", "message": "open"}

            def attach_material(items):
                enriched = []
                for item in items:
                    ticker = item["ticker"]
                    if ticker == "LATE7.T":
                        material = {
                            "tone": "positive",
                            "materialScore": 1.0,
                            "summary": "official positive",
                            "freshnessVerdict": "fresh",
                            "hasRecentImportant": True,
                            "hasNegative": False,
                            "recentOfficialDisclosureCount": 1,
                            "officialDisclosureCount": 1,
                        }
                    else:
                        material = {
                            "tone": "negative",
                            "materialScore": 0,
                            "summary": "negative",
                            "freshnessVerdict": "fresh",
                            "hasRecentImportant": True,
                            "hasNegative": True,
                            "recentOfficialDisclosureCount": 1,
                            "officialDisclosureCount": 1,
                        }
                    enriched.append({**item, "material": material})
                return enriched

            server._attach_material_events = attach_material
            server.quality_for_ticker = lambda ticker: {
                "qualityScore": 82,
                "metrics": {},
                "backtest": {
                    "sampleCount": 8,
                    "winRate": 64,
                    "riskAdjustedReturnPct": 1.0,
                    "profitFactor": 1.5,
                },
                "gates": [],
                "warnings": [],
            }
            ranking = [ranking_item(index, f"LOW{index}.T", 40 - index) for index in range(1, 7)]
            ranking.append(ranking_item(7, "LATE7.T", 99))
            server._load_market_snapshot = lambda: {
                "generatedAt": today,
                "source": "unit-test",
                "provider": "unit-test-provider",
                "universeCount": len(ranking),
                "analyzedCount": len(ranking),
                "items": ranking,
                "rankings": {"surge": ranking},
            }

            payload = server.market_rankings(kind="surge", limit=3, budget=500_000)
        finally:
            server._load_market_snapshot = original_load_snapshot
            server.tokyo_market_status = original_market_status
            server._attach_material_events = original_material
            server.quality_for_ticker = original_quality

        self.assertEqual(payload["items"][0]["ticker"], "LATE7.T")
        opportunity = payload["items"][0]["intradayOpportunity"]
        self.assertEqual(opportunity["material"]["tone"], "positive")
        self.assertEqual(opportunity["scoreBreakdown"]["materialReliabilityGrade"], "official_confirmed")
        self.assertEqual(opportunity["scoreBreakdown"]["materialReliabilityPenaltyJpy"], 0)

    def test_material_refresh_preserves_yahoo_site_rank_while_reranking_candidates(self):
        original_material = server._attach_material_events
        today = server.dt.datetime.now(server.JST).date().isoformat()

        def item(rank, ticker, score):
            return {
                "rank": rank,
                "ticker": ticker,
                "name": ticker,
                "price": 1000,
                "changePct": 2.0,
                "volume": 200000,
                "turnoverJpy": 200000000,
                "volumeRatio": 2,
                "surgeScore": score,
                "candidateScore": score,
                "overheatRisk": 10,
                "liquidityOk": True,
                "liquidityGrade": "deep",
                "targetPrice": 1060,
                "stopLoss": 985,
                "latestBarDate": today,
                "candidateQuality": {
                    "qualityScore": 82,
                    "metrics": {},
                    "backtest": {
                        "sampleCount": 8,
                        "winRate": 64,
                        "riskAdjustedReturnPct": 1.0,
                        "profitFactor": 1.5,
                    },
                    "gates": [],
                    "warnings": [],
                },
            }

        try:
            server._attach_material_events = lambda items: [
                {
                    **candidate,
                    "material": {
                        "tone": "positive",
                        "materialScore": 1.0,
                        "summary": "official",
                        "freshnessVerdict": "fresh",
                        "hasRecentImportant": True,
                        "hasNegative": False,
                        "recentOfficialDisclosureCount": 1,
                        "officialDisclosureCount": 1,
                    },
                }
                for candidate in items
            ]

            ranked = server._rank_with_material_refresh(
                [item(1, "SITE1.T", 40), item(7, "SITE7.T", 99)],
                500_000,
                preserve_rank=True,
                refresh_limit=2,
            )
        finally:
            server._attach_material_events = original_material

        self.assertEqual(ranked[0]["ticker"], "SITE7.T")
        self.assertEqual(ranked[0]["siteRank"], 7)
        self.assertEqual(ranked[0]["candidateRank"], 1)
        self.assertEqual(ranked[0]["intradayOpportunity"]["scoreBreakdown"]["materialReliabilityGrade"], "official_confirmed")

    def test_market_rankings_returns_off_hours_top_pick_when_market_is_closed(self):
        original_load_snapshot = server._load_market_snapshot
        original_market_status = server.tokyo_market_status
        original_quality = server.quality_for_ticker
        original_material = server._attach_material_events
        today = server.dt.datetime.now(server.JST).date().isoformat()
        try:
            server.tokyo_market_status = lambda: {"isOpen": False, "phase": "WEEKEND_CLOSED", "label": "休場日", "message": "closed"}
            server.quality_for_ticker = lambda ticker: {
                "qualityScore": 82,
                "metrics": {},
                "backtest": {
                    "sampleCount": 8,
                    "winRate": 64,
                    "riskAdjustedReturnPct": 1.0,
                    "profitFactor": 1.5,
                },
                "gates": [],
                "warnings": [],
            }
            server._attach_material_events = lambda items: [
                {
                    **item,
                    "material": {
                        "tone": "positive",
                        "materialScore": 0.9,
                        "summary": "unit",
                        "freshnessVerdict": "fresh",
                        "hasRecentImportant": True,
                        "hasNegative": False,
                        "recentOfficialDisclosureCount": 1,
                        "officialDisclosureCount": 1,
                    },
                }
                for item in items
            ]
            server._load_market_snapshot = lambda: {
                "generatedAt": "2026-05-31T00:00:00+09:00",
                "source": "unit-test",
                "provider": "unit-test-provider",
                "universeCount": 1,
                "analyzedCount": 1,
                "rankings": {
                    "surge": [
                        {
                            "rank": 1,
                            "ticker": "WIN1.T",
                            "name": "Closed Market Winner",
                            "price": 2500,
                            "changePct": 2.2,
                            "volumeRatio": 2.8,
                            "surgeScore": 84,
                            "candidateScore": 82,
                            "overheatRisk": 8,
                            "liquidityOk": True,
                            "liquidityGrade": "deep",
                            "momentum5Pct": 5.5,
                            "targetPrice": 2625,
                            "stopLoss": 2440,
                            "latestBarDate": today,
                        },
                    ]
                },
            }

            payload = server.market_rankings(kind="surge", limit=1, budget=500_000)
        finally:
            server._load_market_snapshot = original_load_snapshot
            server.tokyo_market_status = original_market_status
            server.quality_for_ticker = original_quality
            server._attach_material_events = original_material

        self.assertFalse(payload["marketStatus"]["isOpen"])
        self.assertEqual(payload["bestOpportunity"]["ticker"], "WIN1.T")
        self.assertGreater(payload["bestOpportunity"]["expectedProfitJpy"], 0)
        self.assertEqual(payload["items"][0]["ticker"], "WIN1.T")

    def test_jquants_status_uses_real_bridge_configuration(self):
        original_bridge = server.jquants_bridge
        try:
            class Bridge:
                @staticmethod
                def connector_status():
                    return {
                        "configured": True,
                        "available": True,
                        "mode": "API_KEY",
                        "dataPolicy": {"recentWindowDays": 84},
                    }

            server.jquants_bridge = Bridge
            payload = server.jquants_status()
        finally:
            server.jquants_bridge = original_bridge

        self.assertTrue(payload["configured"])
        self.assertEqual(payload["mode"], "API_KEY")

    def test_jquants_research_returns_bridge_packet(self):
        original_bridge = server.jquants_bridge
        try:
            class Bridge:
                JQuantsError = RuntimeError

                @staticmethod
                def research_packet(code):
                    return {
                        "configured": True,
                        "available": True,
                        "code": code,
                        "summary": "loaded",
                    }

            server.jquants_bridge = Bridge
            payload = server.jquants_research("4980.T")
        finally:
            server.jquants_bridge = original_bridge

        self.assertTrue(payload["available"])
        self.assertEqual(payload["code"], "4980.T")

    def test_candidate_quality_reports_backtest_and_gates(self):
        prices = [100 + i * 0.35 + math.sin(i / 3) * 2 for i in range(90)]
        highs = [price * 1.01 for price in prices]
        lows = [price * 0.99 for price in prices]
        volumes = [200000 + i * 1000 for i in range(90)]

        quality = server.build_candidate_quality(
            prices,
            highs,
            lows,
            volumes,
            rr={"rr_ratio": 2.4},
            vcp_ok=True,
            accum_ok=True,
        )

        self.assertGreater(quality["qualityScore"], 70)
        self.assertGreater(quality["backtest"]["sampleCount"], 0)
        self.assertIn("riskAdjustedReturnPct", quality["backtest"])
        self.assertIn("profitFactor", quality["backtest"])
        self.assertIn(quality["backtest"]["matchQuality"], {"similar", "broad"})
        self.assertIn(quality["backtest"]["evidenceStrength"]["grade"], {"strong", "moderate", "weak"})
        self.assertIn(quality["qualityReliability"]["grade"], {"strong", "moderate", "weak"})
        self.assertTrue(any(gate["id"] == "backtest" for gate in quality["gates"]))
        self.assertTrue(any(gate["id"] == "evidence_strength" for gate in quality["gates"]))
        self.assertTrue(all("繧" not in gate["label"] and "????" not in gate["label"] for gate in quality["gates"]))
        self.assertTrue(all("evidence" not in gate["label"].lower() for gate in quality["gates"]))
        self.assertTrue(all("structure" not in gate["label"].lower() for gate in quality["gates"]))
        self.assertTrue(all("pattern" not in gate["label"].lower() for gate in quality["gates"]))
        self.assertIn("momentum5", quality["metrics"])

    def test_candidate_quality_penalizes_negative_similar_pattern_expectancy(self):
        prices = []
        value = 100.0
        for _ in range(4):
            for _day in range(20):
                value *= 1.002
                prices.append(round(value, 2))
            for _day in range(5):
                value *= 1.01
                prices.append(round(value, 2))
            value *= 0.97
            prices.append(round(value, 2))
        for _day in range(20):
            value *= 1.002
            prices.append(round(value, 2))
        for _day in range(5):
            value *= 1.01
            prices.append(round(value, 2))
        highs = [price * 1.01 for price in prices]
        lows = [price * 0.985 for price in prices]
        volumes = [180000 + (index % 6) * 10000 for index in range(len(prices))]

        quality = server.build_candidate_quality(
            prices,
            highs,
            lows,
            volumes,
            rr={"rr_ratio": 2.0},
        )

        self.assertGreaterEqual(quality["backtest"]["sampleCount"], 3)
        self.assertLessEqual(quality["backtest"]["riskAdjustedReturnPct"], 0)
        self.assertIn("類似パターンの翌日期待値が弱いです。", quality["warnings"])

    def test_intraday_opportunity_penalizes_weak_quality_reliability(self):
        base = {
            "ticker": "EVDC.T",
            "name": "Evidence Test",
            "price": 1000,
            "changePct": 4.0,
            "volumeRatio": 2.2,
            "surgeScore": 86,
            "candidateScore": 82,
            "overheatRisk": 18,
            "liquidityOk": True,
            "liquidityGrade": "deep",
            "turnoverJpy": 900_000_000,
            "momentum5Pct": 5.0,
            "targetPrice": 1050,
            "stopLoss": 985,
            "latestBarDate": server.dt.datetime.now(server.JST).date().isoformat(),
            "material": {
                "tone": "positive",
                "materialScore": 0.8,
                "freshnessVerdict": "fresh",
                "hasRecentImportant": True,
                "recentOfficialDisclosureCount": 1,
                "summary": "上方修正を発表",
            },
            "marketRelative": {
                "available": True,
                "riskOff": False,
                "sectorTailwind": True,
                "sectorHeadwind": False,
                "relativeToMarketPct": 1.0,
                "summary": "市場地合いは中立",
            },
        }
        strong = server._build_intraday_opportunity({
            **base,
            "candidateQuality": {
                "backtest": {
                    "sampleCount": 9,
                    "winRate": 62,
                    "riskAdjustedReturnPct": 0.8,
                    "profitFactor": 1.4,
                    "matchQuality": "similar",
                    "evidenceStrength": {"grade": "strong", "score": 90, "label": "検証強度: 強"},
                },
                "qualityReliability": {"grade": "strong", "score": 90, "label": "検証強度: 強"},
            },
        })
        weak = server._build_intraday_opportunity({
            **base,
            "candidateQuality": {
                "backtest": {
                    "sampleCount": 2,
                    "winRate": 60,
                    "riskAdjustedReturnPct": 0.8,
                    "profitFactor": 1.4,
                    "matchQuality": "broad",
                    "evidenceStrength": {"grade": "weak", "score": 30, "label": "検証強度: 弱"},
                },
                "qualityReliability": {"grade": "weak", "score": 30, "label": "検証強度: 弱"},
            },
        })

        self.assertGreater(strong["confidencePct"], weak["confidencePct"])
        self.assertEqual(weak["scoreBreakdown"]["qualityReliability"]["grade"], "weak")
        self.assertTrue(any("検証強度" in item for item in weak["whyNotBuy"]))

    def test_market_item_from_history_builds_rankable_snapshot_row(self):
        closes = [100 + index * 0.4 for index in range(45)]
        frame = pd.DataFrame(
            {
                "Open": [value * 0.998 for value in closes],
                "High": [value * 1.01 for value in closes],
                "Low": [value * 0.99 for value in closes],
                "Close": closes,
                "Volume": [200000 + index * 3000 for index in range(len(closes))],
            },
            index=pd.date_range("2026-01-01", periods=len(closes), freq="B"),
        )

        item = server._market_item_from_history(
            "7203.T",
            {"name": "Toyota", "market_section": "Prime Market (Domestic)", "sector": "Transportation Equipment"},
            frame,
        )

        self.assertEqual(item["ticker"], "7203.T")
        self.assertGreater(item["changePct"], 0)
        self.assertGreater(item["turnoverJpy"], 0)
        self.assertGreater(item["candidateScore"], 0)
        self.assertIn("candidateQuality", item)
        self.assertIn("riskAdjustedReturnPct", item["candidateQuality"]["backtest"])
        self.assertIn(item["surgeStage"], {"本命急騰", "高騰初動", "上昇監視", "観察", "過熱注意"})
        self.assertIn("surgeScore", item)

    def test_market_item_caps_candidate_quality_when_price_history_is_stale(self):
        closes = [100 + index * 0.8 for index in range(90)]
        frame = pd.DataFrame(
            {
                "Open": [value * 0.998 for value in closes],
                "High": [value * 1.02 for value in closes],
                "Low": [value * 0.99 for value in closes],
                "Close": closes,
                "Volume": [800000 + index * 5000 for index in range(len(closes))],
            },
            index=pd.date_range(end=server.dt.date.today() - server.dt.timedelta(days=45), periods=len(closes), freq="D"),
        )
        frame.attrs["source"] = "yfinance"
        frame.attrs["synthetic"] = False

        item = server._market_item_from_history(
            "7203.T",
            {"name": "Toyota", "market_section": "Prime Market (Domestic)", "sector": "Transportation Equipment"},
            frame,
        )

        quality = item["candidateQuality"]
        data_quality = quality["dataQuality"]
        data_gate = next(gate for gate in quality["gates"] if gate["id"] == "data_quality")
        self.assertFalse(data_quality["priceOk"])
        self.assertGreaterEqual(data_quality["latestBarAgeDays"], 30)
        self.assertFalse(data_gate["ok"])
        self.assertLessEqual(quality["qualityScore"], 64)
        self.assertLessEqual(item["candidateScore"], 64)

    def test_stock_payload_caps_candidate_quality_for_synthetic_history(self):
        closes = [100 + index * 0.5 for index in range(90)]
        frame = pd.DataFrame(
            {
                "Open": [value * 0.998 for value in closes],
                "High": [value * 1.02 for value in closes],
                "Low": [value * 0.99 for value in closes],
                "Close": closes,
                "Volume": [900000 for _ in closes],
            },
            index=fresh_business_index(len(closes)),
        )
        frame.attrs["source"] = "synthetic"
        frame.attrs["synthetic"] = True

        original_get_stock_data = server.get_stock_data
        try:
            server.get_stock_data = lambda *args, **kwargs: frame
            payload = server._stock_payload("4980.T", server.MUST_INCLUDE["4980.T"])
        finally:
            server.get_stock_data = original_get_stock_data

        data_quality = payload["candidateQuality"]["dataQuality"]
        data_gate = next(gate for gate in payload["candidateQuality"]["gates"] if gate["id"] == "data_quality")
        self.assertTrue(data_quality["synthetic"])
        self.assertFalse(data_quality["sourceOk"])
        self.assertFalse(data_gate["ok"])
        self.assertLessEqual(payload["candidateQuality"]["qualityScore"], 55)
        self.assertLessEqual(payload["candidateScore"], 55)

    def test_stock_detail_includes_candidate_data_quality_gate(self):
        closes = [100 + index * 0.5 for index in range(90)]
        frame = pd.DataFrame(
            {
                "Open": [value * 0.998 for value in closes],
                "High": [value * 1.02 for value in closes],
                "Low": [value * 0.99 for value in closes],
                "Close": closes,
                "Volume": [900000 for _ in closes],
            },
            index=pd.date_range(end=server.dt.date.today(), periods=len(closes), freq="D"),
        )
        frame.attrs["source"] = "yfinance"
        frame.attrs["synthetic"] = False

        original_get_stock_data = server.get_stock_data
        original_material_events = server.material_events_for_ticker
        try:
            server.get_stock_data = lambda *args, **kwargs: frame
            server.material_events_for_ticker = lambda *args, **kwargs: {
                "materialAvailable": False,
                "materialScore": 0,
                "items": [],
                "sources": [],
                "tone": "unconfirmed",
            }
            payload = server.get_stock_detail("4980.T")
        finally:
            server.get_stock_data = original_get_stock_data
            server.material_events_for_ticker = original_material_events

        quality = payload["candidateQuality"]
        data_quality = quality["dataQuality"]
        data_gate = next(gate for gate in quality["gates"] if gate["id"] == "data_quality")
        self.assertEqual(data_quality["source"], "yfinance")
        self.assertTrue(data_quality["priceOk"])
        self.assertTrue(data_gate["ok"])
        self.assertEqual(payload["dataQuality"]["source"], "yfinance")

    def test_candidate_data_quality_blocks_fresh_short_history_depth(self):
        closes = [100 + index * 0.5 for index in range(21)]
        frame = pd.DataFrame(
            {
                "Open": [value * 0.998 for value in closes],
                "High": [value * 1.02 for value in closes],
                "Low": [value * 0.99 for value in closes],
                "Close": closes,
                "Volume": [900000 for _ in closes],
            },
            index=fresh_business_index(len(closes)),
        )
        frame.attrs["source"] = "yahoo_chart"
        frame.attrs["synthetic"] = False

        quality = server._candidate_data_quality(frame, closes, frame["Volume"].tolist())
        candidate_quality = server.build_candidate_quality(
            closes,
            frame["High"].tolist(),
            frame["Low"].tolist(),
            frame["Volume"].tolist(),
            data_quality=quality,
        )
        data_gate = next(gate for gate in candidate_quality["gates"] if gate["id"] == "data_quality")

        self.assertTrue(quality["priceOk"])
        self.assertFalse(quality["historyDepthOk"])
        self.assertEqual(quality["minHistoryBars"], 60)
        self.assertFalse(server._candidate_data_quality_ok(quality))
        self.assertFalse(data_gate["ok"])
        self.assertLessEqual(candidate_quality["qualityScore"], 64)

    def test_cross_engine_consistency_blocks_defensive_advanced_report(self):
        good_data_quality = {
            "score": 92,
            "source": "yfinance",
            "sourceOk": True,
            "priceOk": True,
            "latestBarAgeDays": 1,
            "bars": 120,
            "historyDepthOk": True,
            "minHistoryBars": 60,
        }

        check = server._cross_engine_consistency(
            ticker="7203.T",
            candidate={
                "ticker": "7203.T",
                "candidateScore": 88,
                "candidateQuality": {"dataQuality": good_data_quality},
            },
            opportunity={
                "ticker": "7203.T",
                "tradeReadiness": "ready",
                "decisionAudit": {"verdict": "PASS"},
            },
            advanced_report={
                "ticker": "7203.T",
                "verdict": "DEFENSIVE",
                "actionLabel": "Defensive",
                "compositeScore": 44,
                "analysisReliability": {"grade": "strong", "label": "Strong evidence"},
                "guardrails": [{"label": "positive edge", "ok": False}],
                "dataQuality": good_data_quality,
            },
        )

        self.assertEqual(check["status"], "blocked")
        self.assertEqual(check["advancedVerdict"], "DEFENSIVE")
        failed_ids = {gate["id"] for gate in check["gates"] if not gate["ok"]}
        self.assertIn("advanced_verdict", failed_ids)
        self.assertIn("advanced_guardrails", failed_ids)

    def test_cross_engine_consistency_aligns_only_when_all_engines_pass(self):
        good_data_quality = {
            "score": 94,
            "source": "yfinance",
            "sourceOk": True,
            "priceOk": True,
            "latestBarAgeDays": 0,
            "bars": 120,
            "historyDepthOk": True,
            "minHistoryBars": 60,
        }

        check = server._cross_engine_consistency(
            ticker="6503.T",
            candidate={
                "ticker": "6503.T",
                "candidateScore": 84,
                "candidateQuality": {"dataQuality": good_data_quality},
            },
            opportunity={
                "ticker": "6503.T",
                "tradeReadiness": "ready",
                "decisionAudit": {"verdict": "PASS"},
            },
            advanced_report={
                "ticker": "6503.T",
                "verdict": "ADVANCED_READY",
                "actionLabel": "Advanced ready",
                "compositeScore": 78,
                "analysisReliability": {"grade": "strong", "label": "Strong evidence"},
                "guardrails": [{"label": "positive edge", "ok": True}],
                "dataQuality": good_data_quality,
            },
        )

        self.assertEqual(check["status"], "aligned")
        self.assertTrue(all(gate["ok"] for gate in check["gates"]))
        self.assertEqual(check["candidateScore"], 84)
        self.assertEqual(check["tradeReadiness"], "ready")

    def test_cross_engine_consistency_is_pending_when_advanced_report_missing(self):
        check = server._cross_engine_consistency(
            ticker="6503.T",
            candidate={
                "ticker": "6503.T",
                "candidateScore": 84,
                "candidateQuality": {
                    "dataQuality": {
                        "score": 94,
                        "source": "yfinance",
                        "sourceOk": True,
                        "priceOk": True,
                        "bars": 120,
                        "historyDepthOk": True,
                        "minHistoryBars": 60,
                    }
                },
            },
            opportunity={
                "ticker": "6503.T",
                "tradeReadiness": "ready",
                "decisionAudit": {"verdict": "PASS"},
            },
            advanced_report=None,
        )

        self.assertEqual(check["status"], "pending")
        self.assertEqual(check["advancedVerdict"], "UNKNOWN")
        self.assertEqual(check["gates"], [])

    def test_cross_engine_consistency_marks_review_for_watchlist_advanced_report(self):
        good_data_quality = {
            "score": 90,
            "source": "yfinance",
            "sourceOk": True,
            "priceOk": True,
            "latestBarAgeDays": 1,
            "bars": 120,
            "historyDepthOk": True,
            "minHistoryBars": 60,
        }

        check = server._cross_engine_consistency(
            ticker="6503.T",
            candidate={
                "ticker": "6503.T",
                "candidateScore": 76,
                "candidateQuality": {"dataQuality": good_data_quality},
            },
            opportunity={
                "ticker": "6503.T",
                "tradeReadiness": "ready",
                "decisionAudit": {"verdict": "PASS"},
            },
            advanced_report={
                "ticker": "6503.T",
                "verdict": "WATCHLIST",
                "actionLabel": "Watchlist",
                "compositeScore": 64,
                "analysisReliability": {"grade": "moderate", "label": "Moderate evidence"},
                "guardrails": [{"label": "positive edge", "ok": True}],
                "dataQuality": good_data_quality,
            },
        )

        self.assertEqual(check["status"], "review")
        failed_ids = {gate["id"] for gate in check["gates"] if not gate["ok"]}
        self.assertIn("advanced_verdict", failed_ids)
        self.assertNotIn("price_data_quality", failed_ids)

    def test_cross_engine_consistency_blocks_when_advanced_report_ticker_differs(self):
        good_data_quality = {
            "score": 92,
            "source": "yfinance",
            "sourceOk": True,
            "priceOk": True,
            "latestBarAgeDays": 1,
            "bars": 120,
            "historyDepthOk": True,
            "minHistoryBars": 60,
        }

        check = server._cross_engine_consistency(
            ticker="6503.T",
            candidate={
                "ticker": "6503.T",
                "candidateScore": 82,
                "candidateQuality": {"dataQuality": good_data_quality},
            },
            opportunity={
                "ticker": "6503.T",
                "tradeReadiness": "ready",
                "decisionAudit": {"verdict": "PASS"},
            },
            advanced_report={
                "ticker": "7203.T",
                "verdict": "ADVANCED_READY",
                "actionLabel": "Advanced ready",
                "compositeScore": 78,
                "analysisReliability": {"grade": "strong", "label": "Strong evidence"},
                "guardrails": [{"label": "positive edge", "ok": True}],
                "dataQuality": good_data_quality,
            },
        )

        self.assertEqual(check["status"], "blocked")
        ticker_gate = next(gate for gate in check["gates"] if gate["id"] == "ticker_match")
        self.assertFalse(ticker_gate["ok"])
        self.assertIn("7203.T", ticker_gate["detail"])

    def test_cross_engine_consistency_blocks_when_advanced_data_quality_is_stale(self):
        good_candidate_quality = {
            "score": 92,
            "source": "yfinance",
            "sourceOk": True,
            "priceOk": True,
            "latestBarAgeDays": 1,
            "bars": 120,
            "historyDepthOk": True,
            "minHistoryBars": 60,
        }
        stale_advanced_quality = {
            "score": 62,
            "source": "yfinance",
            "sourceOk": True,
            "priceOk": False,
            "latestBarAgeDays": 21,
            "bars": 120,
            "historyDepthOk": True,
            "minHistoryBars": 60,
        }

        check = server._cross_engine_consistency(
            ticker="6503.T",
            candidate={
                "ticker": "6503.T",
                "candidateScore": 82,
                "candidateQuality": {"dataQuality": good_candidate_quality},
            },
            opportunity={
                "ticker": "6503.T",
                "tradeReadiness": "ready",
                "decisionAudit": {"verdict": "PASS"},
            },
            advanced_report={
                "ticker": "6503.T",
                "verdict": "ADVANCED_READY",
                "actionLabel": "Advanced ready",
                "compositeScore": 78,
                "analysisReliability": {"grade": "strong", "label": "Strong evidence"},
                "guardrails": [{"label": "positive edge", "ok": True}],
                "dataQuality": stale_advanced_quality,
            },
        )

        self.assertEqual(check["status"], "blocked")
        self.assertFalse(check["dataQualityOk"])
        data_gate = next(gate for gate in check["gates"] if gate["id"] == "price_data_quality")
        self.assertFalse(data_gate["ok"])

    def test_cross_engine_consistency_blocks_when_candidate_data_quality_is_synthetic(self):
        synthetic_candidate_quality = {
            "score": 55,
            "source": "synthetic",
            "sourceOk": False,
            "priceOk": True,
            "synthetic": True,
            "latestBarAgeDays": 0,
            "bars": 120,
            "historyDepthOk": True,
            "minHistoryBars": 60,
        }
        good_advanced_quality = {
            "score": 90,
            "source": "yfinance",
            "sourceOk": True,
            "priceOk": True,
            "latestBarAgeDays": 0,
            "bars": 120,
            "historyDepthOk": True,
            "minHistoryBars": 60,
        }

        check = server._cross_engine_consistency(
            ticker="6503.T",
            candidate={
                "ticker": "6503.T",
                "candidateScore": 82,
                "candidateQuality": {"dataQuality": synthetic_candidate_quality},
            },
            opportunity={
                "ticker": "6503.T",
                "tradeReadiness": "ready",
                "decisionAudit": {"verdict": "PASS"},
            },
            advanced_report={
                "ticker": "6503.T",
                "verdict": "ADVANCED_READY",
                "actionLabel": "Advanced ready",
                "compositeScore": 78,
                "analysisReliability": {"grade": "strong", "label": "Strong evidence"},
                "guardrails": [{"label": "positive edge", "ok": True}],
                "dataQuality": good_advanced_quality,
            },
        )

        self.assertEqual(check["status"], "blocked")
        self.assertFalse(check["dataQualityOk"])
        data_gate = next(gate for gate in check["gates"] if gate["id"] == "price_data_quality")
        self.assertFalse(data_gate["ok"])

    def test_cross_engine_consistency_blocks_when_candidate_history_depth_is_insufficient(self):
        short_candidate_quality = {
            "score": 82,
            "source": "yahoo_chart",
            "sourceOk": True,
            "priceOk": True,
            "latestBarAgeDays": 0,
            "bars": 21,
            "historyDepthOk": False,
            "minHistoryBars": 60,
        }
        good_advanced_quality = {
            "score": 90,
            "source": "yfinance",
            "sourceOk": True,
            "priceOk": True,
            "latestBarAgeDays": 0,
            "bars": 120,
            "historyDepthOk": True,
            "minHistoryBars": 60,
        }

        check = server._cross_engine_consistency(
            ticker="6503.T",
            candidate={
                "ticker": "6503.T",
                "candidateScore": 82,
                "candidateQuality": {"dataQuality": short_candidate_quality},
            },
            opportunity={
                "ticker": "6503.T",
                "tradeReadiness": "ready",
                "decisionAudit": {"verdict": "PASS"},
            },
            advanced_report={
                "ticker": "6503.T",
                "verdict": "ADVANCED_READY",
                "actionLabel": "Advanced ready",
                "compositeScore": 78,
                "analysisReliability": {"grade": "strong", "label": "Strong evidence"},
                "guardrails": [{"label": "positive edge", "ok": True}],
                "dataQuality": good_advanced_quality,
            },
        )

        self.assertEqual(check["status"], "blocked")
        self.assertFalse(check["dataQualityOk"])
        data_gate = next(gate for gate in check["gates"] if gate["id"] == "price_data_quality")
        self.assertFalse(data_gate["ok"])

    def test_stock_detail_exposes_backend_cross_engine_check(self):
        closes = [100 + index * 0.5 for index in range(90)]
        frame = pd.DataFrame(
            {
                "Open": [value * 0.998 for value in closes],
                "High": [value * 1.02 for value in closes],
                "Low": [value * 0.99 for value in closes],
                "Close": closes,
                "Volume": [900000 for _ in closes],
            },
            index=fresh_business_index(len(closes)),
        )
        frame.attrs["source"] = "yfinance"
        frame.attrs["synthetic"] = False
        defensive_report = {
            "ticker": "4980.T",
            "verdict": "DEFENSIVE",
            "actionLabel": "Defensive",
            "compositeScore": 41,
            "analysisReliability": {"grade": "strong", "label": "Strong evidence"},
            "guardrails": [{"label": "positive edge", "ok": False}],
            "dataQuality": {
                "score": 90,
                "source": "yfinance",
                "sourceOk": True,
                "priceOk": True,
                "latestBarAgeDays": 0,
                "bars": 120,
                "historyDepthOk": True,
                "minHistoryBars": 60,
            },
        }

        original_get_stock_data = server.get_stock_data
        original_material_events = server.material_events_for_ticker
        original_build_advanced_report = server.build_advanced_report
        stock_data_calls = []
        advanced_history_ids = []

        def fake_get_stock_data(*args, **kwargs):
            stock_data_calls.append({"args": args, "kwargs": kwargs})
            return frame

        def fake_build_advanced_report(_ticker, advanced_hist, **_kwargs):
            advanced_history_ids.append(id(advanced_hist))
            return defensive_report

        try:
            server.get_stock_data = fake_get_stock_data
            server.material_events_for_ticker = lambda *args, **kwargs: {
                "materialAvailable": True,
                "materialScore": 0.8,
                "items": [],
                "sources": [],
                "tone": "positive",
                "freshnessVerdict": "fresh",
                "hasRecentImportant": True,
                "recentOfficialDisclosureCount": 1,
            }
            server.build_advanced_report = fake_build_advanced_report
            payload = server.get_stock_detail("4980.T")
        finally:
            server.get_stock_data = original_get_stock_data
            server.material_events_for_ticker = original_material_events
            server.build_advanced_report = original_build_advanced_report

        check = payload["crossEngineCheck"]
        self.assertEqual(stock_data_calls[0]["kwargs"]["period"], "1y")
        self.assertEqual(advanced_history_ids, [id(frame)])
        self.assertEqual(check["status"], "blocked")
        self.assertEqual(check["advancedVerdict"], "DEFENSIVE")
        self.assertEqual(check["source"], "backend-cross-engine")
        self.assertEqual(payload["advancedReport"]["verdict"], "DEFENSIVE")

    def test_stock_detail_reuses_single_evidence_context(self):
        closes = [100 + index * 0.5 for index in range(90)]
        frame = pd.DataFrame(
            {
                "Open": [value * 0.998 for value in closes],
                "High": [value * 1.02 for value in closes],
                "Low": [value * 0.99 for value in closes],
                "Close": closes,
                "Volume": [900000 for _ in closes],
            },
            index=fresh_business_index(len(closes)),
        )
        frame.attrs["source"] = "yfinance"
        frame.attrs["synthetic"] = False

        original_get_stock_data = server.get_stock_data
        original_material_events = server.material_events_for_ticker
        original_build_advanced_report = server.build_advanced_report
        original_build_candidate_quality = server.build_candidate_quality
        original_preopen_for_ticker = server.preopen_for_ticker
        calls = {"quality": 0, "preopen": 0}

        def fake_build_candidate_quality(*_args, **kwargs):
            calls["quality"] += 1
            return {
                "qualityScore": 82,
                "metrics": {"momentum5": 4, "momentum20": 8, "rsi": 62, "volumeRatio": 1.2, "rrRatio": 2.0},
                "backtest": {
                    "sampleCount": 8,
                    "winRate": 62,
                    "riskAdjustedReturnPct": 0.8,
                    "profitFactor": 1.4,
                },
                "qualityReliability": {"grade": "strong", "score": 90, "label": "strong"},
                "dataQuality": kwargs["data_quality"],
                "gates": [{"id": "data_quality", "ok": True, "passed": True, "label": "data"}],
                "warnings": [],
            }

        def fake_preopen_for_ticker(*_args, **_kwargs):
            calls["preopen"] += 1
            return {
                "score": 76,
                "decisionLabel": "Review",
                "riskFlags": [],
                "watchPoints": [],
                "keyReasons": ["unit preopen"],
            }

        try:
            server.get_stock_data = lambda *args, **kwargs: frame
            server.material_events_for_ticker = lambda *args, **kwargs: {
                "materialAvailable": False,
                "materialScore": 0,
                "items": [],
                "sources": [],
                "tone": "unconfirmed",
            }
            server.build_advanced_report = lambda *args, **kwargs: None
            server.build_candidate_quality = fake_build_candidate_quality
            server.preopen_for_ticker = fake_preopen_for_ticker
            payload = server.get_stock_detail("4980.T")
        finally:
            server.get_stock_data = original_get_stock_data
            server.material_events_for_ticker = original_material_events
            server.build_advanced_report = original_build_advanced_report
            server.build_candidate_quality = original_build_candidate_quality
            server.preopen_for_ticker = original_preopen_for_ticker

        self.assertEqual(calls, {"quality": 1, "preopen": 1})
        self.assertEqual(payload["candidateQuality"]["qualityScore"], 82)
        self.assertEqual(payload["candidateQuality"]["dataQuality"], payload["dataQuality"])
        self.assertEqual(payload["preopenScore"], 76)
        self.assertEqual(payload["intradayOpportunity"]["dataFreshness"]["latestBarDate"], payload["dataQuality"]["latestBarDate"])

    def test_stock_detail_marks_cross_engine_pending_when_advanced_report_build_fails(self):
        closes = [100 + index * 0.5 for index in range(90)]
        frame = pd.DataFrame(
            {
                "Open": [value * 0.998 for value in closes],
                "High": [value * 1.02 for value in closes],
                "Low": [value * 0.99 for value in closes],
                "Close": closes,
                "Volume": [900000 for _ in closes],
            },
            index=fresh_business_index(len(closes)),
        )
        frame.attrs["source"] = "yfinance"
        frame.attrs["synthetic"] = False

        original_get_stock_data = server.get_stock_data
        original_material_events = server.material_events_for_ticker
        original_build_advanced_report = server.build_advanced_report
        try:
            server.get_stock_data = lambda *args, **kwargs: frame
            server.material_events_for_ticker = lambda *args, **kwargs: {
                "materialAvailable": False,
                "materialScore": 0,
                "items": [],
                "sources": [],
                "tone": "unconfirmed",
            }
            server.build_advanced_report = lambda *args, **kwargs: (_ for _ in ()).throw(ValueError("advanced unavailable"))
            payload = server.get_stock_detail("4980.T")
        finally:
            server.get_stock_data = original_get_stock_data
            server.material_events_for_ticker = original_material_events
            server.build_advanced_report = original_build_advanced_report

        self.assertIsNone(payload["advancedReport"])
        self.assertEqual(payload["crossEngineCheck"]["status"], "pending")
        self.assertEqual(payload["crossEngineCheck"]["advancedVerdict"], "UNKNOWN")

    def test_market_ranker_sorts_popular_by_turnover_and_volume_ratio(self):
        items = [
            {"ticker": "1111.T", "popularityScore": 50, "turnoverJpy": 1000, "volumeRatio": 1, "changePct": 1, "candidateScore": 50},
            {"ticker": "2222.T", "popularityScore": 80, "turnoverJpy": 500, "volumeRatio": 3, "changePct": 0.5, "candidateScore": 40},
        ]

        ranked = server._rank_market_items(items, "popular")

        self.assertEqual(ranked[0]["ticker"], "2222.T")
        self.assertEqual(ranked[0]["rank"], 1)

    def test_market_snapshot_payload_exposes_all_ranking_kinds(self):
        payload = server._snapshot_payload(
            [
                {"ticker": "1111.T", "changePct": 1, "turnoverJpy": 100, "candidateScore": 60, "popularityScore": 40, "volume": 1000, "surgeScore": 55, "overheatRisk": 5},
                {"ticker": "2222.T", "changePct": 3, "turnoverJpy": 200, "candidateScore": 55, "popularityScore": 50, "volume": 2000, "surgeScore": 72, "overheatRisk": 12},
            ],
            universe_count=3800,
            source="test",
        )

        self.assertEqual(payload["universeCount"], 3800)
        self.assertEqual(set(payload["rankings"]), {"surge", "gainers", "breakout", "popular", "volume", "quality", "overheat"})
        self.assertEqual(payload["rankings"]["gainers"][0]["ticker"], "2222.T")
        self.assertEqual(payload["rankings"]["surge"][0]["ticker"], "2222.T")

    def test_yahoo_finance_gainers_parser_preserves_site_order(self):
        html = """
        <tr class="RankingTable__row__1Gwp"><th scope="row" class="RankingTable__head__2mLL RankingTable__rank__2fAZ">1</th><td class="RankingTable__detail__P452"><a href="https://finance.yahoo.co.jp/quote/3624.T" data-cl-params="_cl_link:name;_cl_position:0">Accelmark</a><ul class="RankingTable__supplements__15Cu"><li class="RankingTable__supplement__vv_m">3624</li><li class="RankingTable__supplement__vv_m">TSE GRT</li></ul></td><td class="RankingTable__detail__P452 RankingTable__detail--value__i9gr"><span class="StyledNumber__value__3rXW">88</span></td><td class="RankingTable__detail__P452 RankingTable__detail--value__i9gr RankingTable__detail--highlight__2Iu2"><span class="StyledNumber__value__3rXW">+30</span><span class="StyledNumber__value__3rXW">+51.72</span><span class="StyledNumber__suffix__2SD5">%</span></td><td class="RankingTable__detail__P452 RankingTable__detail--value__i9gr"><span class="StyledNumber__value__3rXW">645,600</span><span class="StyledNumber__suffix__2SD5">株</span></td></tr>
        <tr class="RankingTable__row__1Gwp"><th scope="row" class="RankingTable__head__2mLL RankingTable__rank__2fAZ">2</th><td class="RankingTable__detail__P452"><a href="https://finance.yahoo.co.jp/quote/8783.T" data-cl-params="_cl_link:name;_cl_position:1">abc</a><ul class="RankingTable__supplements__15Cu"><li class="RankingTable__supplement__vv_m">8783</li><li class="RankingTable__supplement__vv_m">TSE STD</li></ul></td><td class="RankingTable__detail__P452 RankingTable__detail--value__i9gr"><span class="StyledNumber__value__3rXW">130</span></td><td class="RankingTable__detail__P452 RankingTable__detail--value__i9gr RankingTable__detail--highlight__2Iu2"><span class="StyledNumber__value__3rXW">+28</span><span class="StyledNumber__value__3rXW">+27.45</span><span class="StyledNumber__suffix__2SD5">%</span></td><td class="RankingTable__detail__P452 RankingTable__detail--value__i9gr"><span class="StyledNumber__value__3rXW">11,070,200</span><span class="StyledNumber__suffix__2SD5">株</span></td></tr>
        """

        class Response:
            text = html

            @staticmethod
            def raise_for_status():
                return None

        original_get = server.requests.get
        try:
            server.requests.get = lambda *args, **kwargs: Response()

            items = server._yahoo_finance_gainers(limit=2)
        finally:
            server.requests.get = original_get

        self.assertEqual([item["ticker"] for item in items], ["3624.T", "8783.T"])
        self.assertEqual(items[0]["rank"], 1)
        self.assertEqual(items[0]["price"], 88)
        self.assertEqual(items[0]["changeJpy"], 30)
        self.assertEqual(items[0]["changePct"], 51.72)
        self.assertEqual(items[0]["volume"], 645600)
        self.assertEqual(items[0]["source"], server.YAHOO_FINANCE_GAINERS_URL)
        self.assertIsNone(items[0]["latestBarDate"])
        self.assertIsNone(items[0]["priceAsOfDate"])
        self.assertEqual(items[0]["sourceFetchedDate"], server.dt.datetime.now(server.JST).date().isoformat())
        self.assertIn("+09:00", items[0]["sourceFetchedAt"])

    def test_attach_candidate_quality_promotes_real_price_as_of_date(self):
        quality = {
            "qualityScore": 78,
            "dataQuality": {
                "score": 90,
                "source": "yfinance",
                "sourceOk": True,
                "priceOk": True,
                "latestBarDate": "2026-06-01",
                "latestBarAgeDays": 2,
                "bars": 120,
                "historyDepthOk": True,
                "minHistoryBars": 60,
            },
        }
        original_quality = server.quality_for_ticker
        try:
            server.quality_for_ticker = lambda ticker: quality
            enriched = server._attach_candidate_quality(
                [
                    {
                        "ticker": "6503.T",
                        "source": server.YAHOO_FINANCE_GAINERS_URL,
                        "sourceFetchedDate": "2026-06-03",
                        "latestBarDate": None,
                        "priceAsOfDate": None,
                    }
                ],
                limit=1,
            )
        finally:
            server.quality_for_ticker = original_quality

        self.assertEqual(enriched[0]["source"], server.YAHOO_FINANCE_GAINERS_URL)
        self.assertEqual(enriched[0]["sourceFetchedDate"], "2026-06-03")
        self.assertEqual(enriched[0]["latestBarDate"], "2026-06-01")
        self.assertEqual(enriched[0]["priceAsOfDate"], "2026-06-01")
        self.assertEqual(enriched[0]["priceSource"], "yfinance")
        self.assertEqual(enriched[0]["latestBarAgeDays"], 2)
        self.assertEqual(enriched[0]["dataQuality"]["latestBarDate"], "2026-06-01")

    def test_intraday_opportunity_rejects_unknown_price_freshness(self):
        item = {
            "ticker": "MISS.T",
            "name": "Missing Price Date",
            "price": 1000,
            "changePct": 2.0,
            "volumeRatio": 2.0,
            "surgeScore": 82,
            "candidateScore": 80,
            "overheatRisk": 10,
            "liquidityOk": True,
            "liquidityGrade": "tradable",
            "momentum5Pct": 4.0,
            "targetPrice": 1060,
            "stopLoss": 985,
            "candidateQuality": {
                "backtest": {
                    "sampleCount": 8,
                    "winRate": 62,
                    "riskAdjustedReturnPct": 0.8,
                    "profitFactor": 1.4,
                }
            },
            "material": {
                "tone": "positive",
                "materialScore": 0.8,
                "summary": "上方修正を発表",
                "freshnessVerdict": "fresh",
                "hasRecentImportant": True,
                "recentOfficialDisclosureCount": 1,
            },
            "marketRelative": {
                "available": True,
                "riskOff": False,
                "sectorTailwind": True,
                "sectorHeadwind": False,
                "relativeToMarketPct": 1.0,
                "summary": "市場平均 +0.20% / 上昇比率 60.0% / sector平均 +0.80%",
            },
        }

        opportunity = server._build_intraday_opportunity(item, budget_jpy=500_000)

        price_gate = next(gate for gate in opportunity["decisionAudit"]["gates"] if gate["id"] == "price_freshness")
        self.assertFalse(price_gate["ok"])
        self.assertFalse(opportunity["dataFreshness"]["priceOk"])
        self.assertEqual(opportunity["decisionAudit"]["verdict"], "REJECT")
        self.assertIn("最新価格日付が確認できない", opportunity["whyNotBuy"])

    def test_market_rankings_uses_yahoo_source_for_gainers(self):
        yahoo_item = {
            "ticker": "3624.T",
            "name": "Accelmark",
            "price": 88,
            "changePct": 51.72,
            "volume": 645600,
            "turnoverJpy": 56812800,
            "source": server.YAHOO_FINANCE_GAINERS_URL,
            "rank": 1,
        }
        stale_snapshot = {
            "source": "unit-test",
            "provider": "JPX listed issue master + yfinance daily prices",
            "rankings": {"gainers": [{"ticker": "6997.T", "price": 5620, "changePct": 10.63}]},
        }
        original_yahoo = server._yahoo_finance_gainers
        original_snapshot = server._load_market_snapshot
        original_material = server._attach_material_events
        try:
            server._yahoo_finance_gainers = lambda limit: [yahoo_item]
            server._load_market_snapshot = lambda: stale_snapshot
            server._attach_material_events = lambda items: items

            payload = server.market_rankings(kind="gainers", limit=1, budget=500_000)
        finally:
            server._yahoo_finance_gainers = original_yahoo
            server._load_market_snapshot = original_snapshot
            server._attach_material_events = original_material

        self.assertEqual(payload["provider"], "Yahoo Finance Japan gainers ranking")
        self.assertEqual(payload["items"][0]["ticker"], "3624.T")
        self.assertEqual(payload["items"][0]["source"], server.YAHOO_FINANCE_GAINERS_URL)

    def test_yahoo_gainers_items_follow_site_rank_while_preserving_candidate_rank(self):
        yahoo_items = [
            {
                "ticker": "SITE1.T",
                "name": "Site Rank One",
                "price": 100,
                "changePct": 20,
                "volume": 100_000,
                "turnoverJpy": 10_000_000,
                "source": server.YAHOO_FINANCE_GAINERS_URL,
                "rank": 1,
            },
            {
                "ticker": "SITE2.T",
                "name": "Internal Top",
                "price": 200,
                "changePct": 10,
                "volume": 200_000,
                "turnoverJpy": 40_000_000,
                "source": server.YAHOO_FINANCE_GAINERS_URL,
                "rank": 2,
            },
        ]
        original_yahoo = server._yahoo_finance_gainers
        original_snapshot = server._load_market_snapshot
        original_material = server._attach_material_events
        original_rank_refresh = server._rank_with_material_refresh
        original_quality = server.quality_for_ticker
        try:
            server._yahoo_finance_gainers = lambda limit: yahoo_items
            server._load_market_snapshot = lambda: None
            server._attach_material_events = lambda items: items
            server.quality_for_ticker = lambda ticker: None

            def fake_rank_refresh(items, budget_jpy, *, preserve_rank=False, refresh_limit=12):
                by_ticker = {item["ticker"]: item for item in items}
                return [
                    {
                        **by_ticker["SITE2.T"],
                        "siteRank": 2,
                        "candidateRank": 1,
                        "intradayOpportunity": {
                            "ticker": "SITE2.T",
                            "siteRank": 2,
                            "candidateRank": 1,
                            "decisionAudit": {"label": "条件通過"},
                            "tradeReadiness": "ready",
                            "positionSizingVerdict": "normal",
                            "advancedCrossEngineCheck": {"status": "aligned"},
                            "decisionAudit": {"verdict": "PASS"},
                            "shares": 100,
                            "budgetUsedJpy": 20000,
                            "expectedProfitJpy": 1000,
                            "opportunityScore": 1000,
                        },
                    },
                    {
                        **by_ticker["SITE1.T"],
                        "siteRank": 1,
                        "candidateRank": 2,
                        "intradayOpportunity": {
                            "ticker": "SITE1.T",
                            "siteRank": 1,
                            "candidateRank": 2,
                            "decisionAudit": {"label": "要確認"},
                            "tradeReadiness": "review",
                            "positionSizingVerdict": "reduced",
                            "shares": 100,
                            "budgetUsedJpy": 10000,
                            "expectedProfitJpy": 500,
                            "opportunityScore": 500,
                        },
                    },
                ]

            server._rank_with_material_refresh = fake_rank_refresh
            payload = server.market_rankings(kind="gainers", limit=2, budget=500_000)
        finally:
            server._yahoo_finance_gainers = original_yahoo
            server._load_market_snapshot = original_snapshot
            server._attach_material_events = original_material
            server._rank_with_material_refresh = original_rank_refresh
            server.quality_for_ticker = original_quality

        self.assertEqual([item["ticker"] for item in payload["items"]], ["SITE1.T", "SITE2.T"])
        self.assertEqual([item["siteRank"] for item in payload["items"]], [1, 2])
        self.assertEqual([item["candidateRank"] for item in payload["items"]], [2, 1])
        self.assertEqual(payload["bestOpportunity"]["ticker"], "SITE2.T")
        self.assertEqual(payload["bestOpportunity"]["siteRank"], 2)
        self.assertEqual(payload["bestOpportunity"]["candidateRank"], 1)

    def test_yahoo_gainers_returns_null_best_when_all_candidates_blocked_but_preserves_site_order(self):
        yahoo_items = [
            {
                "ticker": "SITE1.T",
                "name": "Site Rank One",
                "price": 100,
                "changePct": 20,
                "volume": 100_000,
                "turnoverJpy": 10_000_000,
                "source": server.YAHOO_FINANCE_GAINERS_URL,
                "rank": 1,
            },
            {
                "ticker": "SITE2.T",
                "name": "Site Rank Two",
                "price": 200,
                "changePct": 10,
                "volume": 200_000,
                "turnoverJpy": 40_000_000,
                "source": server.YAHOO_FINANCE_GAINERS_URL,
                "rank": 2,
            },
        ]
        original_yahoo = server._yahoo_finance_gainers
        original_snapshot = server._load_market_snapshot
        original_material = server._attach_material_events
        original_rank_refresh = server._rank_with_material_refresh
        original_quality = server.quality_for_ticker
        try:
            server._yahoo_finance_gainers = lambda limit: yahoo_items
            server._load_market_snapshot = lambda: None
            server._attach_material_events = lambda items: items
            server.quality_for_ticker = lambda ticker: None

            def fake_rank_refresh(items, budget_jpy, *, preserve_rank=False, refresh_limit=12):
                by_ticker = {item["ticker"]: item for item in items}
                return [
                    {
                        **by_ticker["SITE2.T"],
                        "siteRank": 2,
                        "candidateRank": 1,
                        "advancedCrossEngineCheck": {"status": "blocked"},
                        "intradayOpportunity": {
                            "ticker": "SITE2.T",
                            "siteRank": 2,
                            "candidateRank": 1,
                            "decisionAudit": {"label": "見送り", "verdict": "REVIEW"},
                            "tradeReadiness": "avoid",
                            "positionSizingVerdict": "skip",
                            "shares": 0,
                            "budgetUsedJpy": 0,
                            "expectedProfitJpy": 0,
                            "opportunityScore": 0,
                            "advancedCrossEngineCheck": {"status": "blocked"},
                        },
                    },
                    {
                        **by_ticker["SITE1.T"],
                        "siteRank": 1,
                        "candidateRank": 2,
                        "advancedCrossEngineCheck": {"status": "blocked"},
                        "intradayOpportunity": {
                            "ticker": "SITE1.T",
                            "siteRank": 1,
                            "candidateRank": 2,
                            "decisionAudit": {"label": "見送り", "verdict": "REVIEW"},
                            "tradeReadiness": "avoid",
                            "positionSizingVerdict": "skip",
                            "shares": 0,
                            "budgetUsedJpy": 0,
                            "expectedProfitJpy": 0,
                            "opportunityScore": 0,
                            "advancedCrossEngineCheck": {"status": "blocked"},
                        },
                    },
                ]

            server._rank_with_material_refresh = fake_rank_refresh
            payload = server.market_rankings(kind="gainers", limit=2, budget=500_000)
        finally:
            server._yahoo_finance_gainers = original_yahoo
            server._load_market_snapshot = original_snapshot
            server._attach_material_events = original_material
            server._rank_with_material_refresh = original_rank_refresh
            server.quality_for_ticker = original_quality

        self.assertIsNone(payload["bestOpportunity"])
        self.assertIsNotNone(payload["bestAvailableOpportunity"])
        self.assertEqual([item["ticker"] for item in payload["items"]], ["SITE1.T", "SITE2.T"])
        self.assertEqual([item["siteRank"] for item in payload["items"]], [1, 2])
        self.assertEqual(payload["items"][0]["advancedCrossEngineCheck"]["status"], "blocked")
        self.assertEqual(payload["items"][1]["intradayOpportunity"]["positionSizingVerdict"], "skip")

    def test_yahoo_gainers_use_full_market_context_for_risk_regime(self):
        yahoo_item = {
            "ticker": "3624.T",
            "name": "Accelmark",
            "price": 100,
            "changePct": 24.0,
            "volume": 1_000_000,
            "turnoverJpy": 100_000_000,
            "source": server.YAHOO_FINANCE_GAINERS_URL,
            "rank": 1,
        }
        market_snapshot = {
            "generatedAt": server.dt.datetime.now(server.JST).isoformat(),
            "source": "unit-test",
            "provider": "JPX listed issue master + yfinance daily prices",
            "items": [
                {"ticker": "AAA.T", "sector": "Tech", "changePct": -2.0, "price": 1000},
                {"ticker": "BBB.T", "sector": "Retail", "changePct": -1.5, "price": 1000},
                {"ticker": "CCC.T", "sector": "Foods", "changePct": -1.0, "price": 1000},
            ],
            "rankings": {},
        }
        original_yahoo = server._yahoo_finance_gainers
        original_snapshot = server._load_market_snapshot
        original_material = server._attach_material_events
        original_quality = server.quality_for_ticker
        original_universe = server.load_market_universe
        try:
            server._yahoo_finance_gainers = lambda limit: [yahoo_item]
            server._load_market_snapshot = lambda: market_snapshot
            server._attach_material_events = lambda items: items
            server.quality_for_ticker = lambda ticker: None
            server.load_market_universe = lambda: {
                "3624.T": {
                    "name": "Accelmark",
                    "market_section": "Growth Market",
                    "sector": "Tech",
                }
            }

            payload = server.market_rankings(kind="gainers", limit=1, budget=500_000)
        finally:
            server._yahoo_finance_gainers = original_yahoo
            server._load_market_snapshot = original_snapshot
            server._attach_material_events = original_material
            server.quality_for_ticker = original_quality
            server.load_market_universe = original_universe

        context = payload["items"][0]["marketRelative"]
        self.assertEqual(payload["marketContextProvider"], "JPX listed issue master + yfinance daily prices")
        self.assertEqual(payload["marketContextCount"], 3)
        self.assertTrue(payload["marketContextIntegrity"]["required"])
        self.assertTrue(payload["marketContextIntegrity"]["usable"])
        self.assertEqual(payload["marketContextIntegrity"]["reason"], "fresh_full_market_context")
        self.assertTrue(context["contextIntegrity"]["usable"])
        self.assertEqual(payload["items"][0]["sector"], "Tech")
        self.assertTrue(context["riskOff"])
        self.assertEqual(context["sector"], "Tech")
        self.assertLess(context["marketAvgChangePct"], 0)

    def test_yahoo_gainers_do_not_infer_market_regime_from_stale_context_or_gainers_only(self):
        yahoo_item = {
            "ticker": "3624.T",
            "name": "Accelmark",
            "price": 100,
            "changePct": 24.0,
            "volume": 1_000_000,
            "turnoverJpy": 100_000_000,
            "source": server.YAHOO_FINANCE_GAINERS_URL,
            "rank": 1,
        }
        stale_snapshot = {
            "generatedAt": "2026-01-01T00:00:00+00:00",
            "source": "unit-test",
            "provider": "stale full-market context",
            "items": [
                {"ticker": "AAA.T", "sector": "Tech", "changePct": -4.0, "price": 1000},
                {"ticker": "BBB.T", "sector": "Retail", "changePct": -3.0, "price": 1000},
            ],
            "rankings": {},
        }
        original_yahoo = server._yahoo_finance_gainers
        original_snapshot = server._load_market_snapshot
        original_material = server._attach_material_events
        original_quality = server.quality_for_ticker
        original_universe = server.load_market_universe
        try:
            server._yahoo_finance_gainers = lambda limit: [yahoo_item]
            server._load_market_snapshot = lambda: stale_snapshot
            server._attach_material_events = lambda items: items
            server.quality_for_ticker = lambda ticker: None
            server.load_market_universe = lambda: {
                "3624.T": {
                    "name": "Accelmark",
                    "market_section": "Growth Market",
                    "sector": "Tech",
                }
            }

            payload = server.market_rankings(kind="gainers", limit=1, budget=500_000)
        finally:
            server._yahoo_finance_gainers = original_yahoo
            server._load_market_snapshot = original_snapshot
            server._attach_material_events = original_material
            server.quality_for_ticker = original_quality
            server.load_market_universe = original_universe

        context = payload["items"][0]["marketRelative"]
        self.assertTrue(payload["marketContextStale"])
        self.assertEqual(payload["marketContextCount"], 0)
        self.assertTrue(payload["marketContextIntegrity"]["required"])
        self.assertFalse(payload["marketContextIntegrity"]["usable"])
        self.assertEqual(payload["marketContextIntegrity"]["reason"], "stale_snapshot")
        self.assertFalse(context["contextIntegrity"]["usable"])
        self.assertFalse(context["available"])
        self.assertEqual(context["tone"], "UNKNOWN")
        audit_gates = payload["items"][0]["intradayOpportunity"]["decisionAudit"]["gates"]
        market_gate = next(gate for gate in audit_gates if gate["id"] == "market_regime")
        self.assertFalse(market_gate["ok"])
        self.assertIn("日前", market_gate["detail"])
        self.assertIn("地合いを判断しない", market_gate["detail"])

    def test_market_rankings_enriches_legacy_snapshot_liquidity_quality(self):
        original_load_snapshot = server._load_market_snapshot
        original_market_status = server.tokyo_market_status
        original_material = server._attach_material_events
        original_quality = server.quality_for_ticker
        try:
            server.tokyo_market_status = lambda: {"isOpen": True, "phase": "REGULAR_SESSION", "label": "取引中", "message": "open"}
            server._attach_material_events = lambda items: items
            server.quality_for_ticker = lambda ticker: {
                "qualityScore": 64,
                "metrics": {},
                "backtest": {
                    "sampleCount": 5,
                    "winRate": 60,
                    "riskAdjustedReturnPct": 0.4,
                    "profitFactor": 1.4,
                },
                "gates": [],
                "warnings": [],
            }
            server._load_market_snapshot = lambda: {
                "source": "unit-test",
                "provider": "legacy snapshot",
                "universeCount": 2,
                "analyzedCount": 2,
                "rankings": {
                    "surge": [
                        {
                            "ticker": "THIN.T",
                            "name": "Thin Spike",
                            "price": 128,
                            "changePct": 10,
                            "volume": 45_000,
                            "turnoverJpy": 5_760_000,
                            "volumeRatio": 0.64,
                            "surgeScore": 90,
                            "overheatRisk": 5,
                            "candidateScore": 70,
                        }
                    ]
                },
            }

            payload = server.market_rankings(kind="surge", limit=1, budget=500_000)
        finally:
            server._load_market_snapshot = original_load_snapshot
            server.tokyo_market_status = original_market_status
            server._attach_material_events = original_material
            server.quality_for_ticker = original_quality

        item = payload["items"][0]
        self.assertEqual(item["liquidityGrade"], "thin")
        self.assertFalse(item["liquidityOk"])
        self.assertFalse(item["volumeConfirmed"])
        self.assertEqual(item["candidateQuality"]["backtest"]["riskAdjustedReturnPct"], 0.4)
        self.assertLess(item["surgeScore"], 90)
        self.assertGreater(item["overheatRisk"], 5)
        self.assertIn("薄商い", item["surgeFlags"])

    def test_surge_profile_penalizes_overheated_extension(self):
        closes = [100 + index * 0.2 for index in range(80)] + [135, 145, 160]
        profile = server._surge_profile(
            price=160,
            closes=closes,
            volume=1000000,
            avg_vol20=200000,
            turnover=160000000,
            change_pct=18,
            momentum5=28,
            momentum20=45,
            rsi=88,
        )

        self.assertEqual(profile["surgeStage"], "過熱注意")
        self.assertGreaterEqual(profile["overheatRisk"], 58)

    def test_surge_profile_penalizes_thin_liquidity_spikes(self):
        closes = [100 + index * 0.15 for index in range(80)] + [116, 128]
        liquid = server._surge_profile(
            price=128,
            closes=closes,
            volume=2_000_000,
            avg_vol20=650_000,
            turnover=256_000_000,
            change_pct=10.3,
            momentum5=18,
            momentum20=24,
            rsi=74,
        )
        thin = server._surge_profile(
            price=128,
            closes=closes,
            volume=45_000,
            avg_vol20=70_000,
            turnover=5_760_000,
            change_pct=10.3,
            momentum5=18,
            momentum20=24,
            rsi=74,
        )

        self.assertTrue(liquid["liquidityOk"])
        self.assertFalse(thin["liquidityOk"])
        self.assertEqual(thin["liquidityGrade"], "thin")
        self.assertGreater(liquid["surgeScore"], thin["surgeScore"])
        self.assertGreater(thin["overheatRisk"], liquid["overheatRisk"])
        self.assertIn("薄商い", thin["surgeFlags"])

    def test_execution_plan_reprices_far_limit_for_daytrade(self):
        plan = server.TechnicalAnalyzer.build_execution_plan(
            raw_signal="BUY",
            confidence=70,
            current_price=3048,
            buy_limit=2698,
            sell_limit=3165,
            stop_loss=2644,
        )

        self.assertEqual(plan["decision"], "REPRICE_FOR_DAYTRADE")
        self.assertLess(plan["entryGapPct"], -3)

    def test_execution_plan_marks_near_limit_as_daytrade_entry_candidate(self):
        plan = server.TechnicalAnalyzer.build_execution_plan(
            raw_signal="BUY",
            confidence=70,
            current_price=3048,
            buy_limit=3054,
            sell_limit=3180,
            stop_loss=2990,
        )

        self.assertEqual(plan["decision"], "DAYTRADE_ENTRY_OK")
        self.assertTrue(plan["marketAllowed"])

    def test_ai_fund_desk_does_not_draft_order_for_unverified_best_available_candidate(self):
        server.MARKET_REVIEW_CACHE.clear()
        opportunity = {
            "ticker": "FALL.T",
            "name": "Fallback Candidate",
            "entryPrice": 1234,
            "targetPrice": 1290,
            "stopLoss": 1210,
            "shares": 100,
            "budgetUsedJpy": 123400,
            "targetProfitJpy": 5600,
            "maxLossJpy": 2400,
            "confidencePct": 64,
            "expectedProfitJpy": 3600,
            "opportunityScore": 3600,
            "tradeReadiness": "review",
            "positionSizingVerdict": "reduced",
            "decisionAudit": {"verdict": "REVIEW", "auditScore": 72},
            "advancedCrossEngineCheck": {"status": "blocked"},
            "whyBuy": ["ranking data points to FALL.T"],
            "whyNotBuy": ["cross-engine check is blocked"],
            "invalidConditions": ["manual confirmation required"],
        }
        ranking_payload = {
            "generatedAt": "2026-06-06T00:00:00+00:00",
            "bestOpportunity": None,
            "bestAvailableOpportunity": opportunity,
            "items": [
                {"ticker": "FALL.T", "name": "Fallback Candidate", "intradayOpportunity": opportunity},
            ],
        }

        with patch.object(server, "market_rankings", return_value=ranking_payload), patch.object(
            server,
            "get_portfolio",
            return_value={"cash": 500000, "holdings": [], "marketContext": {}},
        ):
            desk_payload = server.ai_fund_desk(budget=500_000)

        self.assertIsNone(desk_payload["draftOrder"])
        self.assertEqual(desk_payload["summary"]["state"], "WAIT")

    def test_daytrade_scan_does_not_emit_unverified_ranking_candidate(self):
        server.MARKET_REVIEW_CACHE.clear()
        opportunity = {
            "ticker": "LIVE.T",
            "name": "Live Ranking Candidate",
            "entryPrice": 1234,
            "targetPrice": 1290,
            "stopLoss": 1210,
            "shares": 100,
            "confidencePct": 70,
            "changePct": 3.4,
        }
        ranking_payload = {
            "generatedAt": "2026-06-06T00:00:00+00:00",
            "bestOpportunity": None,
            "bestAvailableOpportunity": opportunity,
            "items": [
                {"ticker": "LIVE.T", "name": "Live Ranking Candidate", "intradayOpportunity": opportunity},
            ],
        }

        with patch.object(server, "market_rankings", return_value=ranking_payload):
            payload = server.scan_daytrade_signals()

        self.assertEqual(payload["source"], "NO_VERIFIED_RANKING_SIGNAL")
        self.assertEqual(payload["signals"], [])

    def test_ai_fund_desk_returns_draft_without_live_orders(self):
        opportunity = {
            "ticker": "6503.T",
            "name": "Mitsubishi Electric",
            "entryPrice": 2500,
            "targetPrice": 2600,
            "stopLoss": 2460,
            "shares": 100,
            "budgetUsedJpy": 250000,
            "targetProfitJpy": 10000,
            "maxLossJpy": 4000,
            "confidencePct": 62,
            "expectedProfitJpy": 6200,
            "whyBuy": ["trend ok"],
            "whyNotBuy": ["check news"],
            "invalidConditions": ["break stop"],
            "dataFreshness": {"latestBarDate": "2026-05-29"},
        }

        payload = server._ai_fund_desk_payload(
            best_opportunity=opportunity,
            ranked_items=[{"ticker": "6503.T", "name": "Mitsubishi Electric", "surgeScore": 70}],
            portfolio={"cash": 500000, "holdings": [{"ticker": "7203.T"}], "marketContext": {}},
            generated_at="2026-05-31T00:00:00+00:00",
            budget_jpy=500000,
        )

        self.assertFalse(payload["liveBrokerOrdersEnabled"])
        self.assertEqual(payload["summary"]["state"], "APPROVAL_REQUIRED")
        self.assertEqual(payload["draftOrder"]["status"], "DRAFT_ONLY")
        self.assertIn("注文は作成しません", payload["draftOrder"]["brokerInstruction"])
        self.assertTrue(payload["guardrails"][0]["ok"])
        self.assertEqual(
            [lane["label"] for lane in payload["workflow"]],
            ["候補とシグナルの調査", "手入力計画の下書き", "人による承認確認", "リスク監査記録"],
        )
        self.assertEqual(
            [guardrail["label"] for guardrail in payload["guardrails"]],
            ["実注文機能は無効", "人による承認が必要", "保有集中の確認", "最大損失の試算"],
        )
        self.assertIn("学習・検証用", payload["disclaimer"])

    def test_ai_fund_desk_does_not_create_draft_for_zero_share_candidate(self):
        opportunity = {
            "ticker": "ZERO.T",
            "name": "Zero Share",
            "entryPrice": 1000000,
            "targetPrice": 1010000,
            "stopLoss": 990000,
            "shares": 0,
            "budgetUsedJpy": 0,
            "targetProfitJpy": 0,
            "maxLossJpy": 0,
            "confidencePct": 70,
            "expectedProfitJpy": 0,
            "opportunityScore": 0,
            "tradeReadiness": "avoid",
            "positionSizingVerdict": "skip",
            "whyBuy": [],
            "whyNotBuy": ["zero shares"],
            "invalidConditions": ["zero shares"],
        }

        payload = server._ai_fund_desk_payload(
            best_opportunity=opportunity,
            ranked_items=[{"ticker": "ZERO.T", "name": "Zero Share", "surgeScore": 70}],
            portfolio={"cash": 500000, "holdings": [], "marketContext": {}},
            generated_at="2026-05-31T00:00:00+00:00",
            budget_jpy=500000,
        )

        self.assertEqual(payload["summary"]["state"], "RESEARCH_ONLY")
        self.assertIsNone(payload["draftOrder"])
        self.assertFalse(next(item for item in payload["guardrails"] if item["label"] == "人による承認が必要")["ok"])

    def test_ai_fund_endpoint_uses_market_review_candidate(self):
        opportunity = {
            "ticker": "4179.T",
            "name": "ジーネクスト",
            "entryPrice": 478,
            "targetPrice": 516,
            "stopLoss": 469,
            "shares": 261,
            "budgetUsedJpy": 124758,
            "targetProfitJpy": 9918,
            "maxLossJpy": 2246,
            "confidencePct": 69.4,
            "expectedProfitJpy": 6927,
            "opportunityScore": 6927,
            "tradeReadiness": "ready",
            "positionSizingVerdict": "normal",
            "decisionAudit": {"verdict": "PASS"},
            "advancedCrossEngineCheck": {"status": "aligned"},
            "whyBuy": ["ranking aligned"],
            "whyNotBuy": ["manual check"],
            "invalidConditions": ["break stop"],
        }

        with patch.object(server, "_market_review_candidates_for_budget", return_value=([
            {"ticker": "4179.T", "name": "ジーネクスト", "intradayOpportunity": opportunity}
        ], opportunity, opportunity, "2026-06-06T00:00:00+00:00")), patch.object(
            server,
            "get_portfolio",
            return_value={"cash": 0, "holdings": [], "marketContext": {}},
        ):
            payload = server.ai_fund_desk()

        self.assertEqual(payload["summary"]["state"], "APPROVAL_REQUIRED")
        self.assertIn("4179.T", payload["summary"]["headline"])
        self.assertEqual(payload["draftOrder"]["ticker"], "4179.T")
        self.assertEqual(payload["draftOrder"]["entryPrice"], 478)

    def test_daytrade_scan_uses_ranking_aligned_prices(self):
        opportunity = {
            "ticker": "4179.T",
            "name": "ジーネクスト",
            "entryPrice": 478,
            "targetPrice": 516,
            "stopLoss": 469,
            "shares": 261,
            "budgetUsedJpy": 124758,
            "targetProfitJpy": 9918,
            "expectedProfitJpy": 6927,
            "opportunityScore": 6927,
            "confidencePct": 69.4,
            "changePct": 3.8,
            "material": {"hasNegative": False},
            "tradeReadiness": "ready",
            "positionSizingVerdict": "normal",
            "decisionAudit": {"verdict": "PASS"},
            "advancedCrossEngineCheck": {"status": "aligned"},
        }

        with patch.object(server, "_market_review_candidates_for_budget", return_value=([
            {"ticker": "4179.T", "name": "ジーネクスト", "candidateRank": 1, "intradayOpportunity": opportunity}
        ], opportunity, opportunity, "2026-06-06T00:00:00+00:00")):
            payload = server.scan_daytrade_signals()

        self.assertEqual(payload["source"], "LOCAL_PAPER_SIMULATION_RANKING_ALIGNED")
        self.assertEqual(payload["signals"][0]["ticker"], "4179.T")
        self.assertEqual(payload["signals"][0]["limitPrice"], 478)
        self.assertEqual(payload["signals"][0]["sourceOpportunityPrice"], 478)
        self.assertNotEqual(payload["signals"][0]["limitPrice"], 2479)

    def test_entry_validation_rejects_subthreshold_gap(self):
        board = BoardSnapshot("4980.T", 2720, 2721, 10000, 5000, 0.5, 2720, 2720)

        valid, reasons = validate_entry(
            gap_pct=2.9,
            board=board,
            has_news=True,
            atr_pct=2,
            volume_rank=1,
            ml_probability=0.7,
            minutes_after_open=1,
        )

        self.assertFalse(valid)
        self.assertIn("gap_abs_below_3.0pct", reasons)

    def test_ready_ticket_has_risk_and_round_lot_size(self):
        ticket = build_signal_ticket(
            ticker="4980.T",
            name="Dexerials",
            gap_pct=3.2,
            board=BoardSnapshot("4980.T", 2720, 2721, 10000, 5000, 0.5, 2720, 2720),
            has_news=True,
            atr_pct=2,
            volume_rank=1,
            ml_probability=0.7,
            minutes_after_open=1,
        )

        self.assertEqual(ticket["state"], "READY")
        self.assertGreater(ticket["riskJpy"], 0)
        self.assertEqual(ticket["shares"] % 100, 0)


if __name__ == "__main__":
    unittest.main()
