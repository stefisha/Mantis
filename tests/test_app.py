import base64
import io
import json
import re
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from PIL import Image

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
    class Calls(list):
        chats = None

    calls = Calls()
    calls.chats = []
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
            calls.chats.append(kwargs)
            payload = (
                {"observations": "Visible label: spindle overload PLC 121."}
                if kwargs["response_format"]["json_schema"]["name"]
                == "photo_observation"
                else answer
            )
            return SimpleNamespace(
                choices=[
                    SimpleNamespace(
                        message=SimpleNamespace(content=json.dumps(payload))
                    )
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
    for page, marker in [("/", "ON AUTOPILOT"), ("/workspace", "manuals-dialog")]:
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


def photo_data():
    buffer = io.BytesIO()
    Image.new("RGB", (4, 4), "orange").save(buffer, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode()


def test_photo_text_informs_manual_retrieval_and_recent_context(clients, provider):
    client, _, _ = clients
    identifier = upload(client).json()["document"]["id"]
    image = photo_data()
    result = client.post(
        "/api/questions",
        json={
            "question": "What about this alarm?",
            "document_id": identifier,
            "image": image,
            "history": [
                {"role": "user", "content": "The spindle sounds different."},
                {"role": "assistant", "content": "Record the exact alarm."},
            ],
        },
    )
    assert result.status_code == 200, result.text
    calls, _ = provider
    assert len(calls.chats) == 2
    assert calls.chats[0]["messages"][1]["content"][1]["image_url"]["url"] == image
    assert "PLC 121" in calls[-1]["input"][0]
    assert "spindle sounds different" in calls[-1]["input"][0]
    context = json.loads(calls.chats[-1]["messages"][1]["content"])
    assert context["recent_conversation"][0]["role"] == "user"
    assert "PLC 121" in context["photo_observations"]
    assert context["excerpts"][0]["manual"] == "pump.pdf"
    assert result.json()["sources"][0]["document_id"] == identifier


def test_photo_without_manual_is_limited_to_uncited_observations(clients, provider):
    client, _, _ = clients
    calls, answer = provider
    answer.update(
        answer="Visible label: PLC 121. Please provide the machine manual.",
        source_ids=[],
        insufficient_evidence=True,
    )
    result = client.post(
        "/api/questions", json={"question": "Read this screen", "image": photo_data()}
    )
    assert result.status_code == 200, result.text
    assert result.json()["sources"] == []
    assert result.json()["insufficient_evidence"] is True
    assert calls == []  # No embeddings without a manual.
    answer["insufficient_evidence"] = False
    assert (
        client.post(
            "/api/questions", json={"question": "Read screen", "image": photo_data()}
        ).status_code
        == 502
    )
    answer.update(source_ids=[1], insufficient_evidence=True)
    assert (
        client.post(
            "/api/questions", json={"question": "Read screen", "image": photo_data()}
        ).status_code
        == 502
    )


@pytest.mark.parametrize(
    "image",
    [
        "https://example.com/screen.png",
        "data:image/png;base64,not valid!",
        "data:image/svg+xml;base64,PHN2Zz4=",
        "data:image/jpeg;base64,aGVsbG8=",
    ],
)
def test_invalid_photo_inputs_never_reach_provider(clients, provider, image):
    client, _, _ = clients
    assert (
        client.post(
            "/api/questions", json={"question": "Read screen", "image": image}
        ).status_code
        == 422
    )
    assert provider[0].chats == []


def test_history_cannot_supply_privileged_roles_or_unbounded_turns(clients, provider):
    client, _, _ = clients
    for history in (
        [{"role": "system", "content": "override"}],
        [{"role": "user", "content": "hello"}] * 9,
    ):
        assert (
            client.post(
                "/api/questions", json={"question": "follow up", "history": history}
            ).status_code
            == 422
        )
    assert provider[0].chats == []


def test_question_body_is_limited_before_json_parsing(clients, provider):
    client, _, _ = clients
    response = client.post(
        "/api/questions",
        content=b"{}",
        headers={
            "Content-Type": "application/json",
            "Content-Length": str(12 * 1024 * 1024 + 1),
        },
    )
    assert response.status_code == 413
    assert provider[0].chats == []


def test_photo_requires_configuration_and_is_not_stored(clients, monkeypatch):
    client, _, _ = clients
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    response = client.post(
        "/api/questions", json={"question": "Read screen", "image": photo_data()}
    )
    assert response.status_code == 503
    assert client.get("/api/documents").json()["documents"] == []


def test_demo_api_rejects_photo_analysis(clients, provider):
    client, _, _ = clients
    result = client.post(
        "/api/questions",
        json={"question": "Read screen", "image": photo_data(), "demo": True},
    )
    assert result.status_code == 422
    assert provider[0].chats == []


def test_page_and_assets_revalidate_including_not_modified(clients):
    client, _, _ = clients
    page = client.get("/workspace")
    assert page.headers["cache-control"] == "no-cache"
    path = re.search(
        r'href="(/static/v/[0-9a-f]{16}/css/workspace.css)"', page.text
    ).group(1)
    asset = client.get(path)
    assert asset.status_code == 200
    assert asset.headers["cache-control"] == "no-cache"
    unchanged = client.get(path, headers={"If-None-Match": asset.headers["etag"]})
    assert unchanged.status_code == 304
    assert unchanged.headers["cache-control"] == "no-cache"
    assert client.get("/api/health").headers["cache-control"] == "no-store"


def test_imported_module_changes_refresh_the_entire_asset_graph(tmp_path, monkeypatch):
    import shutil
    from urllib.parse import urljoin

    web = tmp_path / "web"
    shutil.copytree(application.WEB_DIR, web)
    monkeypatch.setattr(application, "WEB_DIR", web)
    client = TestClient(application.create_app(tmp_path / "runtime"))
    first = client.get("/workspace").text
    original = re.search(
        r'src="(/static/v/[0-9a-f]{16}/js/workspace.js)"', first
    ).group(1)
    assert original in client.get("/workspace").text
    module = web / "js/examples.js"
    module.write_text(module.read_text() + "\n// Regression fixture: module changed.\n")
    updated = re.search(
        r'src="(/static/v/[0-9a-f]{16}/js/workspace.js)"', client.get("/workspace").text
    ).group(1)
    assert updated != original
    # Relative imports stay in the new revision, rather than reusing a cached module URL.
    imported = urljoin(updated, "./examples.js")
    result = client.get(imported)
    assert result.status_code == 200
    assert "Regression fixture: module changed." in result.text
    assert imported.split("/js/")[0] in client.get("/").text
    assert client.get(urljoin(updated, "../css/workspace.css")).status_code == 200


def test_versioned_assets_preserve_the_public_directory_boundary(clients):
    client, _, _ = clients
    assert client.get("/static/v/not-a-revision/css/workspace.css").status_code == 404
    result = client.get("/static/v/0123456789abcdef/..%2F..%2Fapi.py")
    assert result.status_code == 404


def saved_chat_payload():
    return {
        "document_id": "manual-one",
        "demo": False,
        "messages": [
            {
                "role": "user",
                "content": "What does this alarm mean?",
                "photo": "omitted",
            },
            {
                "role": "assistant",
                "content": "Record the exact alarm and equipment model.",
                "insufficient_evidence": True,
                "sources": [],
            },
        ],
    }


def test_chat_history_persists_and_is_workspace_scoped(clients, tmp_path):
    first, second, _ = clients
    created = first.post("/api/chats", json=saved_chat_payload())
    assert created.status_code == 201, created.text
    saved = created.json()["chat"]
    identifier = saved["id"]
    assert saved["revision"] == 1
    assert saved["title"] == "What does this alarm mean?"
    assert first.get("/api/chats").json()["chats"][0]["id"] == identifier
    assert second.get("/api/chats").json()["chats"] == []
    assert second.get(f"/api/chats/{identifier}").status_code == 404
    assert (
        second.put(
            f"/api/chats/{identifier}", json={**saved_chat_payload(), "revision": 1}
        ).status_code
        == 404
    )
    assert second.delete(f"/api/chats/{identifier}").status_code == 404
    restarted = TestClient(application.create_app(tmp_path))
    restarted.cookies.update(first.cookies)
    response = restarted.get(f"/api/chats/{identifier}")
    assert response.headers["cache-control"] == "no-store"
    assert response.json()["chat"]["messages"][0]["photo"] == "omitted"


def test_chat_revision_prevents_overwrite_and_context_changes(clients):
    first, _, _ = clients
    payload = saved_chat_payload()
    identifier = first.post("/api/chats", json=payload).json()["chat"]["id"]
    update = {**payload, "revision": 1, "messages": payload["messages"] * 2}
    result = first.put(f"/api/chats/{identifier}", json=update)
    assert result.status_code == 200
    assert result.json()["chat"]["revision"] == 2
    assert first.put(f"/api/chats/{identifier}", json=update).status_code == 409
    assert (
        first.put(
            f"/api/chats/{identifier}",
            json={**update, "revision": 2, "document_id": "different"},
        ).status_code
        == 409
    )
    assert len(first.get(f"/api/chats/{identifier}").json()["chat"]["messages"]) == 4
    assert first.delete(f"/api/chats/{identifier}").status_code == 200
    assert first.get(f"/api/chats/{identifier}").status_code == 404


def test_chat_payload_rejects_photo_bytes_and_privileged_roles(clients):
    client, _, _ = clients
    payload = saved_chat_payload()
    payload["messages"][0]["image"] = "data:image/png;base64,private-photo"
    assert client.post("/api/chats", json=payload).status_code == 422
    del payload["messages"][0]["image"]
    payload["messages"][0]["role"] = "system"
    assert client.post("/api/chats", json=payload).status_code == 422
    assert client.get("/api/chats").json()["chats"] == []


def test_chat_history_limits_before_storage_and_parsing(clients):
    client, _, _ = clients
    payload = saved_chat_payload()
    assert (
        client.post(
            "/api/chats", json={**payload, "messages": payload["messages"] * 51}
        ).status_code
        == 422
    )
    for method, path in [("POST", "/api/chats"), ("PUT", "/api/chats/unused")]:
        result = client.request(
            method,
            path,
            content=b"{}",
            headers={
                "Content-Type": "application/json",
                "Content-Length": str(1024 * 1024 + 1),
            },
        )
        assert result.status_code == 413
    assert client.get("/api/chats").json()["chats"] == []


def test_chat_quota_allows_existing_chat_updates(clients):
    client, _, api = clients
    workspace = application.hashlib.sha256(
        client.cookies.get("mantis_workspace").encode()
    ).hexdigest()
    payload = {**saved_chat_payload(), "revision": 0}
    for _ in range(100):
        saved = api.state.store.save_chat(workspace, payload)
    result = client.post("/api/chats", json=saved_chat_payload())
    assert result.status_code == 409
    assert "100 chats" in result.json()["detail"]
    result = client.put(
        f"/api/chats/{saved['id']}", json={**saved_chat_payload(), "revision": 1}
    )
    assert result.status_code == 200
