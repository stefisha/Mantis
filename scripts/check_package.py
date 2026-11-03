"""Smoke-test an actual built wheel, independent of editable source imports."""

import argparse
import os
import sys
import tempfile
from pathlib import Path
from zipfile import ZipFile


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("wheel", type=Path)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        with ZipFile(args.wheel) as archive:
            for name in archive.namelist():
                path = Path(name)
                if path.is_absolute() or ".." in path.parts:
                    raise ValueError("Unsafe wheel member")
                if path.name == ".env" or path.suffix == ".sqlite3":
                    raise ValueError("Runtime secrets/data must not be packaged")
            archive.extractall(root)
        sys.path.insert(0, str(root))
        os.environ["OPENAI_API_KEY"] = ""
        os.environ["MANTIS_ALLOWED_HOSTS"] = "testserver"
        from fastapi.testclient import TestClient

        from mantis import api

        assert root in Path(api.__file__).parents, (
            "Editable source imported instead of built wheel"
        )
        with TestClient(api.create_app(root / "runtime")) as client:
            for path in (
                "/",
                "/workspace",
                "/static/css/tokens.css",
                "/static/js/api.js",
                "/static/js/workspace.js",
                "/static/js/product.js",
                "/static/js/product-demo.js",
                "/static/js/source-scroll.js",
                "/static/assets/mantis-mark.png",
                "/static/assets/Inter-Variable.ttf",
                "/static/assets/team-stefan.png",
            ):
                result = client.get(path)
                assert result.status_code == 200, path
                assert result.content, path
            result = client.post(
                "/api/questions",
                json={"question": "What causes vibration?", "demo": True},
            )
            assert result.status_code == 200
            assert result.json()["sources"]
        print("Built wheel serves both pages, local assets, and the demo API.")


if __name__ == "__main__":
    main()
