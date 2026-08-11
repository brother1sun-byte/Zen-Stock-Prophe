# Docker

## Evidence and architecture

`Dockerfile` uses a Node 22 Alpine stage to run `npm ci` and `npm run build`, then copies `dist/` and `backend/` into a Python 3.12 slim runtime. The runtime installs `requirements-render.txt`, creates UID 10001, switches to the non-root user, and starts Uvicorn.

## Validation

```powershell
docker build -t investment-simulator-pro:validation .
```

CI performs this build after the full repository validator. Do not embed `.env`, credentials, the local SQLite database, test artifacts, or logs in the image; `.dockerignore` and `.gitignore` remain part of the boundary.

Image publication, registry login, container deployment, and production environment changes require explicit human approval.
