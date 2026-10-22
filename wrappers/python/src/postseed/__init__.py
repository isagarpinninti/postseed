"""Postseed for Python: realistic, relationship-correct seed data for PostgreSQL.

This package carries the same engine as the ``postseed`` npm package and runs it with Node.js 20 or newer.
Use the ``postseed`` command, or call :func:`generate` to get seed SQL for a schema from Python.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Dict, List, Mapping, Optional, Sequence

__all__ = ["__version__", "PostseedError", "NodeNotFoundError", "find_node", "run", "generate"]
__version__ = "0.1.0"

MIN_NODE = 20
ENGINE = Path(__file__).resolve().parent / "_engine" / "postseed.mjs"


class PostseedError(RuntimeError):
    """The Postseed engine reported an error."""


class NodeNotFoundError(PostseedError):
    """Node.js 20 or newer is required and was not found."""


def find_node() -> str:
    """Path of a Node.js 20+ executable. Set POSTSEED_NODE to choose one explicitly."""
    candidate = os.environ.get("POSTSEED_NODE") or shutil.which("node") or shutil.which("nodejs")
    if not candidate:
        raise NodeNotFoundError(
            "Postseed needs Node.js %d or newer, and none was found on your PATH. "
            "Install it from https://nodejs.org (or set POSTSEED_NODE to the node executable)." % MIN_NODE
        )
    try:
        out = subprocess.run([candidate, "--version"], capture_output=True, text=True, timeout=15).stdout.strip()
        major = int(out.lstrip("v").split(".")[0])
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        raise NodeNotFoundError(
            "Could not run Node.js at %s (%s). Postseed needs Node.js %d or newer; "
            "install it from https://nodejs.org or fix POSTSEED_NODE." % (candidate, exc, MIN_NODE)
        ) from exc
    if major < MIN_NODE:
        raise NodeNotFoundError("Postseed needs Node.js %d or newer; found %s at %s." % (MIN_NODE, out, candidate))
    return candidate


def _command(args: Sequence[str]) -> List[str]:
    if not ENGINE.exists():
        raise PostseedError("The bundled engine is missing (%s). Reinstall the postseed package." % ENGINE)
    return [find_node(), str(ENGINE), *args]


def run(
    args: Sequence[str],
    *,
    input: Optional[str] = None,
    cwd: Optional[str] = None,
    env: Optional[Mapping[str, str]] = None,
) -> "subprocess.CompletedProcess[str]":
    """Run the Postseed CLI and capture its output. Does not raise on a non-zero exit."""
    return subprocess.run(
        _command(args),
        input=input,
        capture_output=True,
        text=True,
        encoding="utf-8",
        cwd=cwd,
        env={**os.environ, **env} if env else None,
    )


def generate(
    schema_sql: str,
    *,
    rows: int = 50,
    seed: int = 42,
    format: str = "sql",
    tables: Optional[Sequence[str]] = None,
    table_rows: Optional[Mapping[str, int]] = None,
    null_ratio: Optional[float] = None,
    now: Optional[str] = None,
) -> str:
    """Generate seed data for a ``CREATE TABLE`` script and return it as text.

    ``format`` is ``"sql"`` or ``"json"`` (CSV writes several files; use the CLI with ``--out``).
    The same schema, seed and Postseed version always return identical text. Raises
    :class:`PostseedError` with the engine's message if generation fails.
    """
    if format not in ("sql", "json"):
        raise ValueError('format must be "sql" or "json" (use the CLI for csv)')
    args = ["generate", "--schema", "-", "--rows", str(int(rows)), "--seed", str(int(seed)), "--format", format]
    if tables:
        args += ["--tables", ",".join(tables)]
    if table_rows:
        args += ["--table-rows", ",".join("%s=%d" % (k, v) for k, v in table_rows.items())]
    if null_ratio is not None:
        args += ["--null-ratio", str(null_ratio)]
    if now:
        args += ["--now", now]
    done = run(args, input=schema_sql)
    if done.returncode != 0:
        raise PostseedError((done.stderr or done.stdout).strip() or "postseed exited with %d" % done.returncode)
    if format == "json":
        json.loads(done.stdout)  # fail loudly if the output is not valid JSON
    return done.stdout
