# Contributing to Mantis

Start with the [quick start](README.md#quick-start). Keep changes focused and explain the user-visible behavior, rationale, and validation in the pull request.

## Local checks

After installing the pinned Python dependencies:

```sh
npm ci --ignore-scripts
pytest -q
ruff check app.py report_rag.py mantis tests
ruff format --check app.py report_rag.py mantis tests
npm run check
npm run format:check
```

To format changed code:

```sh
ruff format app.py report_rag.py mantis tests
npm run format
```

Tests use generated PDFs and a fake provider. Do not use real manuals, paid API calls, or committed credentials in automated tests. Cover behavior that can regress, especially workspace isolation, persistence, concurrent writes, upload limits, and source validation.

## Interface changes

Follow the existing black/orange identity and bundled font licenses. Check desktop and mobile layouts, keyboard focus, loading/error states, and citation interactions. Render document excerpts as text, never as HTML. Keep illustrative demo content clearly labeled.

## Documentation changes

Keep the README concise and link deeper implementation details from `docs/`. Distinguish tested behavior from planned features and avoid unsupported accuracy, uptime, savings, or deployment claims. Screenshots should show the actual application with no credentials or private manual contents.

## Reporting an issue

Include the expected behavior, actual behavior, reproduction steps, environment, and relevant error message. Redact keys and private document contents. A small synthetic PDF is more useful than a confidential manual.
