"""The ``postseed`` command: runs the bundled engine with Node.js and passes everything through."""

from __future__ import annotations

import subprocess
import sys
from typing import List, Optional

from . import NodeNotFoundError, PostseedError, _command


def main(argv: Optional[List[str]] = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    try:
        command = _command(args)
    except NodeNotFoundError as exc:
        sys.stderr.write("postseed: %s\n" % exc)
        return 127
    except PostseedError as exc:
        sys.stderr.write("postseed: %s\n" % exc)
        return 1
    try:
        return subprocess.call(command)
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main())
