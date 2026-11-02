import json
import re
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

import app as application
from mantis.rag import cosine, extract_chunks


@pytest.fixture
def clients(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key-never-sent")
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
    fresh = TestClient(application.create_app())
    cookie = fresh.get("/api/health").headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=strict" in cookie


def test_pdf_extraction_and_similarity():
    pages, chunks = extract_chunks(pdf())
    assert pages == 1
    assert "mounting bolts" in chunks[0]["text"]
    assert chunks[0]["page"] == 1
    assert cosine([1.0, 0.0], [1.0, 0.0]) == 1
    assert cosine([0.0, 0.0], [1.0, 0.0]) == 0
    assert cosine([1.0], [1.0, 0.0]) == 0


def test_current_tracked_sources_have_no_api_keys():
    for name in ("app.py", "report_rag.py", "Report_Front.ipynb", "Report_Rag.ipynb"):
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
