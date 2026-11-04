# Configuration

For a new setup, copy `.env.example` to `.env` and configure the key locally. `.env` is loaded from the process working directory; relative data paths are also resolved there. Restart the server after environment changes. `.env`, runtime data, virtual environments, and notebook checkpoints are ignored by Git. Keep an existing `.env` when updating a checkout.

| Setting                  | Default                  | Purpose                                                    |
| ------------------------ | ------------------------ | ---------------------------------------------------------- |
| `OPENAI_API_KEY`         | empty                    | Required for real uploads and questions                    |
| `MANTIS_CHAT_MODEL`      | `gpt-4o-mini`            | Must support image input and strict JSON schema outputs                    |
| `MANTIS_EMBEDDING_MODEL` | `text-embedding-3-small` | Used for new manual indexes                                |
| `MANTIS_DATA_DIR`        | `data`                   | SQLite storage directory                                   |
| `MANTIS_MAX_UPLOAD_MB`   | `20`                     | Server file limit; update frontend copy if changed         |
| `MANTIS_MIN_SIMILARITY`  | `0.3`                    | Retrieval cutoff; calibrate using representative questions |
| `MANTIS_ALLOWED_HOSTS`   | loopback hosts           | Accepted Host headers; set the hostname when deploying     |
| `MANTIS_SECURE_COOKIE`   | `false`                  | Set `true` when serving over HTTPS                         |

The default server limits are 20 MB and 300 pages per PDF, 2,000 chunks per manual, and 30 manuals per workspace. The multipart-body limiter allows a bounded envelope in addition to the file limit.

Uploaded manual text is sent to OpenAI to create embeddings. Questions, the last four successful text exchanges, and retrieved excerpts are sent for answer generation. In live mode, a current-message photo is sent for visual observations, which can inform manual retrieval; photos are limited to JPEG/PNG/WebP, 8 MB and 20 megapixels. Photos and chat history are not persisted by Mantis. The question-body cap is 12 MB. The original PDF remains in the local database. Example mode uses the same chat interface with scripted replies, makes no AI calls, and keeps attached photos local. Live photos follow the [official OpenAI image-input format](https://developers.openai.com/api/docs/guides/images-vision); configured key/model availability still needs a live-provider check.

Changing the embedding model affects new indexes. Existing manuals retain their model identifier for compatible question embeddings. A model identifier still needs to be available to the configured provider account.

[Quick start](../README.md#quick-start) · [Deployment guidance](deployment.md)
