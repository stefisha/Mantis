"""Transactional, workspace-scoped document storage for small deployments."""

import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
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
              CREATE TABLE IF NOT EXISTS chats (
                id TEXT PRIMARY KEY, workspace TEXT NOT NULL, title TEXT NOT NULL,
                document_id TEXT NOT NULL, demo INTEGER NOT NULL, messages TEXT NOT NULL,
                revision INTEGER NOT NULL DEFAULT 1, updated TEXT NOT NULL);
              CREATE INDEX IF NOT EXISTS chat_workspace ON chats(workspace,updated);
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

    def chats(self, workspace):
        with self.connect() as db:
            return [
                dict(row)
                for row in db.execute(
                    "SELECT id,title,document_id,demo,revision,updated FROM chats WHERE workspace=? ORDER BY updated DESC,id",
                    (workspace,),
                )
            ]

    def chat(self, workspace, identifier):
        with self.connect() as db:
            row = db.execute(
                "SELECT * FROM chats WHERE workspace=? AND id=?",
                (workspace, identifier),
            ).fetchone()
            if not row:
                return None
            result = dict(row)
            result.pop("workspace")
            result["messages"] = json.loads(result["messages"])
            return result

    def save_chat(self, workspace, data, identifier=None):
        title = data["messages"][0]["content"].strip().replace("\n", " ")[:80]
        updated = datetime.now(timezone.utc).isoformat()
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            if identifier:
                row = db.execute(
                    "SELECT revision,document_id,demo FROM chats WHERE workspace=? AND id=?",
                    (workspace, identifier),
                ).fetchone()
                if not row:
                    raise LookupError("Chat not found.")
                if (
                    row["document_id"] != data["document_id"]
                    or bool(row["demo"]) != data["demo"]
                ):
                    raise ValueError(
                        "Changing manual or example mode requires a new chat."
                    )
                if row["revision"] != data["revision"]:
                    raise ValueError(
                        "This chat changed in another tab. Reopen it from Your chats before continuing."
                    )
                db.execute(
                    "UPDATE chats SET messages=?, revision=revision+1, updated=? WHERE workspace=? AND id=?",
                    (json.dumps(data["messages"]), updated, workspace, identifier),
                )
            else:
                if (
                    db.execute(
                        "SELECT count(*) FROM chats WHERE workspace=?", (workspace,)
                    ).fetchone()[0]
                    >= 100
                ):
                    raise WorkspaceFullError(
                        "This workspace is limited to 100 chats. Delete a chat before saving another."
                    )
                identifier = uuid.uuid4().hex
                db.execute(
                    "INSERT INTO chats(id,workspace,title,document_id,demo,messages,updated) VALUES(?,?,?,?,?,?,?)",
                    (
                        identifier,
                        workspace,
                        title,
                        data["document_id"],
                        int(data["demo"]),
                        json.dumps(data["messages"]),
                        updated,
                    ),
                )
        return self.chat(workspace, identifier)

    def delete_chat(self, workspace, identifier):
        with self.connect() as db:
            return db.execute(
                "DELETE FROM chats WHERE workspace=? AND id=?", (workspace, identifier)
            ).rowcount
