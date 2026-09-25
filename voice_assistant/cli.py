from __future__ import annotations

import argparse
import logging
import sys

from voice_assistant.config import Settings
from voice_assistant.runtime import AssistantRuntime


def configure_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Local voice assistant (Windows and Linux)."
    )
    parser.add_argument(
        "--cli",
        action="store_true",
        help="Run the listen/think/speak loop in the terminal (no dashboard).",
    )
    parser.add_argument(
        "--ui",
        action="store_true",
        help="Open the control dashboard (default).",
    )
    parser.add_argument("--host", default=None, help="Dashboard bind address.")
    parser.add_argument("--port", type=int, default=None, help="Dashboard port.")
    return parser


def run_cli(runtime: AssistantRuntime) -> None:
    def on_event(kind: str, text: str | None) -> None:
        if kind == "listening":
            print("Listening…")
        elif kind == "user":
            print(f"You said: {text}")
        elif kind == "assistant":
            print(f"Assistant: {text}")
        elif kind == "error":
            print(f"Error: {text}", file=sys.stderr)
        elif kind == "idle" and text == "No speech heard":
            pass

    runtime.set_event_handler(on_event)
    print("Loading models…")
    runtime.ensure_loaded()
    print("Voice assistant ready. Press Ctrl+C to stop.")
    try:
        runtime.start()
        if runtime.pipeline:
            runtime.pipeline.join()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        runtime.stop()
        if runtime.pipeline:
            runtime.pipeline.join(timeout=2)


def run_ui(settings: Settings) -> None:
    from voice_assistant.web.app import serve

    serve(settings)


def main(argv: list[str] | None = None) -> None:
    configure_logging()
    args = build_parser().parse_args(argv)
    settings = Settings.from_env()
    if args.host:
        settings = settings.updated(host=args.host)
    if args.port:
        settings = settings.updated(port=args.port)

    use_cli = args.cli and not args.ui
    if use_cli:
        run_cli(AssistantRuntime(settings))
        return
    run_ui(settings)


if __name__ == "__main__":
    main()
