"""Transactional, workspace-scoped document storage for small deployments."""

import json
import sqlite3
import uuid
from contextlib import contextmanager
from pathlib import Path


class WorkspaceFullError(Exception):
    """The workspace has no remaining document slots."""


class Store:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.executescript("""
              PRAGMA journal_mode=WAL;
              CREATE TABLE IF NOT EXISTS documents (
                id TEXT PRIMARY KEY, workspace TEXT NOT NULL, name TEXT NOT NULL,
                equipment TEXT NOT NULL, pages INTEGER NOT NULL, digest TEXT NOT NULL,
                model TEXT NOT NULL, content BLOB NOT NULL,
                created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(workspace, digest));
              CREATE TABLE IF NOT EXISTS chunks (
                id INTEGER PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
                page INTEGER NOT NULL, text TEXT NOT NULL, embedding TEXT NOT NULL);
              CREATE INDEX IF NOT EXISTS document_workspace ON documents(workspace);
              CREATE INDEX IF NOT EXISTS chunk_document ON chunks(document_id);
            """)

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=30)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        try:
            with db:
                yield db
        finally:
            db.close()

    def documents(self, workspace):
        with self.connect() as db:
            return [
                dict(r)
                for r in db.execute(
                    """SELECT id,name,equipment,pages,created,
              (SELECT count(*) FROM chunks WHERE document_id=documents.id) AS chunks
              FROM documents WHERE workspace=? ORDER BY created DESC,id""",
                    (workspace,),
                )
            ]

    def find_by_digest(self, workspace, digest):
        with self.connect() as db:
            row = db.execute(
                """SELECT id,name,equipment,pages,created,
                (SELECT count(*) FROM chunks WHERE document_id=documents.id) AS chunks
                FROM documents WHERE workspace=? AND digest=?""",
                (workspace, digest),
            ).fetchone()
            return dict(row) if row else None

    def add(
        self,
        workspace,
        name,
        equipment,
        pages,
        digest,
        model,
        content,
        chunks,
        embeddings,
        max_documents=30,
    ):
        if len(chunks) != len(embeddings):
            raise ValueError("Embedding count does not match chunks")
        identifier = uuid.uuid4().hex
        with self.connect() as db:
            # Serialize deduplication, quota enforcement and insertion across connections/processes.
            db.execute("BEGIN IMMEDIATE")
            old = db.execute(
                "SELECT id FROM documents WHERE workspace=? AND digest=?",
                (workspace, digest),
            ).fetchone()
            if old:
                return old["id"]
            count = db.execute(
                "SELECT count(*) FROM documents WHERE workspace=?", (workspace,)
            ).fetchone()[0]
            if count >= max_documents:
                raise WorkspaceFullError(
                    "This workspace is limited to 30 manuals. Remove a manual before uploading another."
                )
            db.execute(
                "INSERT INTO documents(id,workspace,name,equipment,pages,digest,model,content) VALUES(?,?,?,?,?,?,?,?)",
                (identifier, workspace, name, equipment, pages, digest, model, content),
            )
            db.executemany(
                "INSERT INTO chunks(document_id,page,text,embedding) VALUES(?,?,?,?)",
                [
                    (identifier, c["page"], c["text"], json.dumps(e))
                    for c, e in zip(chunks, embeddings)
                ],
            )
        return identifier

    def chunks(self, workspace, document_id=None):
        query = """SELECT c.*,d.name,d.equipment,d.model FROM chunks c JOIN documents d
                   ON c.document_id=d.id WHERE d.workspace=?"""
        args = [workspace]
        if document_id:
            query += " AND d.id=?"
            args.append(document_id)
        with self.connect() as db:
            return [dict(r) for r in db.execute(query, args)]

    def document(self, workspace, identifier):
        with self.connect() as db:
            row = db.execute(
                "SELECT * FROM documents WHERE workspace=? AND id=?",
                (workspace, identifier),
            ).fetchone()
            return dict(row) if row else None

    def delete(self, workspace, identifier=None):
        with self.connect() as db:
            if identifier:
                return db.execute(
                    "DELETE FROM documents WHERE workspace=? AND id=?",
                    (workspace, identifier),
                ).rowcount
            return db.execute(
                "DELETE FROM documents WHERE workspace=?", (workspace,)
            ).rowcount
