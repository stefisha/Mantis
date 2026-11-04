# Running and updating Mantis

## Start the application

Activate the virtual environment used for installation, then run:

```sh
mantis --reload
```

Equivalent commands:

```sh
python -m mantis --reload
python -m uvicorn mantis.main:app --reload --host 127.0.0.1 --port 8000
```

The original source-checkout command, `python -m uvicorn app:app --reload`, also works. The packaged `mantis.main:app` entry point works without root `app.py`.

| URL                                    | Purpose                                            |
| -------------------------------------- | -------------------------------------------------- |
| `http://127.0.0.1:8000/`               | Product page and interactive sample                |
| `http://127.0.0.1:8000/workspace`      | Manual library, questions, and source inspector    |
| `http://127.0.0.1:8000/workspace#demo` | The same chat with a scripted example loaded      |
| `http://127.0.0.1:8000/api/health`     | Application status and provider configuration flag |
| `http://127.0.0.1:8000/openapi.json`   | Machine-readable API schema                        |

The example makes no AI calls but still needs the local server. It is not a standalone HTML file. A `configured: true` health response means a key is present; it does not verify that the key is valid or that provider quota is available.

## Update an existing checkout

Stop the development server, then update the branch you intend to run. For the merged application on `main`:

```sh
git switch main
git pull --ff-only
source .venv/bin/activate
python -m pip install -r requirements.lock
python -m pip install -e . --no-deps
mantis --reload
```

Keep the existing `.env` and `data/` directory. Do not copy `.env.example` over an existing key. Use the same `MANTIS_DATA_DIR`, browser profile, hostname, and port when returning to a workspace. Cookies for `localhost` and `127.0.0.1` are separate; switching hosts can make an existing library appear empty.

The frontend is packaged with Python. Reinstall after changes to entry points or package metadata; no JavaScript build step is needed. Contributors should also run `npm ci --ignore-scripts` after changes to the frontend tool lockfile.

## Configuration and data location

The application loads `.env` from the working directory. `MANTIS_DATA_DIR` defaults to `data/` under that directory, containing `mantis.sqlite3`. Run from a consistent directory or use an absolute data path. An installed wheel includes the interface assets but does not include credentials or existing manuals.

After changing `.env`, restart the server. `--reload` watches source changes; do not rely on it to reload environment configuration.

## Troubleshooting

| Symptom                                   | What to check                                                                                                                                               |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mantis: command not found`               | Activate the correct virtual environment and repeat `python -m pip install -e . --no-deps`. `python -m mantis` is an alternative.                           |
| Demo or API says server unavailable       | Run the application server; opening HTML directly does not provide the API. Check the address and port.                                                     |
| PDF analysis is not configured            | Set `OPENAI_API_KEY` in the working directory's `.env`, then restart. Demo mode remains available without a key.                                            |
| AI service could not complete the request | Check key validity, model access, provider quota, and network connectivity. The health flag only checks key presence.                                       |
| Invalid Host header                       | Add the hostname to `MANTIS_ALLOWED_HOSTS`; keep loopback binding for local use.                                                                            |
| Empty library after a restart             | Check working directory/data path, browser profile, and hostname. Clearing the workspace cookie loses access to its documents.                              |
| No readable text / scan-only PDF          | Run OCR outside Mantis, then upload the text-based result. Integrated OCR is not included.                                                                  |
| No supporting information                 | Select the correct manual and include a component or fault code. Evaluate retrieval settings against representative examples before changing the threshold. |
| Cookie does not persist over local HTTP   | Use `MANTIS_SECURE_COOKIE=false` locally. Secure cookies require HTTPS.                                                                                     |

See [configuration](configuration.md), [API usage](api.md), and [deployment boundaries](deployment.md).
