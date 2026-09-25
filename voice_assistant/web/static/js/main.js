/**
 * main.js — App bootstrap & event wiring
 * Depends on: audio.js, pagination.js, api.js, ui.js, ws.js
 */
(async () => {
  // ── Bootstrap ────────────────────────────────────────────────
  UIModule.init();
  AudioModule.drawSynthetic(0);
  WSModule.connect();

  let _isRunning = false;

  // ── Load initial state ────────────────────────────────────────
  async function loadState() {
    try {
      const data = await API.loadState();
      UIModule.fillSettings(data.settings, data.devices);
      UIModule.renderTools(data.tools);
      UIModule.renderNotes(data.notes);
      UIModule.updateOllamaPill(data.ollama);

      _isRunning = data.running;
      WSModule.setRunning(_isRunning);
      UIModule.setRunningState(_isRunning);
      UIModule.updateAgentState(data.status, data.status, _isRunning);

      if (data.history?.length > 0) {
        data.history
          .filter((m) => m.role !== "system")
          .forEach((m) => UIModule.appendMessage(m.role, m.content));
      }
    } catch (err) {
      UIModule.showToast("Failed loading state: " + err.message);
    }
  }

  await loadState();

  // ── Download Model (Ollama pull) ──────────────────────────────
  const pullModelBtn = document.getElementById("pullModelBtn");
  if (pullModelBtn) {
    pullModelBtn.addEventListener("click", async () => {
      const modelName = document.getElementById("activeModelName")?.textContent || "model";
      UIModule.startPullBanner(modelName);
      pullModelBtn.hidden = true;
      try {
        const data = await API.pullModel();
        if (!data.ok) {
          UIModule.showToast("Pull failed: " + (data.error || "Unknown error"));
        }
      } catch (err) {
        UIModule.showToast("Pull error: " + err.message);
      }
    });
  }

  // Dismiss pull banner
  const dlDismissBtn = document.getElementById("dlDismissBtn");
  if (dlDismissBtn) {
    dlDismissBtn.addEventListener("click", () => {
      const banner = document.getElementById("ollamaDownloadBanner");
      if (banner) banner.hidden = true;
    });
  }

  // ── Start / Stop assistant ────────────────────────────────────
  document.getElementById("toggleVoiceBtn").addEventListener("click", async () => {
    try {
      if (!_isRunning) {
        UIModule.updateAgentState("listening", "Starting microphone…", false);
        const data = await API.start();
        if (data.ok) {
          _isRunning = true;
          WSModule.setRunning(true);
          UIModule.setRunningState(true);
          UIModule.showToast("Hola voice loop started");
        } else {
          UIModule.showToast("Failed to start: " + (data.error || "Unknown"));
          UIModule.updateAgentState("error", data.error, false);
        }
      } else {
        const data = await API.stop();
        if (data.ok) {
          _isRunning = false;
          WSModule.setRunning(false);
          UIModule.setRunningState(false);
          UIModule.updateAgentState("idle", "Assistant stopped", false);
          UIModule.showToast("Hola voice loop stopped");
        }
      }
    } catch (err) {
      UIModule.showToast("Error: " + err.message);
    }
  });

  // ── Mic Test ──────────────────────────────────────────────────
  document.getElementById("testMicBtn").addEventListener("click", () => {
    AudioModule.toggle(_isRunning);
  });

  // ── Clear chat history ────────────────────────────────────────
  document.getElementById("clearHistoryBtn").addEventListener("click", async () => {
    if (!confirm("Clear conversation history?")) return;
    try {
      await API.clear();
      UIModule.clearChat();
      UIModule.showToast("History cleared");
    } catch (err) {
      UIModule.showToast("Error: " + err.message);
    }
  });

  // ── Quick Action Chips ────────────────────────────────────────
  document.querySelectorAll(".prompt-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const input = document.getElementById("promptInput");
      input.value = chip.dataset.query;
      document.getElementById("textChatForm").dispatchEvent(new Event("submit"));
    });
  });

  // ── Text chat submit ──────────────────────────────────────────
  document.getElementById("textChatForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("promptInput");
    const text  = input.value.trim();
    if (!text) return;

    input.value = "";
    UIModule.appendMessage("user", text);
    UIModule.startAssistantStream();
    UIModule.updateAgentState("thinking", "Thinking…", _isRunning);

    const speak = document.getElementById("speakReplyToggle").checked;
    try {
      const data = await API.chat(text, speak);
      if (!data.ok) {
        UIModule.finishAssistantStream("Error: " + (data.error || "Execution failed"));
        UIModule.updateAgentState("error", data.error, _isRunning);
      } else {
        UIModule.finishAssistantStream(data.reply);
        UIModule.updateAgentState("idle", "Ready", _isRunning);
      }
    } catch (err) {
      UIModule.finishAssistantStream("Network error: " + err.message);
      UIModule.updateAgentState("error", err.message, _isRunning);
    }
  });

  // ── Settings save ─────────────────────────────────────────────
  document.getElementById("settingsForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const dev = document.getElementById("input_device").value;
    const payload = {
      stt_model_size:     document.getElementById("stt_model_size").value,
      llm_model:          document.getElementById("llm_model").value,
      wake_word:          document.getElementById("wake_word").value || null,
      adaptive_vad:       document.getElementById("adaptive_vad").checked,
      use_vad:            document.getElementById("use_vad").checked,
      enable_tools:       document.getElementById("enable_tools").checked,
      stream_tokens:      document.getElementById("stream_tokens").checked,
      tts_rate:           Number(document.getElementById("tts_rate").value),
      max_record_seconds: Number(document.getElementById("max_record_seconds").value),
      system_prompt:      document.getElementById("system_prompt").value,
      input_device:       dev === "" ? null : Number(dev),
    };
    try {
      const data = await API.saveSettings(payload);
      if (data.ok) {
        UIModule.showToast("Configuration saved successfully!");
        loadState();
      } else {
        UIModule.showToast("Error saving: " + data.error);
      }
    } catch (err) {
      UIModule.showToast("Commit failure: " + err.message);
    }
  });

  // ── Add Note ──────────────────────────────────────────────────
  document.getElementById("addNoteBtn").addEventListener("click", async () => {
    const input   = document.getElementById("noteInput");
    const content = input.value.trim();
    if (!content) return;
    input.value = "";
    try {
      await API.chat(`save a note: ${content}`, false);
      UIModule.showToast("Note saved to scratchpad");
      const data = await API.loadState();
      UIModule.renderNotes(data.notes);
    } catch (err) {
      UIModule.showToast("Storage error: " + err.message);
    }
  });
})();
