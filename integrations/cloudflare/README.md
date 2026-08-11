# Cloudflare Temporary Development Share

## Evidence

`package.json` defines `npm run share` as `cloudflared tunnel --url http://localhost:5174`. Vite allows `trycloudflare.com` development hosts and proxies `/api` to the local FastAPI process.

## Intended use

This is an optional, temporary development preview of the locally running UI. It is not the production deployment path and does not configure a Cloudflare account, DNS, persistent tunnel, or custom domain.

Starting a public tunnel exposes a local service externally. Run it only on an explicit user request, verify no secrets or sensitive local data are visible, and stop it after the review. Automated validators and CI must not start it.
