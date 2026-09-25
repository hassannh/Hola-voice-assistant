from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def _venv_python() -> Path:
    if os.name == "nt":
        return ROOT / "venv" / "Scripts" / "python.exe"
    return ROOT / "venv" / "bin" / "python"


if __name__ == "__main__":
    venv_python = _venv_python()
    in_venv = Path(sys.prefix).resolve() == (ROOT / "venv").resolve()
    if venv_python.exists() and not in_venv:
        os.execv(str(venv_python), [str(venv_python), *sys.argv])

    from voice_assistant.cli import main

    main()
