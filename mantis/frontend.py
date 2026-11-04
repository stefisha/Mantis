"""Keep HTML, styles, and the complete browser module graph on one revision."""

import hashlib
import re

from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException


def render_page(web_dir, filename):
    digest = hashlib.sha256()
    for path in sorted(web_dir.rglob("*")):
        if path.is_file() and path.suffix in (".js", ".css"):
            digest.update(path.relative_to(web_dir).as_posix().encode())
            digest.update(b"\0")
            digest.update(path.read_bytes())
    revision = digest.hexdigest()[:16]
    html = (web_dir / "pages" / filename).read_text(encoding="utf-8")
    return HTMLResponse(html.replace("/static/", f"/static/v/{revision}/"))


class FrontendFiles(StaticFiles):
    async def get_response(self, path, scope):
        normalized = path.replace("\\", "/")
        if normalized.startswith("v/"):
            match = re.fullmatch(r"v/[0-9a-f]{16}/(.+)", normalized)
            if not match:
                raise HTTPException(404)
            path = match.group(1)
        # StaticFiles still enforces the public directory boundary.
        return await super().get_response(path, scope)
