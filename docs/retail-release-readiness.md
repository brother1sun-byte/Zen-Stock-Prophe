# Zen Stock Prophet Pro Retail Readiness Goal

## Capability

Zen Stock Prophet Pro is a local-only Japanese stock screening simulator for watchlist discovery, technical review, and paper portfolio practice. The product can support paid distribution only as a simulation and decision-support tool, not as investment advice or broker order execution.

## Fixed Boundaries

- Live broker order placement is disabled.
- Rakuten Securities, MarketSpeed RSS, and RPA order-entry workflows are not part of the product scope.
- Short-term signal features are local paper simulations only and do not create broker order artifacts.
- The default API host is `127.0.0.1`.
- The default frontend host is `127.0.0.1`.
- CORS is restricted to local frontend origins by default.
- AI auto-trade is disabled unless `ZEN_ENABLE_SIM_AUTO_TRADE=1` is explicitly set for a local simulation session.
- Screening output must distinguish technical signal from executable action. If the market price is too far from the limit price, the UI must say `WAIT`, not `BUY`.

## Sale-Blocking Issues Closed

- Watchlist collapse fixed: strict treasure winners no longer hide review/prefilter candidates.
- Decision board added: users can see action, limit meaning, target, stop, position-size estimate, and do-not-buy condition.
- Generic education panels removed from the primary UI.
- Local-only safety banner added.
- CORS wildcard removed.
- Backend host default changed from external-facing `0.0.0.0` to `127.0.0.1`.
- Frontend dev/preview host defaults changed to `127.0.0.1`.
- `/api/health` and `/api/product-safety` added for packaging and support checks.
- Simulation trade endpoints now validate ticker/share inputs and return local-simulator metadata.
- Root generated logs/screenshots are ignored and should not be packaged.

## Remaining Before Real Commercial Release

- Legal review of product claims, disclaimers, and jurisdiction-specific marketing language.
- Privacy policy and terms of use.
- Signed installer or packaged desktop shell.
- Versioned release notes and support contact.
- Dependency vulnerability review on the release machine.
- A paid-user update path.
- Clear data-provider terms review for any redistributed market data.

## Verification Commands

```powershell
python -m py_compile backend\server.py backend\daytrade_engine.py backend\daytrade_autopilot.py backend\jquants_bridge.py
python -m unittest discover -s tests
npm run lint
npm run build
```
