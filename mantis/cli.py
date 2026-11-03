"""Run the local Mantis application from a source checkout or installed wheel."""

import argparse

import uvicorn


def main():
    parser = argparse.ArgumentParser(description="Mantis maintenance workspace")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--reload", action="store_true")
    args = parser.parse_args()
    uvicorn.run("mantis.main:app", host=args.host, port=args.port, reload=args.reload)
