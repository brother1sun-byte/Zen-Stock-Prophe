# Project Patterns

These notes point to working repository code; the linked source remains authoritative. Before new implementation, search nearby code and then use the closest pattern below. Do not copy large snippets into a second implementation.

| Area | Pattern | Source of truth |
| --- | --- | --- |
| API | `api/README.md` | `src/api/apiClient.js`, FastAPI routes in `backend/server.py` |
| Components | `components/README.md` | focused files in `src/components/` |
| Frontend data loading | `frontend-data-loading/README.md` | `src/hooks/useMarketData.js` |
| Database | `database/README.md` | `backend/portfolio_api_service.py` |
| Testing | `testing/README.md` | `tests/`, `playwright.config.js` |
| Error handling | `error-handling/README.md` | API client, hooks, FastAPI exception mapping |
| Security and safety | `security/README.md` | env ignore/load, CORS, broker-disabled endpoints |

There is no `auth/` pattern because the repository has no authentication implementation. There is no general `logging/` pattern because the current `agent_logs` audit messages are not a complete application-logging standard.
