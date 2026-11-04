# API usage

The frontend and API share an origin. The application factory is `mantis.api.create_app`; the packaged ASGI instance is `mantis.main:app`.

## Workspace identity

The server issues an opaque HttpOnly workspace cookie. API clients must retain that cookie across requests to access the same manuals. The workspace identifier is never passed in request bodies. Treat a saved cookie jar as an access credential and keep it outside tracked source.

The following local example stores its cookie in the ignored `data/` directory:

```sh
mkdir -p data
curl --cookie-jar data/dev.cookies http://127.0.0.1:8000/api/health
curl --cookie data/dev.cookies http://127.0.0.1:8000/api/documents
```

The key remains on the server in `.env`; it is not sent from the browser or supplied in these API payloads.

## Routes

| Method | Route                      | Behavior                                                                                                 |
| ------ | -------------------------- | -------------------------------------------------------------------------------------------------------- |
| GET    | `/api/health`              | Returns `status`, key-presence flag `configured`, and application `version`                              |
| GET    | `/api/documents`           | Lists metadata for this workspace's manuals                                                              |
| POST   | `/api/documents`           | Multipart fields: PDF `file` and optional `equipment`; returns indexed document metadata and `duplicate` |
| DELETE | `/api/documents`           | Removes this workspace's documents and indexed chunks                                                    |
| DELETE | `/api/documents/{id}`      | Removes one workspace-owned manual and its chunks                                                        |
| GET    | `/api/documents/{id}/file` | Returns the original PDF for a workspace-owned manual                                                    |
| POST   | `/api/questions`           | Returns an answer, source passages, and demo/evidence flags                                              |

Full request/response schemas are available at `/openapi.json`. The legacy prototype's `/upload-pdf`, `/ask-question`, and `/clear-pdfs` routes are not maintained endpoints.

## Try an illustrative question

This request makes no AI calls:

```sh
curl --cookie data/dev.cookies \
  --header 'Content-Type: application/json' \
  --data '{"question":"What should I check for excessive vibration?","demo":true}' \
  http://127.0.0.1:8000/api/questions
```

Real questions use `demo: false` and the selected manual's `document_id`, returned by the upload/list endpoints. Optional `history` contains up to eight text turns (`role`: `user` or `assistant`, `content`: up to 10,000 characters). The browser sends the last four successful exchanges and resets them when the manual or mode changes. History is context, not evidence. Responses contain `answer`, `sources`, `insufficient_evidence`, and `demo`. A source contains its document identifier, name, page, and text.

Optional `image` is a base64 data URL for one valid JPEG, PNG, or WebP image up to 8 MB / 20 megapixels; animated images and remote URLs are rejected. Question request bodies are limited to 12 MB before JSON parsing. The image is sent to the provider for visible observations/transcription, which inform manual retrieval. Without a manual, an image (or follow-up history) can request observations/context collection, with `insufficient_evidence: true` and no citations. Old images are not part of text history. Photo files are not stored by Mantis; completed text exchanges and sources can be saved through the chat-history endpoints. The legacy `demo: true` API still returns training-manual excerpts and rejects attached images; the app’s example conversation runs locally in the same chat UI.

For real PDF uploads, configure the provider first. Uploaded text is sent for embedding, and retrieved passages/questions, recent text history, and photo observations are sent for answer generation. Duplicate detection can reuse an existing document; a new upload can incur provider usage.

## Expected errors

| Status | Meaning                                                     |
| ------ | ----------------------------------------------------------- |
| 400    | Invalid Host header or malformed request framing            |
| 403    | Unsafe cross-origin request                                 |
| 404    | Manual unavailable to this workspace                        |
| 409    | Workspace document quota reached                            |
| 413    | Upload file or request body exceeds the limit               |
| 415    | Input does not have a PDF signature                         |
| 422    | Invalid fields, unreadable PDF, or missing manual selection |
| 429    | Local request rate limit reached                            |
| 502    | Provider failure or answer/citation validation failure      |
| 503    | Real PDF analysis requested without a configured API key    |

Some failures return JSON `detail`; Host validation can return plain text. Source-ID validation checks identifiers against retrieved passages and is not a claim-level correctness guarantee.

## Saved chats

`GET /api/chats` lists this workspace’s chat metadata; `GET /api/chats/{id}` returns its transcript. `POST /api/chats` creates a chat; `PUT /api/chats/{id}` updates it with the last returned `revision`; stale revisions or attempts to change manual/mode return 409. `DELETE /api/chats/{id}` removes the owned chat. Unknown/other-workspace chats return 404.

Save payloads contain `document_id`, `demo`, `revision`, and `messages`. Messages must be completed alternating user/assistant pairs, each with `role`, `content`, optional source records, `demo`, `insufficient_evidence`, and `photo` (`""`, `"sample"`, or `"omitted"`). Extra fields, personal photo data, privileged roles, and oversized transcripts are rejected. Limits: 100 messages per chat, 100 chats per workspace, 1 MB per save. Deleting a manual does not delete saved conversations.
