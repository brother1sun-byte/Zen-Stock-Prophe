# GitHub

## Evidence

- The project is a Git repository.
- `.github/workflows/validate.yml` validates pushes and pull requests targeting `main` or `master`.

## Workflow

The workflow uses Node 22 and Python 3.12, installs the npm lockfile and `requirements-test.txt`, installs Playwright Chromium, calls the repository-owned full validator, and builds the Docker image. In GitHub Actions, the text-hygiene validator scans every tracked file so multi-commit pushes cannot escape the check.

`validators/validate_all.py` is the validation source of truth; CI must not duplicate or weaken its gates.

## Safety

The workflow requests read-only repository contents permission and does not push, publish, deploy, mutate external services, or read deployment credentials. GitHub comments, PR creation, merging, and pushes require explicit user authorization.
