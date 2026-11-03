# Verification record

The current implementation has **24 passing Python regression tests** and **8 frontend regression tests**, plus Python lint/format checks and frontend syntax/format checks in [GitHub Actions](../.github/workflows/checks.yml).

## Automated coverage

| Area                | Evidence                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| PDF input           | Real text-PDF extraction, malformed/empty input, file limits                                           |
| Request limits      | Declared, chunked, and misleading-length uploads rejected before parsing; bounded body replay          |
| Indexing            | Single embedding pass, duplicate reuse, metadata-only digest lookup                                    |
| Persistence         | Documents survive application restart                                                                  |
| Isolation           | Other browser workspaces cannot list, read, or delete the manual                                       |
| Concurrency         | Duplicate writers share one document; competing writers cannot exceed the quota                        |
| Deletion            | Removing a document or library removes indexed chunks                                                  |
| Answer handling     | Source metadata, invalid citation rejection, insufficient-evidence result                              |
| Failures            | Provider errors leave no partial document                                                              |
| Browser protections | Cookie attributes/preservation, Origin and Host checks, request limiting                               |
| Product routes      | Both pages and linked assets serve successfully; all three sample questions return their expected page |
| Credentials         | Known historical credential locations have no tracked API-key literals                                 |

Tests generate their own PDFs and replace the AI provider. They require no live key and make no billable API calls.

## Manual browser checks

The desktop and mobile layouts, demo question/citation flow, question-field keyboard focus, and cancelling/reselecting the same PDF were checked in the local browser. The README screenshot shows the actual local application, not an AI-generated interface mockup.

## What this does not establish

Passing software tests does not measure industrial troubleshooting accuracy. A representative retrieval/answer evaluation set, live-provider smoke test, real-device field study, and shared-deployment security review remain future work. The demo returns illustrative excerpts; it is not a measured AI evaluation.

Run the checks using [the contributor guide](../CONTRIBUTING.md).

## Distribution check

CI builds the Python wheel and runs `scripts/check_package.py` against its extracted contents. This verifies that both pages, shared frontend modules, fonts, original branding, team imagery, and the demo API work independently of an editable source checkout. Runtime secrets and database files are rejected if found in the archive.

## Frontend regression coverage

`npm test` uses Node's built-in test runner with minimal element/media-query doubles. It checks that starting a new demo request clears previous evidence and highlighting, that request failures and late responses cannot restore stale evidence, and that source reveal follows the product/workspace CSS breakpoints and the reduced-motion preference. These state/callback tests complement the manual browser layout checks; they do not emulate browser layout.

The static traversal regression uses an encoded separator that survives HTTPX normalization and targets the existing `mantis/api.py` file outside the web root.
