import json
import re
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

import mantis.api as application
from mantis.rag import cosine, extract_chunks


@pytest.fixture
def clients(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key-never-sent")
    monkeypatch.setenv("MANTIS_ALLOWED_HOSTS", "testserver,localhost,127.0.0.1")
    monkeypatch.setenv("MANTIS_SECURE_COOKIE", "false")
    api = application.create_app(tmp_path)
    first = TestClient(api)
    second = TestClient(api)
    first.get("/api/health")
    second.get("/api/health")
    return first, second, api


def pdf(text="Inspect mounting bolts before maintenance."):
    # Minimal real PDF fixture, with a text object and correct byte offsets.
    stream = f"BT /F1 12 Tf 20 80 Td ({text}) Tj ET".encode()
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length "
        + str(len(stream)).encode()
        + b" >>\nstream\n"
        + stream
        + b"\nendstream",
    ]
    result = b"%PDF-1.4\n"
    offsets = [0]
    for i, obj in enumerate(objects, 1):
        offsets.append(len(result))
        result += f"{i} 0 obj\n".encode() + obj + b"\nendobj\n"
    xref = len(result)
    result += b"xref\n0 6\n0000000000 65535 f \n"
    result += b"".join(f"{offset:010} 00000 n \n".encode() for offset in offsets[1:])
    return (
        result
        + f"trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF".encode()
    )


@pytest.fixture
def provider(monkeypatch):
    calls = []
    answer = {
        "answer": "Inspect the mounting bolts.",
        "source_ids": [1],
        "insufficient_evidence": False,
    }

    class Fake:
        def __init__(self, **kwargs):
            self.embeddings = SimpleNamespace(create=self.embed)
            self.chat = SimpleNamespace(
                completions=SimpleNamespace(create=self.chat_answer)
            )

        def embed(self, **kwargs):
            calls.append(kwargs)
            return SimpleNamespace(
                data=[
                    SimpleNamespace(index=i, embedding=[1.0, 0.0])
                    for i, _ in enumerate(kwargs["input"])
                ]
            )

        def chat_answer(self, **kwargs):
            return SimpleNamespace(
                choices=[
                    SimpleNamespace(message=SimpleNamespace(content=json.dumps(answer)))
                ]
            )

    monkeypatch.setattr(application, "OpenAI", Fake)
    return calls, answer


def upload(client, content=None):
    return client.post(
        "/api/documents",
        files={"file": ("pump.pdf", content or pdf(), "application/pdf")},
        data={"equipment": "Pump P-01"},
    )


def test_upload_embeds_once_and_deduplicates(clients, provider):
    client, _, _ = clients
    first = upload(client)
    assert first.status_code == 201, first.text
    assert len(provider[0]) == 1
    again = upload(client)
    assert again.json()["duplicate"] is True
    assert again.json()["document"]["id"] == first.json()["document"]["id"]
    assert len(provider[0]) == 1


def test_isolation_deletion_and_restart(clients, provider, tmp_path):
    first, second, api = clients
    identifier = upload(first).json()["document"]["id"]
    assert second.get("/api/documents").json()["documents"] == []
    assert second.get(f"/api/documents/{identifier}/file").status_code == 404
    assert second.delete(f"/api/documents/{identifier}").status_code == 404
    restarted = TestClient(application.create_app(tmp_path))
    restarted.cookies.update(first.cookies)
    assert len(restarted.get("/api/documents").json()["documents"]) == 1
    assert restarted.get(f"/api/documents/{identifier}/file").content.startswith(
        b"%PDF"
    )
    assert first.delete("/api/documents").json()["deleted"] == 1
    assert restarted.get("/api/documents").json()["documents"] == []
    with api.state.store.connect() as db:
        assert db.execute("SELECT count(*) FROM chunks").fetchone()[0] == 0
    assert (
        first.post(
            "/api/questions",
            json={"question": "Inspect bolts?", "document_id": identifier},
        ).status_code
        == 404
    )


def test_questions_sources_and_invalid_citation(clients, provider):
    client, _, _ = clients
    identifier = upload(client).json()["document"]["id"]
    result = client.post(
        "/api/questions", json={"question": "Inspect bolts?", "document_id": identifier}
    )
    assert result.status_code == 200, result.text
    assert result.json()["sources"][0]["page"] == 1
    assert result.json()["sources"][0]["name"] == "pump.pdf"
    provider[1]["source_ids"] = [999]
    assert (
        client.post(
            "/api/questions",
            json={"question": "Inspect bolts?", "document_id": identifier},
        ).status_code
        == 502
    )


def test_unsupported_question_skips_generation(clients, provider, monkeypatch):
    client, _, api = clients
    identifier = upload(client).json()["document"]["id"]
    monkeypatch.setenv("MANTIS_MIN_SIMILARITY", "1.1")
    result = client.post(
        "/api/questions",
        json={"question": "Unsupported question", "document_id": identifier},
    ).json()
    assert result["insufficient_evidence"] is True
    assert result["sources"] == []


def test_upload_validation_and_unconfigured(clients, monkeypatch):
    client, _, _ = clients
    assert upload(client, b"not a pdf").status_code == 415
    monkeypatch.setenv("MANTIS_MAX_UPLOAD_MB", "0")
    assert upload(client).status_code == 413
    monkeypatch.setenv("MANTIS_MAX_UPLOAD_MB", "20")
    monkeypatch.delenv("OPENAI_API_KEY")
    assert upload(client).status_code == 503
    result = client.post(
        "/api/questions", json={"question": "What causes vibration?", "demo": True}
    )
    assert result.status_code == 200
    assert result.json()["demo"] is True
    assert result.json()["sources"][0]["document_id"] == "demo"


def test_invalid_pdf_does_not_persist(clients, provider):
    client, _, _ = clients
    assert upload(client, b"%PDF-broken").status_code == 422
    assert client.get("/api/documents").json()["documents"] == []


def test_origin_cookie_and_question_validation(clients):
    client, _, _ = clients
    assert client.post("/api/questions", json={"question": "x"}).status_code == 422
    assert (
        client.post(
            "/api/questions",
            json={"question": "hello", "demo": True},
            headers={"Origin": "https://other.example"},
        ).status_code
        == 403
    )
    assert (
        client.get("/")
        .headers["content-security-policy"]
        .startswith("default-src 'self'")
    )
    policy = client.get("/").headers["content-security-policy"]
    assert "img-src 'self' data: blob:;" in policy
    assert "script-src 'self';" in policy
    fresh = TestClient(application.create_app())
    cookie = fresh.get("/api/health").headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=lax" in cookie


def test_pdf_extraction_and_similarity():
    pages, chunks = extract_chunks(pdf())
    assert pages == 1
    assert "mounting bolts" in chunks[0]["text"]
    assert chunks[0]["page"] == 1
    assert cosine([1.0, 0.0], [1.0, 0.0]) == 1
    assert cosine([0.0, 0.0], [1.0, 0.0]) == 0
    assert cosine([1.0], [1.0, 0.0]) == 0


def test_current_tracked_sources_have_no_api_keys():
    for name in (
        "app.py",
        "mantis/api.py",
        "notebooks/legacy_report_rag.py",
        "notebooks/Report_Front.ipynb",
        "notebooks/Report_Rag.ipynb",
    ):
        assert not re.search(r"sk-[A-Za-z0-9_-]{20,}", Path(name).read_text())


def test_rate_limit_and_host_validation(clients):
    client, _, _ = clients
    assert (
        client.get("/api/health", headers={"Host": "untrusted.example"}).status_code
        == 400
    )
    for _ in range(20):
        assert (
            client.post(
                "/api/questions", json={"question": "vibration", "demo": True}
            ).status_code
            == 200
        )
    assert (
        client.post(
            "/api/questions", json={"question": "vibration", "demo": True}
        ).status_code
        == 429
    )


def test_provider_failure_leaves_no_partial_document(clients, provider, monkeypatch):
    import openai

    client, _, _ = clients

    class Broken:
        def __init__(self, **kwargs):
            self.embeddings = SimpleNamespace(create=self.fail)

        def fail(self, **kwargs):
            raise openai.APIConnectionError(
                request=__import__("httpx").Request("POST", "https://api.openai.com")
            )

    monkeypatch.setattr(application, "OpenAI", Broken)
    result = upload(client)
    assert result.status_code == 502
    assert client.get("/api/documents").json()["documents"] == []


def test_cross_site_navigation_keeps_workspace(clients, provider):
    client, _, _ = clients
    upload(client)
    token = client.cookies.get("mantis_workspace")
    response = client.get(
        "/", headers={"Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "navigate"}
    )
    assert "set-cookie" not in response.headers
    assert client.cookies.get("mantis_workspace") == token
    assert len(client.get("/api/documents").json()["documents"]) == 1


@pytest.mark.parametrize(
    "headers", [[], [(b"content-length", b"1")], [(b"content-length", b"999999")]]
)
def test_body_limit_before_parser_for_streamed_and_declared_uploads(
    monkeypatch, headers
):
    import asyncio

    from mantis.middleware import UploadBodyLimitMiddleware

    monkeypatch.setenv("MANTIS_MAX_UPLOAD_MB", "0")
    invoked = []
    messages = []
    pieces = iter([b"x" * 32768, b"x" * 32769, b"never consumed"])

    async def downstream(scope, receive, send):
        invoked.append(True)

    async def receive():
        return {"type": "http.request", "body": next(pieces), "more_body": True}

    async def send(message):
        messages.append(message)

    scope = {
        "type": "http",
        "method": "POST",
        "path": "/api/documents",
        "headers": headers,
    }
    asyncio.run(UploadBodyLimitMiddleware(downstream)(scope, receive, send))
    assert not invoked
    assert messages[0]["status"] == 413


def test_bounded_body_replay_preserves_content(monkeypatch):
    import asyncio

    from mantis.middleware import UploadBodyLimitMiddleware

    monkeypatch.setenv("MANTIS_MAX_UPLOAD_MB", "1")
    chunks = iter([b"a" * 70000, b"b" * 30000])
    captured = []

    async def receive():
        chunk = next(chunks)
        return {
            "type": "http.request",
            "body": chunk,
            "more_body": chunk.startswith(b"a"),
        }

    async def downstream(scope, receive, send):
        while True:
            message = await receive()
            captured.append(message["body"])
            if not message["more_body"]:
                break

    async def send(message):
        pass

    asyncio.run(
        UploadBodyLimitMiddleware(downstream)(
            {"type": "http", "method": "POST", "path": "/api/documents", "headers": []},
            receive,
            send,
        )
    )
    assert b"".join(captured) == b"a" * 70000 + b"b" * 30000


def test_concurrent_store_deduplication(tmp_path):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from mantis.store import Store

    store = Store(tmp_path / "concurrent.sqlite3")
    barrier = Barrier(2)

    def insert(_):
        barrier.wait()
        return store.add(
            "workspace",
            "manual.pdf",
            "Pump",
            1,
            "same-digest",
            "model",
            b"pdf",
            [{"page": 1, "text": "passage"}],
            [[1.0, 0.0]],
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        identifiers = list(pool.map(insert, range(2)))
    assert identifiers[0] == identifiers[1]
    assert len(store.documents("workspace")) == 1
    assert len(store.chunks("workspace")) == 1


def test_concurrent_store_quota(tmp_path):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from mantis.store import Store, WorkspaceFullError

    store = Store(tmp_path / "quota.sqlite3")
    barrier = Barrier(2)

    def insert(number):
        barrier.wait()
        try:
            return store.add(
                "workspace",
                "manual.pdf",
                "Pump",
                1,
                str(number),
                "model",
                b"pdf",
                [{"page": 1, "text": "passage"}],
                [[1.0, 0.0]],
                max_documents=1,
            )
        except WorkspaceFullError:
            return "full"

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(insert, range(2)))
    assert results.count("full") == 1
    assert len(store.documents("workspace")) == 1
    assert len(store.chunks("workspace")) == 1


def test_digest_lookup_only_returns_metadata(clients, provider, monkeypatch):
    client, _, api = clients
    identifier = upload(client).json()["document"]["id"]

    def forbid_blob_read(*args):
        raise AssertionError("deduplication must not load PDF content")

    monkeypatch.setattr(api.state.store, "document", forbid_blob_read)
    result = upload(client)
    assert result.json()["duplicate"] is True
    assert result.json()["document"]["id"] == identifier
    assert "content" not in result.json()["document"]


def test_empty_upload_body_does_not_hang(clients):
    client, _, _ = clients
    result = client.post(
        "/api/documents",
        content=b"",
        headers={"Content-Type": "multipart/form-data; boundary=empty"},
    )
    assert result.status_code == 422


def test_product_workspace_and_linked_assets_are_served(clients):
    from html.parser import HTMLParser

    class Assets(HTMLParser):
        def __init__(self):
            super().__init__()
            self.paths = set()

        def handle_starttag(self, tag, attrs):
            for name, value in attrs:
                if name in ("src", "href") and value and value.startswith("/static/"):
                    self.paths.add(value)

    client, _, _ = clients
    for page, marker in [("/", "ON AUTOPILOT"), ("/workspace", "manual-select")]:
        response = client.get(page)
        assert response.status_code == 200
        assert marker in response.text
        parser = Assets()
        parser.feed(response.text)
        for path in parser.paths:
            asset = client.get(path)
            assert asset.status_code == 200, path
            assert asset.content, path
    # Encoded separators survive HTTPX URL normalization and reach StaticFiles.
    # The target exists one directory outside the public web root.
    assert (application.WEB_DIR.parent / "api.py").is_file()
    traversal = client.get("/static/..%2Fapi.py")
    assert b"..%2Fapi.py" in traversal.request.url.raw_path
    assert traversal.status_code == 404


@pytest.mark.parametrize(
    "question,page",
    [
        ("What should I check for excessive vibration?", 4),
        ("What should I check for overheating?", 7),
        ("What should I record during preventive maintenance?", 9),
    ],
)
def test_product_demo_examples_return_the_expected_source(clients, question, page):
    client, _, _ = clients
    result = client.post("/api/questions", json={"question": question, "demo": True})
    assert result.status_code == 200
    assert result.json()["demo"] is True
    assert result.json()["sources"][0]["page"] == page
