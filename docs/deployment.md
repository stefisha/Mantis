# Deployment and data handling

The supported starting point is a local pilot bound to `127.0.0.1`. The repository does not include employee sign-in, account-based workspace recovery, a hosted service, or a production operations package.

## Before shared deployment

- Add authenticated accounts and durable account-owned workspaces.
- Serve over HTTPS and enable secure cookies with the correct Host configuration.
- Replace the local limiter with shared request and usage controls.
- Define managed secrets, backups, retention, access controls, and audit requirements.
- Isolate PDF parsing from the web process when accepting hostile uploads.
- Evaluate retrieval, answer support, and failure behavior against real equipment documentation.

Upload bodies are bounded before multipart parsing. PDF parsing has size/page/chunk limits but is not sandboxed. SQLite deletion removes application records and indexed chunks; it is not guaranteed forensic erasure from storage media or backups.

## Credentials

Credentials were removed from tracked source and saved notebook outputs during the prototype cleanup. Prior Git history can still contain those credentials. Rotate old keys separately and coordinate any history rewrite with collaborators. Keeping new credentials in `.env` does not revoke a historical key.

## Operational use

Source identifiers are validated, but model answers are not a substitute for the actual manufacturer manual or approved site procedures. Mantis does not operate equipment, verify that a repair succeeded, or certify that a machine is safe.

No representative industrial answer-quality evaluation or live-provider smoke-test record is included yet. See [verification](verification.md) for what has actually been checked.
