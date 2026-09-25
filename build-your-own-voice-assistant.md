# Build my Own Voice Assistant (Local, Speaks & Answers premuim ui Dashboard to contoll)

A practical guide to building a working voice assistant on your own PC: it listens, thinks, and talks back.

The pipeline has 3 stages, looped:

```
🎤 Listen (Speech-to-Text) → 🧠 Think (LLM) → 🔊 Speak (Text-to-Speech) → repeat
```

---

## 1. Decide Your Setup

Before installing anything, make two choices:

### A) Offline vs. API-based "brain"
| | Offline (local LLM) | API (Claude / OpenAI / Gemini) |
|---|---|---|
| Cost | Free | Pay per use |
| Privacy | Fully private | Sent to a cloud provider |
| Internet | Not required | Required |
| Quality | Good, depends on model size & hardware | Best-in-class |
| Setup | Slightly more setup (Ollama) | Just an API key |

**Recommendation for beginners:** start offline with Ollama — it's free, private, and simple. You can swap in an API later.

### B) Voice quality
| | pyttsx3 | Piper TTS | ElevenLabs (API) |
|---|---|---|---|
| Sound | Robotic | Natural | Very natural |
| Cost | Free | Free | Paid |
| Setup | Easiest | Moderate | Easy but needs API key |

**Recommendation:** start with `pyttsx3` to get something working fast, then upgrade to Piper once the pipeline works.

---

## 2. Install Prerequisites

You need Python 3.9+ installed. Check with:

```bash
python --version
```

### Install the Python packages

```bash
pip install faster-whisper sounddevice numpy pyttsx3 ollama
```

### Install Ollama (the local "brain")

1. Download from **https://ollama.com** and install it for your OS (Windows/Mac/Linux all supported).
2. Pull a model (one-time download):
   ```bash
   ollama pull llama3
   ```
   Smaller/faster alternative if your PC is modest: `ollama pull llama3.2:3b` or `ollama pull phi3`.
3. Test it works:
   ```bash
   ollama run llama3
   ```
   Type a message, confirm you get a reply, then exit (`/bye`).

---

## 3. The Full Working Script

Save this as `assistant.py`:

```python
import sounddevice as sd
import numpy as np
from faster_whisper import WhisperModel
import pyttsx3
import ollama

# ---- Setup (runs once) ----
print("Loading speech-to-text model...")
stt_model = WhisperModel("base")  # options: tiny, base, small, medium, large

tts_engine = pyttsx3.init()
tts_engine.setProperty('rate', 175)  # speaking speed

conversation_history = []

# ---- Step 1: Record from microphone ----
def record(duration=5, fs=16000):
    print("Listening...")
    audio = sd.rec(int(duration * fs), samplerate=fs, channels=1, dtype='int16')
    sd.wait()
    return audio

# ---- Step 2: Transcribe speech to text ----
def transcribe(audio, fs=16000):
    audio_float = audio.flatten().astype(np.float32) / 32768.0
    segments, _ = stt_model.transcribe(audio_float)
    return " ".join(segment.text for segment in segments).strip()

# ---- Step 3: Get a reply from the LLM ----
def think(user_text):
    conversation_history.append({'role': 'user', 'content': user_text})
    response = ollama.chat(model='llama3', messages=conversation_history)
    reply = response['message']['content']
    conversation_history.append({'role': 'assistant', 'content': reply})
    return reply

# ---- Step 4: Speak the reply ----
def speak(text):
    tts_engine.say(text)
    tts_engine.runAndWait()

# ---- Main loop ----
if __name__ == "__main__":
    print("Voice assistant ready. Press Ctrl+C to stop.")
    try:
        while True:
            audio = record(duration=5)
            user_text = transcribe(audio)

            if not user_text:
                continue

            print(f"You said: {user_text}")

            if user_text.lower().strip() in ("exit", "quit", "stop"):
                speak("Goodbye!")
                break

            reply = think(user_text)
            print(f"Assistant: {reply}")
            speak(reply)

    except KeyboardInterrupt:
        print("\nStopped.")
```

Run it:

```bash
python assistant.py
```

Speak for up to 5 seconds after "Listening..." appears, then wait for the reply.

---

## 4. Troubleshooting

| Problem | Fix |
|---|---|
| `sounddevice` can't find a microphone | Run `python -c "import sounddevice; print(sounddevice.query_devices())"` to list devices, then set the right input device with `sd.default.device` |
| Whisper is slow | Use a smaller model: `WhisperModel("tiny")` |
| Ollama replies are slow | Use a smaller model, e.g. `llama3.2:3b` or `phi3` |
| No sound output | Check `pyttsx3` found a TTS voice: `for v in tts_engine.getProperty('voices'): print(v.name)` |
| Assistant mishears you | Speak clearly, reduce background noise, or increase `duration` in `record()` |

---

## 5. Upgrades Once This Works

Once the basic loop works, consider these improvements, roughly in order of impact:

1. **Wake word detection** — so it's not always recording. Try `openWakeWord` (free, offline) or Porcupine (free tier available).
2. **Better voice (Piper TTS)** — natural-sounding offline speech.
   - Install: https://github.com/rhasspy/piper
   - Swap out the `speak()` function to call Piper instead of `pyttsx3`.
3. **Streaming instead of fixed-duration recording** — detect when you stop talking (voice activity detection) instead of always recording exactly 5 seconds. Library: `webrtcvad`.
4. **Continuous listening loop** — run it as a background service that's always ready, rather than needing to be manually restarted.
5. **Custom personality/system prompt** — add a system message to `conversation_history` at startup, e.g.:
   ```python
   conversation_history.append({
       'role': 'system',
       'content': 'You are a concise, friendly assistant. Keep replies short.'
   })
   ```

---

## 6. Quick Reference: What Each Tool Does

- **sounddevice** — captures audio from your microphone
- **faster-whisper** — converts your speech into text (offline)
- **ollama** — runs a local LLM that generates the reply
- **pyttsx3** — converts the reply text into spoken audio (offline)

That's the full loop: mic → text → LLM → speech → speaker.









notic : it must work on windows and linux 