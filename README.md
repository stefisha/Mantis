# Mantis

A maintenance knowledge workspace. Upload an equipment manual, ask a specific troubleshooting question, and inspect the passages behind the answer.

## Run locally

Python 3.9+ and Node 22+ (Node is only needed for the JavaScript check).

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.lock
python -m pip install -e . --no-deps
cp .env.example .env
# Set OPENAI_API_KEY in .env to enable real PDF analysis.
python -m uvicorn app:app --reload --host 127.0.0.1 --port 8000
```

Open http://127.0.0.1:8000. The frontend and API share one origin; no separate frontend server is needed. `Explore demo` works without an API key and returns excerpts from a clearly labeled, illustrative training manual. It does not run an AI model or provide real equipment procedures.

## Workflow

1. Upload a text-based PDF (up to 20 MB / 300 pages), optionally labeled with its equipment model.
2. Select the manual. Questions are restricted to that manual to avoid mixing machines.
3. Ask a self-contained question, including the fault code or component when available.
4. Select an answer citation to inspect the exact passage or open the PDF at its source page.
5. Manage individual manuals or clear the library. Deletion removes the stored document and indexed chunks transactionally.

Each question is independent; the chat is a session transcript, not conversational model memory. Reloading clears the transcript. Manuals persist in SQLite and are scoped to an opaque, HTTP-only browser cookie. Clearing cookies loses access to that workspace. Each browser profile has a separate workspace.

## Architecture

- FastAPI serves the same-origin frontend and a typed API.
- `mantis/rag.py` extracts overlapping, page-local text chunks; adjacent lines stay together. Scanned PDFs need OCR before upload.
- OpenAI embeds each chunk once, in batches. Embeddings and the original PDF are stored atomically in SQLite. Duplicate files within a workspace reuse the existing document.
- Retrieval uses cosine similarity within the selected manual. The embedding model is saved per document, so configuration changes do not mix incompatible vector spaces.
- A similarity threshold gates answer generation. The model uses a strict response schema and returns source IDs; the API validates IDs before returning citations. This validates source identity, not whether every claim is entailed by its passage. Tune the threshold against representative manuals and questions before operational use.
- All document text is rendered as text, not HTML. No document text, questions, or provider responses are logged.

This intentionally replaces the prototype's global Chroma collection and LangChain wrappers with a small, inspectable storage and retrieval layer. Brute-force vector search is suitable for the bounded local workspace (30 manuals, 2,000 chunks per manual), not a large fleet deployment.

## Configuration

See `.env.example`. `.env`, runtime data, virtual environments, and notebook checkpoints are ignored.

| Setting | Default | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | empty | Required for real uploads and questions |
| `MANTIS_CHAT_MODEL` | `gpt-4o-mini` | Must support strict JSON schema outputs |
| `MANTIS_EMBEDDING_MODEL` | `text-embedding-3-small` | Used for new manual indexes |
| `MANTIS_DATA_DIR` | `data` | SQLite storage location |
| `MANTIS_MAX_UPLOAD_MB` | `20` | Server upload limit; update frontend copy if changed |
| `MANTIS_MIN_SIMILARITY` | `0.3` | Retrieval cutoff; calibrate using your own evaluation set |
| `MANTIS_ALLOWED_HOSTS` | loopback hosts | Accepted Host headers; set your hostname for deployment |
| `MANTIS_SECURE_COOKIE` | `false` | Set `true` when serving over HTTPS |

Uploaded manual text and questions are sent to OpenAI for embedding and generation. Local documents are not uploaded by demo mode. The original PDF remains in the local database.

## Verification

```sh
pytest -q
npm ci --ignore-scripts
npm run check
npm run format:check
ruff check app.py report_rag.py mantis tests
```

Tests exercise real PDF extraction and the API with a fake provider: upload validation, single-pass indexing, deduplication, isolation between browsers, persistence after restart, deletion cascading to chunks, citation validation, unsupported retrieval, and demo behavior. They make no billable API calls. GitHub Actions runs these checks on pushes and pull requests.

## Deployment boundary

This is a maintainable local pilot, not a completed enterprise deployment. Bind to loopback by default. Browser workspace cookies isolate data but are not employee authentication. Before shared or internet deployment, add authenticated accounts, durable account-based workspace ownership, HTTPS, shared rate limiting, managed secrets, database backups/retention, audit controls, and a representative retrieval/answer evaluation set. The in-process request limiter is a local safeguard, not distributed abuse protection. PDF parsing is bounded by size/page/chunk limits but is not sandboxed; use an isolated worker for hostile uploads. SQLite deletion removes application records; it is not guaranteed forensic erasure from backups or storage media.

Existing committed credentials were removed from the working tree and notebook outputs were cleared. Prior Git commits still contain those credentials. Rotate exposed keys and coordinate any history rewrite with repository collaborators; no history rewrite is performed by this change.

## Research notebooks

`Whisper_model.ipynb` and `grounding_dino_demo.ipynb` are experimental speech and object-detection work, not integrated product features. `Report_Front.ipynb` and `Report_Rag.ipynb` preserve early prototypes; use `app.py` for the maintained application. Notebook outputs are cleared to avoid retaining documents and credentials. `report_rag.py` now points to the maintained server.
