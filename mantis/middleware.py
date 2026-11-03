"""Bound multipart requests before Starlette parses or spools individual files."""

import os
import tempfile

from starlette.concurrency import run_in_threadpool
from starlette.responses import JSONResponse


class UploadBodyLimitMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if (
            scope["type"] != "http"
            or scope["method"] != "POST"
            or scope["path"] != "/api/documents"
        ):
            return await self.app(scope, receive, send)
        # Allow a small, bounded multipart envelope in addition to the file limit.
        maximum = int(os.getenv("MANTIS_MAX_UPLOAD_MB", "20")) * 1024 * 1024 + 64 * 1024
        headers = dict(scope["headers"])
        length = headers.get(b"content-length")
        if length is not None:
            try:
                declared = int(length)
                if declared < 0:
                    raise ValueError
            except ValueError:
                return await JSONResponse(
                    {"detail": "Invalid Content-Length."}, status_code=400
                )(scope, receive, send)
            if declared > maximum:
                return await self.reject(scope, receive, send)
        # Buffer at most the configured limit, regardless of Content-Length or transfer encoding.
        # The downstream multipart parser is never invoked for an oversized request.
        with tempfile.SpooledTemporaryFile(max_size=1024 * 1024) as body:
            size = 0
            while True:
                message = await receive()
                if message["type"] == "http.disconnect":
                    return
                chunk = message.get("body", b"")
                size += len(chunk)
                if size > maximum:
                    return await self.reject(scope, receive, send)
                await run_in_threadpool(body.write, chunk)
                if not message.get("more_body", False):
                    break
            body.seek(0)
            remaining = size
            completed = False

            async def replay():
                nonlocal remaining, completed
                if not completed:
                    chunk = await run_in_threadpool(body.read, min(65536, remaining))
                    remaining -= len(chunk)
                    completed = remaining == 0
                    return {
                        "type": "http.request",
                        "body": chunk,
                        "more_body": remaining > 0,
                    }
                return await receive()

            await self.app(scope, replay, send)

    async def reject(self, scope, receive, send):
        await JSONResponse(
            {"detail": "The upload request exceeds the size limit."}, status_code=413
        )(scope, receive, send)
