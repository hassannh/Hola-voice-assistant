class AssistantError(Exception):
    """Base error for the voice assistant."""


class AudioDeviceError(AssistantError):
    """Microphone or speaker could not be used."""


class SpeechToTextError(AssistantError):
    """Transcription failed."""


class LanguageModelError(AssistantError):
    """The LLM could not be reached or did not return a reply."""


class TextToSpeechError(AssistantError):
    """Spoken output failed."""
