# Contributing to Mantis

Start with the [quick start](README.md#quick-start). Keep changes focused and explain the user-visible behavior, rationale, and validation in the pull request.

## Local checks

After installing the pinned Python dependencies:

```sh
npm ci --ignore-scripts
pytest -q
ruff check app.py mantis tests scripts
ruff format --check app.py mantis tests scripts
npm run check
npm run format:check
```

To format changed code:

```sh
ruff format app.py mantis tests scripts
npm run format
```

Tests use generated PDFs and a fake provider. Do not use real manuals, paid API calls, or committed credentials in automated tests. Cover behavior that can regress, especially workspace isolation, persistence, concurrent writes, upload limits, and source validation.

## Interface changes

Follow the charcoal/orange interface and bundled font licenses. Shared design tokens live in `mantis/web/css/tokens.css`; product and workspace pages have separate CSS and ES modules in `mantis/web/`. Both use `mantis/web/js/api.js`. Check desktop and mobile layouts, keyboard focus, loading/error states, and citation interactions. Render document excerpts as text, never as HTML. Keep illustrative demo content clearly labeled.

## Documentation changes

Keep the README concise and link deeper implementation details from `docs/`. Distinguish tested behavior from planned features and avoid unsupported accuracy, uptime, savings, or deployment claims. Screenshots should show the actual application with no credentials or private manual contents.

## Reporting an issue

Include the expected behavior, actual behavior, reproduction steps, environment, and relevant error message. Redact keys and private document contents. A small synthetic PDF is more useful than a confidential manual.

## Check the built package

From a checkout with the development dependencies installed:

```sh
python -m pip wheel . --no-deps --wheel-dir dist
python scripts/check_package.py dist/mantis_maintenance-0.2.0-py3-none-any.whl
```

The filename reflects the current version in `pyproject.toml`; use the corresponding wheel after a version change. The script extracts the wheel into a temporary directory and verifies that imports, both pages, frontend assets, and the demo API work without relying on the editable checkout. It rejects packaged `.env` and SQLite database files.

## Review the complete user journey

Check `/`, switch the landing demo example, follow a workspace link, and check `/workspace#demo`. In the workspace, exercise manual selection, upload/error states, question/source inspection, library search, and deletion using synthetic data. Check a phone-sized layout and keyboard focus. Provider-backed behavior needs a separate live-service check; automated tests use a fake provider.
