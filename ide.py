#!/usr/bin/env python3
"""
ide.py — Hola IDE Native Desktop Launcher
Starts the FastAPI backend, then opens Hola IDE in a standalone native desktop window.
Usage:
  python ide.py            # Opens standalone desktop app window (Chromium/Chrome)
  python ide.py --gtk      # Opens via PyWebView GTK
  python ide.py --browser  # Opens in default browser tab
"""
from __future__ import annotations

import os
import sys

# Auto re-exec into project venv if running with system python
_venv_python = os.path.join(os.path.dirname(os.path.abspath(__file__)), "venv", "bin", "python")
if os.path.exists(_venv_python) and os.path.realpath(sys.executable) != os.path.realpath(_venv_python):
    os.execv(_venv_python, [_venv_python] + sys.argv)

import shutil
import subprocess
import threading
import time
import urllib.request
import webbrowser

import uvicorn

from voice_assistant.config import Settings
from voice_assistant.web.app import create_app

HOST = "127.0.0.1"
PORT = 8765
URL = f"http://{HOST}:{PORT}/"


def _start_server(settings: Settings) -> None:
    app = create_app(settings)
    config = uvicorn.Config(app, host=HOST, port=PORT, log_level="warning")
    server = uvicorn.Server(config)
    server.run()


def _launch_desktop_app(url: str) -> bool:
    """Launch as an isolated standalone native desktop window using Chromium/Chrome/Brave."""
    browsers = ["google-chrome", "google-chrome-stable", "chromium-browser", "chromium", "brave-browser"]
    user_data_dir = os.path.expanduser("~/.config/hola-ide/profile")
    os.makedirs(user_data_dir, exist_ok=True)

    for b in browsers:
        path = shutil.which(b)
        if path:
            print(f"🚀 Launching Hola IDE Desktop App ({b})...")
            cmd = [
                path,
                f"--app={url}",
                f"--user-data-dir={user_data_dir}",
                "--window-size=1400,900",
                "--class=hola-ide",
                "--name=Hola IDE",
                "--no-first-run",
                "--no-default-browser-check",
            ]
            try:
                proc = subprocess.Popen(cmd)
                proc.wait()
                return True
            except Exception as e:
                print(f"[!] Browser launcher error: {e}")
                return False
    return False


def _launch_pywebview(url: str, debug: bool = False) -> None:
    """Fallback GTK PyWebView launcher."""
    import webview
    print("🚀 Opening Hola IDE via PyWebView GTK...")
    window = webview.create_window(
        title="Hola IDE",
        url=url,
        width=1400,
        height=900,
        min_size=(900, 600),
        background_color="#07080f",
        resizable=True,
        text_select=True,
    )
    webview.start(debug=debug)


def main() -> None:
    print("✨ Starting Hola IDE backend...")
    settings = Settings.from_env()

    # Start FastAPI backend in background thread
    t = threading.Thread(target=_start_server, args=(settings,), daemon=True)
    t.start()

    # Wait for backend readiness
    server_ready = False
    for _ in range(40):
        try:
            with urllib.request.urlopen(f"http://{HOST}:{PORT}/api/state", timeout=1) as resp:
                if resp.status == 200:
                    server_ready = True
                    break
        except Exception:
            time.sleep(0.2)

    if not server_ready:
        print("[!] Error: Backend server failed to respond within 8 seconds.")
        sys.exit(1)

    print(f"⚡ Backend ready at {URL}")

    # Mode 0: Server only (headless background)
    if "--server-only" in sys.argv:
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            pass
        sys.exit(0)

    # Mode 1: Browser tab
    if "--browser" in sys.argv:
        print(f"🌐 Opening {URL} in default browser...")
        webbrowser.open(URL)
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            pass
        sys.exit(0)

    # Mode 2: Explicit GTK PyWebView
    if "--gtk" in sys.argv or "--pywebview" in sys.argv:
        try:
            _launch_pywebview(URL, debug="--debug" in sys.argv)
            sys.exit(0)
        except Exception as e:
            print(f"[!] PyWebView failed ({e}), falling back to desktop app...")

    # Mode 3 (Default): Standalone Chromium Desktop App Window (Fast, stable, zero crash)
    if not _launch_desktop_app(URL):
        print("[!] Chrome/Chromium not found, launching PyWebView...")
        try:
            _launch_pywebview(URL, debug="--debug" in sys.argv)
        except Exception as e:
            print(f"[!] PyWebView failed ({e}), opening in default browser...")
            webbrowser.open(URL)
            try:
                while True:
                    time.sleep(1)
            except KeyboardInterrupt:
                pass


if __name__ == "__main__":
    main()
