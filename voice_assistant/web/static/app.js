// DOM Elements
const voiceOrb = document.getElementById("voiceOrb");
const orbStatusMessage = document.getElementById("orbStatusMessage");
const audioLevelFill = document.getElementById("audioLevelFill");
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

const settingsForm = document.getElementById("settingsForm");
const deviceSelect = document.getElementById("input_device");
const toolsList = document.getElementById("toolsList");
const notesList = document.getElementById("notesList");
const noteInput = document.getElementById("noteInput");
const addNoteBtn = document.getElementById("addNoteBtn");
const toast = document.getElementById("toast");

let isRunning = false;
let currentAssistantBubble = null;
let currentAssistantContent = null;
let activeToolBadge = null;

// Tab Switching
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
    btn.classList.add("active");
    const target = document.getElementById(`tab${btn.dataset.tab.charAt(0).toUpperCase() + btn.dataset.tab.slice(1)}`);
    if (target) target.classList.add("active");
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

// Update Agent State & Visualizer Orb
function updateAgentState(state, text) {
  agentStatePill.className = `state-pill ${state}`;
  agentStateText.textContent = text || state.toUpperCase();

  voiceOrb.className = `voice-orb ${state}`;
  if (state === "listening") {
    orbStatusMessage.textContent = "Listening to your voice…";
  } else if (state === "transcribing") {
    orbStatusMessage.textContent = "Transcribing speech…";
  } else if (state === "thinking") {
    orbStatusMessage.textContent = "Reasoning with local LLM…";
  } else if (state === "speaking") {
    orbStatusMessage.textContent = "Speaking response aloud…";
  } else if (state === "idle") {
    orbStatusMessage.textContent = isRunning ? "Voice loop active · Waiting for speech" : "Idle · Ready for input";
    audioLevelFill.style.width = "0%";
  } else if (state === "error") {
    orbStatusMessage.textContent = text || "An error occurred";
  }
}

// Add Message to Chat History
function appendMessage(role, text) {
  // Remove welcome card on first message
  const welcome = chatHistory.querySelector(".welcome-card");
  if (welcome) welcome.remove();

  const wrap = document.createElement("div");
  wrap.className = `chat-msg ${role}`;

  const bubble = document.createElement("div");
  bubble.className = "chat-bubble";
  bubble.textContent = text || "";

  const meta = document.createElement("div");
  meta.className = "msg-meta";
  const now = new Date();
  meta.textContent = `${role === "user" ? "You" : "Assistant"} · ${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;

  wrap.appendChild(bubble);
  wrap.appendChild(meta);
  chatHistory.appendChild(wrap);
  chatHistory.scrollTop = chatHistory.scrollHeight;

  return { wrap, bubble };
}

// Start Streaming Assistant Bubble
function startAssistantStream() {
  const welcome = chatHistory.querySelector(".welcome-card");
  if (welcome) welcome.remove();

  const wrap = document.createElement("div");
  wrap.className = "chat-msg assistant";

  const bubble = document.createElement("div");
  bubble.className = "chat-bubble";
  bubble.innerHTML = '<span class="cursor">▊</span>';

  const meta = document.createElement("div");
  meta.className = "msg-meta";
  const now = new Date();
  meta.textContent = `Assistant · ${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;

  wrap.appendChild(bubble);
  wrap.appendChild(meta);
  chatHistory.appendChild(wrap);
  chatHistory.scrollTop = chatHistory.scrollHeight;

  currentAssistantBubble = bubble;
  currentAssistantContent = "";
  activeToolBadge = null;
}

// Append Token to Streaming Bubble
function appendStreamToken(token) {
  if (!currentAssistantBubble) {
    startAssistantStream();
  }
  currentAssistantContent += token;
  currentAssistantBubble.textContent = currentAssistantContent;
  chatHistory.scrollTop = chatHistory.scrollHeight;
}

// Finish Assistant Stream
function finishAssistantStream(finalText) {
  if (currentAssistantBubble) {
    currentAssistantBubble.textContent = finalText || currentAssistantContent;
    currentAssistantBubble = null;
    currentAssistantContent = null;
    activeToolBadge = null;
  }
}

// Display Tool Execution Card
function showToolExecution(toolName) {
  if (!currentAssistantBubble) {
    startAssistantStream();
  }
  const badge = document.createElement("div");
  badge.className = "tool-badge";
  badge.innerHTML = `⚡ <span>Tool: ${toolName}</span>`;
  currentAssistantBubble.parentNode.insertBefore(badge, currentAssistantBubble);
}

// Render Tools in Capabilities Tab
function renderTools(tools) {
  toolsList.innerHTML = "";
  if (!tools || tools.length === 0) {
    toolsList.innerHTML = '<p class="field-hint">No tools registered or tools disabled.</p>';
    return;
  }
  tools.forEach((t) => {
    const card = document.createElement("div");
    card.className = "tool-card";
    card.innerHTML = `
      <div class="tool-title">⚡ ${t.name}</div>
      <div class="tool-desc">${t.description}</div>
    `;
    toolsList.appendChild(card);
  });
}

// Render Notes in Scratchpad Tab
function renderNotes(notes) {
  notesList.innerHTML = "";
  if (!notes || notes.length === 0) {
    notesList.innerHTML = '<p class="field-hint">No notes stored yet.</p>';
    return;
  }
  notes.forEach((n) => {
    const item = document.createElement("div");
    item.className = "note-item";
    const date = new Date(n.created_at * 1000).toLocaleString();
    item.innerHTML = `<div>${n.content}</div><div class="note-time">${date}</div>`;
    notesList.appendChild(item);
  });
}

// Populate Settings Form
function fillSettings(settings, devices) {
  deviceSelect.innerHTML = "";
  const auto = document.createElement("option");
  auto.value = "";
  auto.textContent = "System Default Input";
  deviceSelect.appendChild(auto);

  (devices || []).forEach((dev) => {
    const opt = document.createElement("option");
    opt.value = String(dev.id);
    opt.textContent = `${dev.id}: ${dev.name}`;
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
}

// Update Ollama Status Pill
function updateOllamaPill(ollama) {
  if (!ollama) return;
  if (ollama.reachable) {
    if (ollama.has_configured_model) {
      ollamaPill.className = "status-pill ready";
      ollamaStatusText.textContent = `Ollama: Ready`;
    } else {
      ollamaPill.className = "status-pill warning";
      ollamaStatusText.textContent = `Ollama: Model missing`;
    }
  } else {
    ollamaPill.className = "status-pill error";
    ollamaStatusText.textContent = "Ollama: Offline";
  }
}

// Fetch Full Application State
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
    showToast("Error loading assistant state: " + err.message);
  }
}

function setRunningState(running) {
  isRunning = running;
  if (running) {
    toggleVoiceBtn.classList.add("running");
    toggleVoiceText.textContent = "Stop Voice Loop";
  } else {
    toggleVoiceBtn.classList.remove("running");
    toggleVoiceText.textContent = "Start Listening";
  }
}

// Voice Toggle Handler
toggleVoiceBtn.addEventListener("click", async () => {
  if (!isRunning) {
    updateAgentState("listening", "Starting microphone…");
    const res = await fetch("/api/start", { method: "POST" });
    const data = await res.json();
    if (data.ok) {
      setRunningState(true);
      showToast("Voice assistant listening");
    } else {
      showToast("Failed to start: " + (data.error || "Unknown"));
      updateAgentState("error", data.error);
    }
  } else {
    const res = await fetch("/api/stop", { method: "POST" });
    const data = await res.json();
    if (data.ok) {
      setRunningState(false);
      updateAgentState("idle", "Voice loop stopped");
      showToast("Voice assistant stopped");
    }
  }
});

// Clear History Handler
clearHistoryBtn.addEventListener("click", async () => {
  if (confirm("Clear all conversation history?")) {
    await fetch("/api/clear", { method: "POST" });
    chatHistory.innerHTML = `
      <div class="welcome-card">
        <div class="welcome-icon">✨</div>
        <h3>Ready to assist you locally</h3>
        <p>Speak naturally via microphone or type in the prompt bar below.</p>
      </div>
    `;
    showToast("Conversation cleared");
  }
});

// Quick Prompt Chips Click Handler
document.querySelectorAll(".chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    promptInput.value = chip.dataset.query;
    textChatForm.dispatchEvent(new Event("submit"));
  });
});

// Text Chat Submission Handler
textChatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = promptInput.value.trim();
  if (!text) return;

  promptInput.value = "";
  appendMessage("user", text);
  startAssistantStream();
  updateAgentState("thinking", "Reasoning…");

  const speak = speakReplyToggle.checked;
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, speak }),
    });
    const data = await res.json();
    if (!data.ok) {
      finishAssistantStream("Error: " + (data.error || "Execution failed"));
      updateAgentState("error", data.error);
    } else {
      finishAssistantStream(data.reply);
      updateAgentState("idle", "Ready");
    }
  } catch (err) {
    finishAssistantStream("Network error: " + err.message);
    updateAgentState("error", err.message);
  }
});

// Settings Form Submission Handler
settingsForm.addEventListener("submit", async (e) => {
  e.preventDefault();
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
      showToast("Settings successfully saved!");
      loadState();
    } else {
      showToast("Error saving: " + data.error);
    }
  } catch (err) {
    showToast("Failed to save settings: " + err.message);
  }
});

// Add Note Handler
addNoteBtn.addEventListener("click", async () => {
  const content = noteInput.value.trim();
  if (!content) return;
  noteInput.value = "";
  try {
    await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `save a note: ${content}`, speak: false }),
    });
    showToast("Note added to scratchpad");
    loadState();
  } catch (err) {
    showToast("Error saving note: " + err.message);
  }
});

// Real-Time WebSocket Connection
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
        audioLevelFill.style.width = `${Math.min(100, level * 100)}%`;
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
        updateAgentState("idle", "Voice loop stopped");
        return;
      }

      if (type === "history_cleared") {
        chatHistory.innerHTML = "";
        return;
      }

      updateAgentState(type, text);
    } catch (err) {
      console.error("WS error parsing message:", err);
    }
  });

  ws.addEventListener("close", () => {
    setTimeout(connectWebSocket, wsRetryMs);
    wsRetryMs = Math.min(wsRetryMs * 2, 10000);
  });
}

// Initialize Application
loadState();
connectWebSocket();
