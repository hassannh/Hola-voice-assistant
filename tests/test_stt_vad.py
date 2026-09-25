from __future__ import annotations

from voice_assistant.stt import match_wake_word


def test_wake_word_disabled():
    matched, remainder = match_wake_word("What time is it?", None)
    assert matched is True
    assert remainder == "What time is it?"

    matched, remainder = match_wake_word("What time is it?", "")
    assert matched is True
    assert remainder == "What time is it?"


def test_wake_word_matching():
    # Wake word at beginning
    matched, remainder = match_wake_word("Hey assistant, what is the weather?", "hey assistant")
    assert matched is True
    assert remainder == "what is the weather?"

    # Wake word alone
    matched, remainder = match_wake_word("Hey Assistant!", "hey assistant")
    assert matched is True
    assert remainder == ""

    # Wake word missing
    matched, remainder = match_wake_word("What time is it?", "hey assistant")
    assert matched is False
