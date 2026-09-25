#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ -x venv/bin/python ]]; then
  exec venv/bin/python assistant.py "$@"
fi
echo "Create the venv first: python3 -m venv venv && venv/bin/pip install -r requirements.txt"
exit 1
