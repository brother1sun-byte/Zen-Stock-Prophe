# Render deployment

Zen Stock Prophet Pro can run as one Render Web Service. The Vite frontend is
built into `dist/`, and FastAPI serves both the UI and `/api` from the same
origin.

## Deployment settings

- Repository: `brother1sun-byte/Zen-Stock-Prophe`
- Branch: `master`
- Runtime: Docker
- Plan: Free
- Health check: `/api/health`

The repository default branch contains the verified personal-use v1.2
application and is the deployment source of truth.

## Secrets

Do not commit `.env` or `.env.local`. Add optional EDINET and J-Quants values
only in Render's Environment settings. A deployment without those values remains
usable and reports the corresponding API sources as not configured.

## Free-plan limits

The free service can sleep while idle, so the first request after inactivity can
take longer. Its filesystem is ephemeral. Simulator records stored in SQLite can
reset after a restart or redeploy; keep local JSON/CSV backups for durable review
history.

This deployment remains manual decision support only. It does not place orders,
connect to a broker, or enable automated trading.
