// DOM Elements
const arcReactor = document.getElementById("arcReactor");
const orbStatusMessage = document.getElementById("orbStatusMessage");
const eqBands = document.querySelectorAll("#eqBands .eq-bar");
const levelValue = document.getElementById("levelValue");
const toggleVoiceBtn = document.getElementById("toggleVoiceBtn");
const toggleVoiceText = document.getElementById("toggleVoiceText");
const clearHistoryBtn = document.getElementById("clearHistoryBtn");
const chatHistory = document.getElementById("chatHistory");
const textChatForm = document.getElementById("textChatForm");
const promptInput = document.getElementById("promptInput");
const speakReplyToggle = document.getElementById("speakReplyToggle");

const ollamaPill = document.getElementById("ollamaPill");
const ollamaStatusText = document.getElementById("ollamaStatusText");
const agentStatePill = document.getElementById("agentStatePill");
const agentStateText = document.getElementById("agentStateText");
const tickerModel = document.getElementById("tickerModel");

const settingsForm = document.getElementById("settingsForm");
const deviceSelect = document.getElementById("input_device");
const toolsList = document.getElementById("toolsList");
const notesList = document.getElementById("notesList");
const noteInput = document.getElementById("noteInput");
const addNoteBtn = document.getElementById("addNoteBtn");
const toast = document.getElementById("toast");
const sfxToggleBtn = document.getElementById("sfxToggleBtn");
const sfxIcon = document.getElementById("sfxIcon");

let isRunning = false;
let currentAssistantBubble = null;
let currentAssistantContent = null;
let sfxEnabled = true;
let audioCtx = null;
let eqInterval = null;

// Stark Industries Web Audio API Synthesizer (Futuristic SFX)
function playHologramTone(type = "chirp") {
  if (!sfxEnabled) return;
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    const now = audioCtx.currentTime;

    if (type === "chirp") {
      // Tech double chirp
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.exponentialRampToValueAtTime(1760, now + 0.08);
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc.start(now);
      osc.stop(now + 0.12);
    } else if (type === "engage") {
      // Reactor startup pulse
      osc.type = "triangle";
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(1320, now + 0.18);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      osc.start(now);
      osc.stop(now + 0.22);
    } else if (type === "tool") {
      // Data blip
      osc.type = "sine";
      osc.frequency.setValueAtTime(1200, now);
      osc.frequency.setValueAtTime(1800, now + 0.04);
      gain.gain.setValueAtTime(0.04, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
      osc.start(now);
      osc.stop(now + 0.09);
    } else if (type === "transmit") {
      // Transmission sweep
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(600, now);
      osc.frequency.exponentialRampToValueAtTime(2400, now + 0.14);
      gain.gain.setValueAtTime(0.05, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
      osc.start(now);
      osc.stop(now + 0.16);
    }
  } catch (e) {
    // AudioContext blocked before interaction
  }
}

// SFX Toggle
sfxToggleBtn.addEventListener("click", () => {
  sfxEnabled = !sfxEnabled;
  sfxIcon.textContent = sfxEnabled ? "🔊" : "🔇";
  showToast(sfxEnabled ? "JARVIS SFX // ENGAGED" : "JARVIS SFX // MUTED");
  if (sfxEnabled) playHologramTone("chirp");
});

// Tab Switching
document.querySelectorAll(".hud-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".hud-tab").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".hud-tab-content").forEach((c) => c.classList.remove("active"));
    btn.classList.add("active");
    const target = document.getElementById(`tab${btn.dataset.tab.charAt(0).toUpperCase() + btn.dataset.tab.slice(1)}`);
    if (target) target.classList.add("active");
    playHologramTone("chirp");
  });
});

// Toast notification
function showToast(msg, duration = 3000) {
  toast.textContent = msg;
  toast.hidden = false;
  setTimeout(() => {
    toast.hidden = true;
  }, duration);
}

// Update Equalizer Bars from Audio Level
function setEqualizerLevel(normLevel) {
  const db = (normLevel * 36 - 36).toFixed(1);
  levelValue.textContent = `${db} dB`;

  eqBands.forEach((bar, idx) => {
    const variance = Math.sin(idx * 0.7 + Date.now() * 0.01) * 0.35 + 0.65;
    const height = Math.max(4, Math.min(26, normLevel * 26 * variance));
    bar.style.height = `${height}px`;
  });
}

// Start synthetic animated speech waveform
function startSpeakingWaveform() {
  if (eqInterval) clearInterval(eqInterval);
  eqInterval = setInterval(() => {
    eqBands.forEach((bar, idx) => {
      const h = Math.floor(Math.sin(Date.now() * 0.015 + idx * 0.5) * 10 + 14);
      bar.style.height = `${h}px`;
    });
    levelValue.textContent = "-12.4 dB";
  }, 50);
}

function stopSpeakingWaveform() {
  if (eqInterval) {
    clearInterval(eqInterval);
    eqInterval = null;
  }
  eqBands.forEach((bar) => (bar.style.height = "6px"));
  levelValue.textContent = "0.00 dB";
}

// Update Agent State & Arc Reactor HUD
function updateAgentState(state, text) {
  agentStatePill.className = `hud-pill state-pill ${state}`;
  agentStateText.textContent = text ? text.toUpperCase() : state.toUpperCase();

  arcReactor.className = `arc-reactor ${state}`;

  if (state === "listening") {
    orbStatusMessage.textContent = "Acoustic Sensors Active · Listening to your voice…";
  } else if (state === "transcribing") {
    orbStatusMessage.textContent = "Neural Transcribing Array · Decoding Speech Stream…";
    stopSpeakingWaveform();
  } else if (state === "thinking") {
    orbStatusMessage.textContent = "Stark Neural Core · Synthesizing Directive…";
    stopSpeakingWaveform();
  } else if (state === "speaking") {
    orbStatusMessage.textContent = "Audio Vocalization Active · Transmitting Response…";
    startSpeakingWaveform();
  } else if (state === "idle") {
    orbStatusMessage.textContent = isRunning ? "Tactical Audio Loop Active · Standby for Speech" : "System Standby · Awaiting Voice or Command";
    stopSpeakingWaveform();
  } else if (state === "error") {
    orbStatusMessage.textContent = text || "Diagnostic Alert // Check Log Feed";
    stopSpeakingWaveform();
  }
}

// Append Chat Message
function appendMessage(role, text) {
  const welcome = chatHistory.querySelector(".terminal-welcome-card");
  if (welcome) welcome.remove();

  const wrap = document.createElement("div");
  wrap.className = `chat-msg ${role}`;

  const bubble = document.createElement("div");
  bubble.className = "chat-bubble";
  bubble.textContent = text || "";

  const meta = document.createElement("div");
  meta.className = "msg-meta";
  const now = new Date();
  meta.textContent = `// ${role === "user" ? "USER_VOX" : "JARVIS_AI"} :: ${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;

  wrap.appendChild(bubble);
  wrap.appendChild(meta);
  chatHistory.appendChild(wrap);
  chatHistory.scrollTop = chatHistory.scrollHeight;

  return { wrap, bubble };
}

// Streaming Typewriter Logic
function startAssistantStream() {
  const welcome = chatHistory.querySelector(".terminal-welcome-card");
  if (welcome) welcome.remove();

  const wrap = document.createElement("div");
  wrap.className = "chat-msg assistant";

  const bubble = document.createElement("div");
  bubble.className = "chat-bubble";
  bubble.innerHTML = '<span class="cursor">▊</span>';

  const meta = document.createElement("div");
  meta.className = "msg-meta";
  const now = new Date();
  meta.textContent = `// JARVIS_AI :: ${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;

  wrap.appendChild(bubble);
  wrap.appendChild(meta);
  chatHistory.appendChild(wrap);
  chatHistory.scrollTop = chatHistory.scrollHeight;

  currentAssistantBubble = bubble;
  currentAssistantContent = "";
}

function appendStreamToken(token) {
  if (!currentAssistantBubble) {
    startAssistantStream();
  }
  currentAssistantContent += token;
  currentAssistantBubble.textContent = currentAssistantContent;
  chatHistory.scrollTop = chatHistory.scrollHeight;
}

function finishAssistantStream(finalText) {
  if (currentAssistantBubble) {
    currentAssistantBubble.textContent = finalText || currentAssistantContent;
    currentAssistantBubble = null;
    currentAssistantContent = null;
  }
  stopSpeakingWaveform();
}

function showToolExecution(toolName) {
  if (!currentAssistantBubble) {
    startAssistantStream();
  }
  playHologramTone("tool");
  const badge = document.createElement("div");
  badge.className = "tool-badge";
  badge.innerHTML = `⚡ <span>MODULE_EXEC: ${toolName}</span>`;
  currentAssistantBubble.parentNode.insertBefore(badge, currentAssistantBubble);
}

// Render Tools in Capabilities
function renderTools(tools) {
  toolsList.innerHTML = "";
  if (!tools || tools.length === 0) {
    toolsList.innerHTML = '<p class="field-tech-hint">No autonomous modules active.</p>';
    return;
  }
  tools.forEach((t) => {
    const card = document.createElement("div");
    card.className = "tool-card";
    card.innerHTML = `
      <div class="tool-title">⚡ ${t.name.toUpperCase()}</div>
      <div class="tool-desc">${t.description}</div>
    `;
    toolsList.appendChild(card);
  });
}

// Render Notes in Scratchpad
function renderNotes(notes) {
  notesList.innerHTML = "";
  if (!notes || notes.length === 0) {
    notesList.innerHTML = '<p class="field-tech-hint">Memorandum volume empty.</p>';
    return;
  }
  notes.forEach((n) => {
    const item = document.createElement("div");
    item.className = "note-item";
    const date = new Date(n.created_at * 1000).toLocaleString();
    item.innerHTML = `<div>${n.content}</div><div class="note-time">// STAMP: ${date}</div>`;
    notesList.appendChild(item);
  });
}

// Populate Settings
function fillSettings(settings, devices) {
  deviceSelect.innerHTML = "";
  const auto = document.createElement("option");
  auto.value = "";
  auto.textContent = "DEFAULT_SYSTEM_TRANSDUCER";
  deviceSelect.appendChild(auto);

  (devices || []).forEach((dev) => {
    const opt = document.createElement("option");
    opt.value = String(dev.id);
    opt.textContent = `[CH:${dev.channels}] ${dev.id}: ${dev.name.toUpperCase()}`;
    deviceSelect.appendChild(opt);
  });

  if (settings.input_device != null) {
    deviceSelect.value = String(settings.input_device);
  }

  document.getElementById("stt_model_size").value = settings.stt_model_size || "tiny";
  document.getElementById("llm_model").value = settings.llm_model || "llama3.2:3b";
  document.getElementById("wake_word").value = settings.wake_word || "";
  document.getElementById("adaptive_vad").checked = Boolean(settings.adaptive_vad);
  document.getElementById("use_vad").checked = Boolean(settings.use_vad);
  document.getElementById("enable_tools").checked = Boolean(settings.enable_tools);
  document.getElementById("stream_tokens").checked = Boolean(settings.stream_tokens);
  document.getElementById("tts_rate").value = settings.tts_rate || 175;
  document.getElementById("max_record_seconds").value = settings.max_record_seconds || 12;
  document.getElementById("system_prompt").value = settings.system_prompt || "";

  if (tickerModel) {
    tickerModel.textContent = (settings.llm_model || "LLAMA3.2").toUpperCase();
  }
}

// Update Ollama Link Status
function updateOllamaPill(ollama) {
  if (!ollama) return;
  if (ollama.reachable) {
    if (ollama.has_configured_model) {
      ollamaPill.className = "hud-pill ready";
      ollamaStatusText.textContent = "OLLAMA // ONLINE";
    } else {
      ollamaPill.className = "hud-pill warning";
      ollamaStatusText.textContent = "OLLAMA // MODEL_PENDING";
    }
  } else {
    ollamaPill.className = "hud-pill error";
    ollamaStatusText.textContent = "OLLAMA // OFFLINE";
  }
}

// Fetch State
async function loadState() {
  try {
    const res = await fetch("/api/state");
    const data = await res.json();

    fillSettings(data.settings, data.devices);
    renderTools(data.tools);
    renderNotes(data.notes);
    updateOllamaPill(data.ollama);

    isRunning = data.running;
    setRunningState(data.running);
    updateAgentState(data.status, data.status);

    if (data.history && data.history.length > 0) {
      chatHistory.innerHTML = "";
      data.history.forEach((msg) => {
        if (msg.role !== "system") {
          appendMessage(msg.role, msg.content);
        }
      });
    }
  } catch (err) {
    showToast("DIAGNOSTIC ALERT // STATE_LOAD_ERROR");
  }
}

function setRunningState(running) {
  isRunning = running;
  if (running) {
    toggleVoiceBtn.classList.add("running");
    toggleVoiceText.textContent = "TERMINATE AUDIO LINK";
  } else {
    toggleVoiceBtn.classList.remove("running");
    toggleVoiceText.textContent = "INITIALIZE AUDIO LINK";
  }
}

// Voice Toggle Handler
toggleVoiceBtn.addEventListener("click", async () => {
  if (!isRunning) {
    playHologramTone("engage");
    updateAgentState("listening", "INITIALIZING SENSORS…");
    const res = await fetch("/api/start", { method: "POST" });
    const data = await res.json();
    if (data.ok) {
      setRunningState(true);
      showToast("JARVIS // AUDIO PROTOCOL ENGAGED");
    } else {
      showToast("INITIALIZATION FAILURE: " + (data.error || "Unknown"));
      updateAgentState("error", data.error);
    }
  } else {
    playHologramTone("chirp");
    const res = await fetch("/api/stop", { method: "POST" });
    const data = await res.json();
    if (data.ok) {
      setRunningState(false);
      updateAgentState("idle", "AUDIO LINK DISENGAGED");
      showToast("JARVIS // AUDIO LINK DISENGAGED");
    }
  }
});

// Clear History
clearHistoryBtn.addEventListener("click", async () => {
  if (confirm("PURGE TACTICAL COMMUNICATION BUFFER?")) {
    playHologramTone("chirp");
    await fetch("/api/clear", { method: "POST" });
    chatHistory.innerHTML = `
      <div class="terminal-welcome-card">
        <div class="welcome-text-block">
          <h3>TACTICAL BUFFER PURGED</h3>
          <p>Memory stream clear. Ready for directives.</p>
        </div>
      </div>
    `;
    showToast("BUFFER PURGED");
  }
});

// Directive Quick Chips
document.querySelectorAll(".hud-chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    playHologramTone("chirp");
    promptInput.value = chip.dataset.query;
    textChatForm.dispatchEvent(new Event("submit"));
  });
});

// Text Chat Submission
textChatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = promptInput.value.trim();
  if (!text) return;

  playHologramTone("transmit");
  promptInput.value = "";
  appendMessage("user", text);
  startAssistantStream();
  updateAgentState("thinking", "SYNTHESIZING DIRECTIVE…");

  const speak = speakReplyToggle.checked;
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, speak }),
    });
    const data = await res.json();
    if (!data.ok) {
      finishAssistantStream("EXECUTION FAILURE: " + (data.error || "Unknown Error"));
      updateAgentState("error", data.error);
    } else {
      finishAssistantStream(data.reply);
      updateAgentState("idle", "STANDBY");
      playHologramTone("chirp");
    }
  } catch (err) {
    finishAssistantStream("LINK DISRUPTED: " + err.message);
    updateAgentState("error", err.message);
  }
});

// Settings Save
settingsForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  playHologramTone("chirp");
  const payload = {
    stt_model_size: document.getElementById("stt_model_size").value,
    llm_model: document.getElementById("llm_model").value,
    wake_word: document.getElementById("wake_word").value || null,
    adaptive_vad: document.getElementById("adaptive_vad").checked,
    use_vad: document.getElementById("use_vad").checked,
    enable_tools: document.getElementById("enable_tools").checked,
    stream_tokens: document.getElementById("stream_tokens").checked,
    tts_rate: Number(document.getElementById("tts_rate").value),
    max_record_seconds: Number(document.getElementById("max_record_seconds").value),
    system_prompt: document.getElementById("system_prompt").value,
  };
  const dev = deviceSelect.value;
  payload.input_device = dev === "" ? null : Number(dev);

  try {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.ok) {
      showToast("STARK_OS // CONFIGURATION COMMITTED");
      loadState();
    } else {
      showToast("CONFIG ERROR: " + data.error);
    }
  } catch (err) {
    showToast("COMMIT FAILURE: " + err.message);
  }
});

// Add Note
addNoteBtn.addEventListener("click", async () => {
  const content = noteInput.value.trim();
  if (!content) return;
  noteInput.value = "";
  playHologramTone("chirp");
  try {
    await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `save a note: ${content}`, speak: false }),
    });
    showToast("MEMORANDUM LOGGED");
    loadState();
  } catch (err) {
    showToast("STORAGE FAILURE: " + err.message);
  }
});

// WebSocket Protocol
let wsRetryMs = 1000;
function connectWebSocket() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.addEventListener("open", () => {
    wsRetryMs = 1000;
  });

  ws.addEventListener("message", (e) => {
    try {
      const msg = JSON.parse(e.data);
      const type = msg.type;
      const text = msg.text;

      if (type === "audio_level") {
        const level = parseFloat(text) || 0;
        setEqualizerLevel(level);
        return;
      }

      if (type === "token") {
        appendStreamToken(text);
        return;
      }

      if (type === "tool_start") {
        showToolExecution(text);
        return;
      }

      if (type === "user") {
        appendMessage("user", text);
        startAssistantStream();
        return;
      }

      if (type === "assistant") {
        finishAssistantStream(text);
        return;
      }

      if (type === "stopped") {
        setRunningState(false);
        updateAgentState("idle", "AUDIO LINK DISENGAGED");
        return;
      }

      if (type === "history_cleared") {
        chatHistory.innerHTML = "";
        return;
      }

      updateAgentState(type, text);
    } catch (err) {
      console.error("HUD telemetry stream parse error:", err);
    }
  });

  ws.addEventListener("close", () => {
    setTimeout(connectWebSocket, wsRetryMs);
    wsRetryMs = Math.min(wsRetryMs * 2, 10000);
  });
}

// Initialize HUD
loadState();
connectWebSocket();
