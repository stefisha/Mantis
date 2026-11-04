# Verification record

The current implementation has **42 passing Python regression tests** and **15 frontend regression tests**, plus Python lint/format checks and frontend syntax/format checks in [GitHub Actions](../.github/workflows/checks.yml).

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

The unified app was checked at 1280px and 390px: scripted spindle and alarm-photo examples, inline source expansion, keyboard submission, and no horizontal overflow. An isolated temporary server with a fake provider exercised the actual PDF upload, active-manual selection, source-backed question and follow-up, original PDF link, live photo request path, and manual drawer. That check made no external AI calls. The landing page uses crisp HTML/CSS instead of a screenshot preview. Its black hero, with a gradient confined to “ON AUTOPILOT.”, fills the first screen at 1440×900 and 390×844; the workflow and example follow below. Section anchors clear the sticky header and neither layout overflows horizontally. README images show the actual local app/example.

## What this does not establish

Passing software tests does not measure industrial troubleshooting accuracy. A representative retrieval/answer evaluation set, live-provider smoke test, real-device field study, and shared-deployment security review remain future work. The demo returns illustrative excerpts; it is not a measured AI evaluation.

Run the checks using [the contributor guide](../CONTRIBUTING.md).

## Distribution check

CI builds the Python wheel and runs `scripts/check_package.py` against its extracted contents. This verifies that both pages, shared frontend modules, fonts, original branding, team imagery, and the demo API work independently of an editable source checkout. Runtime secrets and database files are rejected if found in the archive.

## Frontend regression coverage

`npm test` exercises the request controller and example boundaries directly: the last four successful text exchanges, current-message-only images, stale response suppression, abort/reset behavior, retries, manual/mode context resets, and zero provider calls for examples. It does not emulate browser layout.

The new API regressions verify photo validation, extraction-to-retrieval flow, bounded/role-limited history, missing-key behavior, question request limits, and rejection of fabricated citations when no manual exists. Software test success does not validate real model image-reading accuracy.

The follow-up visual correction restores the black landing palette with gradient text only on “ON AUTOPILOT.” and removes dashboard-style chat headers. The chat follows the original recording with a narrow logo rail, compact replies, orange user messages, a bottom Send composer, a small manual-upload action, and restored sample inputs.

Chrome previously reused an old stylesheet/module against new HTML, causing a null-element script error and an unstyled layout. After a normal reload, the corrected page rendered correctly with no application console error. CSS and JS modules now share a content-based revision URL; HTML/static responses require revalidation. Regressions cover imported-module changes, cache headers/304 responses, and versioned static-path traversal.

Landing examples now use the same scenario data as the app. Their native source disclosures expand inline; each question appends its own answer and source notes, while earlier exchanges remain available by scrolling. The landing page’s “Try an example” action scrolls to that section rather than opening the full app.

Final layout checks verified that the landing demo keeps all three tested exchanges (six messages) in one 480px scrollable transcript. Suggested questions sit below it. The real app starts with an upload prompt; its upload action and helper text are inside the same bottom-bar border on desktop and mobile, with no horizontal overflow or application console error.

Saved-chat tests cover persistence, workspace isolation, deletion, revision conflicts, immutable manual/mode, request/message/chat quotas, exclusion of personal photo bytes, and restoring bounded context while invalidating an older pending reply.

Browser checks for Your chats verified automatic save, reopening after a fresh page load, continuing a restored conversation, separate manuals/chats drawers, and mobile access without horizontal overflow or application console errors.
