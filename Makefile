PYTHON ?= python3

.PHONY: install run check format
install:
	$(PYTHON) -m pip install -r requirements.lock
	$(PYTHON) -m pip install -e . --no-deps
	npm ci --ignore-scripts

run:
	$(PYTHON) -m mantis --reload

check:
	$(PYTHON) -m pytest -q
	$(PYTHON) -m ruff check app.py mantis tests scripts
	$(PYTHON) -m ruff format --check app.py mantis tests scripts
	npm run check
	npm test
	npm run format:check

format:
	$(PYTHON) -m ruff format app.py mantis tests scripts
	npm run format
