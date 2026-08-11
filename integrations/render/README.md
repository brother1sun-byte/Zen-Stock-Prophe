# Render

## Evidence

`render.yaml` defines the `zen-stock-prophet-pro` Docker web service, `/api/health` health check, and non-secret runtime defaults. `docs/render-deployment.md` contains the existing deployment procedure.

## Contract

- Build from the repository `Dockerfile`.
- Require repository checks to pass before auto-deploy eligibility (`autoDeployTrigger: checksPass`).
- Keep `/api/health` returning `manual_decision_support` and live orders disabled.
- Treat `/tmp/simulator.db` as ephemeral Render storage unless a reviewed persistence design replaces it.

## Safety

Changing local configuration does not authorize a deploy. Environment/credential changes, service operations, production-data operations, and rollback execution require `HUMAN_APPROVAL_REQUIRED`.
