from __future__ import annotations

from typing import Callable, Optional

import numpy as np

from voice_assistant.config import Settings
from voice_assistant.exceptions import AudioDeviceError


def _sounddevice():
    try:
        import sounddevice as sd
    except OSError as exc:
        raise AudioDeviceError(
            "PortAudio is not installed. On Linux: sudo apt install libportaudio2. "
            "On Windows, reinstall the sounddevice package."
        ) from exc
    return sd


def audio_backend_error() -> Optional[str]:
    try:
        _sounddevice()
    except AudioDeviceError as exc:
        return str(exc)
    return None


def list_input_devices() -> list[dict]:
    try:
        sd = _sounddevice()
        devices = sd.query_devices()
    except AudioDeviceError:
        return []
    except Exception:
        return []
    result = []
    for index, device in enumerate(devices):
        if int(device.get("max_input_channels", 0)) <= 0:
            continue
        result.append(
            {
                "id": index,
                "name": device.get("name", f"Device {index}"),
                "channels": int(device.get("max_input_channels", 0)),
                "default_samplerate": device.get("default_samplerate"),
            }
        )
    return result


def _select_device(settings: Settings) -> Optional[int]:
    if settings.input_device is not None:
        return settings.input_device
    try:
        default = _sounddevice().default.device
        if isinstance(default, (list, tuple)):
            return int(default[0]) if default[0] is not None else None
        return int(default) if default is not None else None
    except Exception:
        return None


def record_audio(
    settings: Settings, on_level: Optional[Callable[[float], None]] = None
) -> np.ndarray:
    sd = _sounddevice()
    device = _select_device(settings)
    try:
        if settings.use_vad:
            return _record_until_silence(sd, settings, device, on_level=on_level)
        frames = int(settings.record_seconds * settings.sample_rate)
        audio = sd.rec(
            frames,
            samplerate=settings.sample_rate,
            channels=1,
            dtype="int16",
            device=device,
        )
        sd.wait()
        return audio
    except AudioDeviceError:
        raise
    except Exception as exc:
        raise AudioDeviceError(
            "Could not record from the microphone. Check the input device."
        ) from exc


def _record_until_silence(
    sd,
    settings: Settings,
    device: Optional[int],
    on_level: Optional[Callable[[float], None]] = None,
) -> np.ndarray:
    chunk_seconds = 0.03
    chunk_size = max(int(settings.sample_rate * chunk_seconds), 1)
    max_chunks = int(settings.max_record_seconds / chunk_seconds)
    silence_chunks_needed = max(int(settings.vad_silence_seconds / chunk_seconds), 1)
    calib_chunks = max(int(0.2 / chunk_seconds), 2)

    started = False
    silent_run = 0
    chunks: list[np.ndarray] = []
    initial_rms_samples: list[float] = []
    threshold_rms = settings.vad_start_rms

    with sd.InputStream(
        samplerate=settings.sample_rate,
        channels=1,
        dtype="int16",
        device=device,
        blocksize=chunk_size,
    ) as stream:
        for _ in range(max_chunks):
            data, overflowed = stream.read(chunk_size)
            chunks.append(data.copy())
            rms = float(np.sqrt(np.mean((data.astype(np.float32) / 32768.0) ** 2)))

            if on_level:
                # Normalized level between 0.0 and 1.0 for visualizer
                normalized_level = min(1.0, max(0.0, float(rms * 35.0)))
                try:
                    on_level(normalized_level)
                except Exception:
                    pass

            if not started:
                # Dynamic calibration during the first 200ms
                if settings.adaptive_vad and len(initial_rms_samples) < calib_chunks:
                    initial_rms_samples.append(rms)
                    if len(initial_rms_samples) == calib_chunks:
                        noise_floor = float(np.mean(initial_rms_samples))
                        # Adapt threshold dynamically: 2.2x ambient noise floor or min configured
                        threshold_rms = max(settings.vad_start_rms, noise_floor * 2.2)

                if rms >= threshold_rms:
                    started = True
                    silent_run = 0
                # Drop excessive leading silence so Whisper is not fed long quiet audio
                elif len(chunks) > int(1.2 / chunk_seconds):
                    chunks = chunks[-int(0.3 / chunk_seconds) :]
                continue

            # Speech in progress: check for silence drop
            silence_floor = threshold_rms * 0.65
            if rms < silence_floor:
                silent_run += 1
                if silent_run >= silence_chunks_needed:
                    break
            else:
                silent_run = 0

    if not chunks:
        return np.zeros((0, 1), dtype=np.int16)
    return np.concatenate(chunks, axis=0)
