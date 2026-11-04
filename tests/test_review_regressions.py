import asyncio
from contextlib import contextmanager
from pathlib import Path

import pytest
from starlette.exceptions import HTTPException

from mantis.frontend import FrontendFiles
from mantis.store import Store


@pytest.mark.parametrize(
    "asset", ["css/workspace.css", "js/workspace.js", "assets/mantis-mark.png"]
)
def test_windows_revisioned_asset_paths(asset):
    web = Path(__file__).parents[1] / "mantis" / "web"
    files = FrontendFiles(directory=web)
    path = ("v/0123456789abcdef/" + asset).replace("/", "\\")
    response = asyncio.run(
        files.get_response(path, {"type": "http", "method": "GET", "headers": []})
    )
    assert response.status_code == 200
    assert Path(response.path) == web / asset


@pytest.mark.parametrize(
    "path", [r"v\bad\css\workspace.css", r"v\0123456789abcdef\..\..\pyproject.toml"]
)
def test_windows_revision_paths_reject_invalid_prefix_and_escape(path):
    files = FrontendFiles(directory=Path(__file__).parents[1] / "mantis" / "web")
    with pytest.raises(HTTPException) as error:
        asyncio.run(
            files.get_response(path, {"type": "http", "method": "GET", "headers": []})
        )
    assert error.value.status_code == 404


def test_save_returns_own_revision_when_another_tab_writes_after_commit(
    tmp_path, monkeypatch
):
    store = Store(tmp_path / "db.sqlite")
    other = Store(store.path)
    payload = {
        "document_id": "",
        "demo": False,
        "revision": 0,
        "messages": [{"role": "user", "content": "Initial question"}],
    }
    saved = store.save_chat("workspace", payload)
    original_connect = store.connect
    interleaved = False

    @contextmanager
    def connect_with_other_tab():
        nonlocal interleaved
        with original_connect() as db:
            yield db
        if not interleaved:
            interleaved = True
            other.save_chat(
                "workspace",
                {
                    **payload,
                    "revision": 2,
                    "messages": [{"role": "user", "content": "Other tab"}],
                },
                saved["id"],
            )

    monkeypatch.setattr(store, "connect", connect_with_other_tab)
    result = store.save_chat("workspace", {**payload, "revision": 1}, saved["id"])
    assert result["revision"] == 2
    assert result["messages"] == payload["messages"]
    assert other.chat("workspace", saved["id"])["revision"] == 3
    with pytest.raises(ValueError, match="another tab"):
        store.save_chat(
            "workspace", {**payload, "revision": result["revision"]}, saved["id"]
        )
