# Local Voice Assistant

Listens, transcribes, thinks with a local LLM, and speaks — on Windows and Linux.
A control dashboard lets you start/stop the loop and change settings.

```
Microphone → Whisper (STT) → Ollama (LLM) → pyttsx3 (TTS) → Speaker
```

## Setup

```bash
python -m venv venv
# Windows: venv\Scripts\activate
# Linux:   source venv/bin/activate
pip install -r requirements.txt
```

On Linux, install PortAudio (microphone) and a TTS backend:

```bash
sudo apt install libportaudio2 espeak-ng
```

Install [Ollama](https://ollama.com), then:

```bash
ollama pull llama3
```

On modest hardware: `ollama pull llama3.2:3b` and set `VOICE_LLM_MODEL=llama3.2:3b` (or change it in the dashboard).

Ollama must be running (`ollama serve` if it is not already).

## Run

Dashboard (default):

```bash
python assistant.py
```

Open http://127.0.0.1:8765 — start listening from the UI.

Terminal only:

```bash
python assistant.py --cli
```

Speak after **Listening…**. Say **exit**, **quit**, **stop**, or **goodbye**, or press Ctrl+C.

## Configuration

Environment variables (all optional):

| Variable | Default | Meaning |
|---|---|---|
| `VOICE_STT_MODEL` | `base` | Whisper size: tiny, base, small, medium, large |
| `VOICE_LLM_MODEL` | `llama3` | Ollama model name |
| `VOICE_RECORD_SECONDS` | `5` | Used when VAD is off |
| `VOICE_USE_VAD` | `true` | Stop recording after silence |
| `VOICE_TTS_RATE` | `175` | Speaking speed |
| `VOICE_INPUT_DEVICE` | system default | Microphone index |
| `VOICE_SYSTEM_PROMPT` | concise assistant | Personality |
| `VOICE_HOST` / `VOICE_PORT` | `127.0.0.1` / `8765` | Dashboard bind |

Settings can also be changed in the dashboard (stop listening first).

## Troubleshooting

| Problem | Fix |
|---|---|
| No microphone | `python -c "import sounddevice; print(sounddevice.query_devices())"` then pick the input device in the dashboard |
| PortAudio library not found | Linux: `sudo apt install libportaudio2` |
| Whisper is slow | Use `tiny` in the dashboard, or `VOICE_STT_MODEL=tiny` |
| Ollama is slow or missing | Pull a smaller model (`llama3.2:3b`, `phi3`) and set `VOICE_LLM_MODEL` |
| No spoken output on Linux | Install `espeak-ng` |
| Mishears you | Reduce noise, or turn VAD off and raise record seconds |

## Layout

- `assistant.py` — entry point
- `voice_assistant/` — config, audio, STT, LLM, TTS, pipeline, dashboard
- Speech, thinking, and speaking are separate modules so Piper TTS or another LLM can replace one piece later.
