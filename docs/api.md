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

Real questions use `demo: false` and the selected manual's `document_id`, returned by the upload/list endpoints. Each question is independent. Responses contain `answer`, `sources`, `insufficient_evidence`, and `demo`. A source contains its document identifier, name, page, and text.

For real PDF uploads, configure the provider first. Uploaded text is sent for embedding, and retrieved passages/questions are sent for answer generation. Duplicate detection can reuse an existing document; a new upload can incur provider usage.

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
