// DOM Elements
const toggleVoiceBtn = document.getElementById("toggleVoiceBtn");
const toggleVoiceText = document.getElementById("toggleVoiceText");
const testMicBtn = document.getElementById("testMicBtn");
const testMicText = document.getElementById("testMicText");
const clearHistoryBtn = document.getElementById("clearHistoryBtn");
const chatHistory = document.getElementById("chatHistory");
const textChatForm = document.getElementById("textChatForm");
const promptInput = document.getElementById("promptInput");
const speakReplyToggle = document.getElementById("speakReplyToggle");

const volDbLabel = document.getElementById("volDbLabel");
const meterFill = document.getElementById("meterFill");
const meterPeak = document.getElementById("meterPeak");
const waveformCanvas = document.getElementById("waveformCanvas");
const orbStatusMessage = document.getElementById("orbStatusMessage");

const ollamaPill = document.getElementById("ollamaPill");
const ollamaStatusText = document.getElementById("ollamaStatusText");
const activeModelName = document.getElementById("activeModelName");
const agentStatePill = document.getElementById("agentStatePill");
const agentStateText = document.getElementById("agentStateText");

const settingsForm = document.getElementById("settingsForm");
const deviceSelect = document.getElementById("input_device");
const toolsList = document.getElementById("toolsList");
const notesList = document.getElementById("notesList");
const noteInput = document.getElementById("noteInput");
const addNoteBtn = document.getElementById("addNoteBtn");
const toast = document.getElementById("toast");

// State Variables
let isRunning = false;
let isMicTesting = false;
let browserMediaStream = null;
let audioContext = null;
let analyserNode = null;
let micAnimFrame = null;
let peakLevel = 0;
let currentAssistantBubble = null;
let currentAssistantContent = null;

const canvasCtx = waveformCanvas.getContext("2d");

// Toast Notification
function showToast(msg, duration = 3000) {
  toast.textContent = msg;
  toast.hidden = false;
  setTimeout(() => {
    toast.hidden = true;
  }, duration);
}

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

// Update Volume Meter & Canvas (Both for Backend and Frontend Mic Test)
function updateMeterUI(normalizedLevel) {
  // Clamp between 0.0 and 1.0
  const norm = Math.max(0, Math.min(1, normalizedLevel));
  const percent = (norm * 100).toFixed(1);

  meterFill.style.width = `${percent}%`;

  if (norm > peakLevel) {
    peakLevel = norm;
  } else {
    peakLevel = Math.max(0, peakLevel - 0.02);
  }
  meterPeak.style.left = `${(peakLevel * 100).toFixed(1)}%`;

  if (norm <= 0.005) {
    volDbLabel.textContent = "-∞ dB";
  } else {
    const db = (20 * Math.log10(norm * 1.5 + 0.001)).toFixed(1);
    volDbLabel.textContent = `${db} dB`;
  }
}

// Draw Canvas Waveform (Idle/Backend Animated Mode)
function drawSyntheticWaveform(activity = 0) {
  if (isMicTesting) return; // Browser mic test handles canvas directly

  const width = waveformCanvas.width;
  const height = waveformCanvas.height;
  canvasCtx.clearRect(0, 0, width, height);

  canvasCtx.lineWidth = 2;
  canvasCtx.strokeStyle = activity > 0.02 ? "#06b6d4" : "rgba(255, 255, 255, 0.15)";
  canvasCtx.beginPath();

  const sliceWidth = width / 64;
  let x = 0;

  for (let i = 0; i < 64; i++) {
    const freq = activity > 0 ? Math.sin(i * 0.35 + Date.now() * 0.01) * activity * (height / 2.2) : 0;
    const y = height / 2 + freq;

    if (i === 0) {
      canvasCtx.moveTo(x, y);
    } else {
      canvasCtx.lineTo(x, y);
    }
    x += sliceWidth;
  }

  canvasCtx.stroke();
}

// ----------------------------------------------------
// Real Hardware Microphone Test (Web Audio API)
// ----------------------------------------------------
async function toggleBrowserMicTest() {
  if (isMicTesting) {
    stopBrowserMicTest();
  } else {
    await startBrowserMicTest();
  }
}

async function startBrowserMicTest() {
  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    browserMediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    const source = audioContext.createMediaStreamSource(browserMediaStream);
    analyserNode = audioContext.createAnalyser();
    analyserNode.fftSize = 512;
    analyserNode.smoothingTimeConstant = 0.5;
    source.connect(analyserNode);

    isMicTesting = true;
    testMicBtn.classList.add("active");
    testMicText.textContent = "Stop Mic Test";
    orbStatusMessage.textContent = "Live Microphone Monitoring · Speak to verify audio levels";
    showToast("Live mic test active — speaking will reflect immediately");

    renderMicTestFrame();
  } catch (err) {
    console.error("Mic test error:", err);
    showToast("Microphone permission denied or device error: " + err.message);
    stopBrowserMicTest();
  }
}

function stopBrowserMicTest() {
  isMicTesting = false;
  testMicBtn.classList.remove("active");
  testMicText.textContent = "Test Microphone";
  orbStatusMessage.textContent = isRunning ? "Voice loop active · Listening for speech" : "Ready · Press 'Start Assistant' or type below";

  if (micAnimFrame) cancelAnimationFrame(micAnimFrame);
  if (browserMediaStream) {
    browserMediaStream.getTracks().forEach((track) => track.stop());
    browserMediaStream = null;
  }
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
  updateMeterUI(0);
  drawSyntheticWaveform(0);
}

function renderMicTestFrame() {
  if (!isMicTesting || !analyserNode) return;

  const dataArray = new Uint8Array(analyserNode.frequencyBinCount);
  analyserNode.getByteTimeDomainData(dataArray);

  // Calculate RMS
  let sum = 0;
  for (let i = 0; i < dataArray.length; i++) {
    const val = (dataArray[i] - 128) / 128;
    sum += val * val;
  }
  const rms = Math.sqrt(sum / dataArray.length);
  const normalizedLevel = Math.min(1.0, rms * 4.5);

  updateMeterUI(normalizedLevel);

  // Render Real Waveform on Canvas
  const width = waveformCanvas.width;
  const height = waveformCanvas.height;
  canvasCtx.clearRect(0, 0, width, height);

  canvasCtx.lineWidth = 2.5;
  canvasCtx.strokeStyle = normalizedLevel > 0.05 ? "#10b981" : "#06b6d4";
  canvasCtx.beginPath();

  const sliceWidth = width / dataArray.length;
  let x = 0;

  for (let i = 0; i < dataArray.length; i++) {
    const v = dataArray[i] / 128.0;
    const y = (v * height) / 2;

    if (i === 0) {
      canvasCtx.moveTo(x, y);
    } else {
      canvasCtx.lineTo(x, y);
    }
    x += sliceWidth;
  }

  canvasCtx.lineTo(width, height / 2);
  canvasCtx.stroke();

  micAnimFrame = requestAnimationFrame(renderMicTestFrame);
}

testMicBtn.addEventListener("click", toggleBrowserMicTest);

// ----------------------------------------------------
// UI State Updates
// ----------------------------------------------------
function updateAgentState(state, text) {
  agentStatePill.className = `telemetry-pill state-pill ${state}`;
  agentStateText.textContent = text || state.toUpperCase();

  if (!isMicTesting) {
    if (state === "listening") {
      orbStatusMessage.textContent = "Listening to voice input…";
    } else if (state === "transcribing") {
      orbStatusMessage.textContent = "Transcribing speech stream…";
      updateMeterUI(0);
    } else if (state === "thinking") {
      orbStatusMessage.textContent = "Hola is reasoning with local LLM…";
      updateMeterUI(0);
    } else if (state === "speaking") {
      orbStatusMessage.textContent = "Vocalizing response…";
      drawSyntheticWaveform(0.8);
    } else if (state === "idle") {
      orbStatusMessage.textContent = isRunning ? "Voice loop active · Listening for 'Hola'" : "Ready · Press 'Start Assistant' or type below";
      updateMeterUI(0);
      drawSyntheticWaveform(0);
    } else if (state === "error") {
      orbStatusMessage.textContent = text || "An error occurred";
      updateMeterUI(0);
    }
  }
}

// Chat Message Rendering
function appendMessage(role, text) {
  const empty = chatHistory.querySelector(".empty-state");
  if (empty) empty.remove();

  const wrap = document.createElement("div");
  wrap.className = `chat-msg ${role}`;

  const bubble = document.createElement("div");
  bubble.className = "chat-bubble";
  bubble.textContent = text || "";

  const meta = document.createElement("div");
  meta.className = "msg-meta";
  const now = new Date();
  meta.textContent = `${role === "user" ? "You" : "Hola"} · ${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;

  wrap.appendChild(bubble);
  wrap.appendChild(meta);
  chatHistory.appendChild(wrap);
  chatHistory.scrollTop = chatHistory.scrollHeight;

  return { wrap, bubble };
}

// Streaming Typewriter
function startAssistantStream() {
  const empty = chatHistory.querySelector(".empty-state");
  if (empty) empty.remove();

  const wrap = document.createElement("div");
  wrap.className = "chat-msg assistant";

  const bubble = document.createElement("div");
  bubble.className = "chat-bubble";
  bubble.innerHTML = '<span class="cursor">▊</span>';

  const meta = document.createElement("div");
  meta.className = "msg-meta";
  const now = new Date();
  meta.textContent = `Hola · ${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;

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
}

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
    toolsList.innerHTML = '<p class="hint-text">No active tools.</p>';
    return;
  }
  tools.forEach((t) => {
    const card = document.createElement("div");
    card.className = "tool-card";
    card.innerHTML = `
      <div class="tool-name">⚡ ${t.name}</div>
      <div class="tool-description">${t.description}</div>
    `;
    toolsList.appendChild(card);
  });
}

// Render Notes in Scratchpad
function renderNotes(notes) {
  notesList.innerHTML = "";
  if (!notes || notes.length === 0) {
    notesList.innerHTML = '<p class="hint-text">Scratchpad is empty.</p>';
    return;
  }
  notes.forEach((n) => {
    const item = document.createElement("div");
    item.className = "note-card";
    const date = new Date(n.created_at * 1000).toLocaleString();
    item.innerHTML = `<div>${n.content}</div><div class="note-stamp">${date}</div>`;
    notesList.appendChild(item);
  });
}

// Settings Form Population
function fillSettings(settings, devices) {
  deviceSelect.innerHTML = "";
  const auto = document.createElement("option");
  auto.value = "";
  auto.textContent = "System Default Audio Source";
  deviceSelect.appendChild(auto);

  (devices || []).forEach((dev) => {
    const opt = document.createElement("option");
    opt.value = String(dev.id);
    opt.textContent = `${dev.id}: ${dev.name} (${dev.channels}ch)`;
    deviceSelect.appendChild(opt);
  });

  if (settings.input_device != null) {
    deviceSelect.value = String(settings.input_device);
  }

  document.getElementById("stt_model_size").value = settings.stt_model_size || "tiny";
  document.getElementById("llm_model").value = settings.llm_model || "llama3.2:3b";
  document.getElementById("wake_word").value = settings.wake_word || "hola";
  document.getElementById("adaptive_vad").checked = Boolean(settings.adaptive_vad);
  document.getElementById("use_vad").checked = Boolean(settings.use_vad);
  document.getElementById("enable_tools").checked = Boolean(settings.enable_tools);
  document.getElementById("stream_tokens").checked = Boolean(settings.stream_tokens);
  document.getElementById("tts_rate").value = settings.tts_rate || 175;
  document.getElementById("max_record_seconds").value = settings.max_record_seconds || 12;
  document.getElementById("system_prompt").value = settings.system_prompt || "";

  if (activeModelName) {
    activeModelName.textContent = settings.llm_model || "llama3.2:3b";
  }
}

// Ollama Status Pill
function updateOllamaPill(ollama) {
  if (!ollama) return;
  if (ollama.reachable) {
    if (ollama.has_configured_model) {
      ollamaPill.className = "telemetry-pill ready";
      ollamaStatusText.textContent = "Ollama: Ready";
    } else {
      ollamaPill.className = "telemetry-pill warning";
      ollamaStatusText.textContent = "Ollama: Downloading";
    }
  } else {
    ollamaPill.className = "telemetry-pill error";
    ollamaStatusText.textContent = "Ollama: Offline";
  }
}

// State Loading
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
    showToast("Failed loading state: " + err.message);
  }
}

function setRunningState(running) {
  isRunning = running;
  if (running) {
    toggleVoiceBtn.classList.add("running");
    toggleVoiceText.textContent = "Stop Assistant";
  } else {
    toggleVoiceBtn.classList.remove("running");
    toggleVoiceText.textContent = "Start Assistant";
  }
}

// Assistant Toggle Button
toggleVoiceBtn.addEventListener("click", async () => {
  if (!isRunning) {
    updateAgentState("listening", "Starting microphone…");
    const res = await fetch("/api/start", { method: "POST" });
    const data = await res.json();
    if (data.ok) {
      setRunningState(true);
      showToast("Hola voice loop started");
    } else {
      showToast("Failed to start: " + (data.error || "Unknown"));
      updateAgentState("error", data.error);
    }
  } else {
    const res = await fetch("/api/stop", { method: "POST" });
    const data = await res.json();
    if (data.ok) {
      setRunningState(false);
      updateAgentState("idle", "Assistant stopped");
      showToast("Hola voice loop stopped");
    }
  }
});

// Clear History
clearHistoryBtn.addEventListener("click", async () => {
  if (confirm("Clear conversation history?")) {
    await fetch("/api/clear", { method: "POST" });
    chatHistory.innerHTML = `
      <div class="empty-state">
        <div class="empty-glyph">⌘</div>
        <h3>Hola AI is ready</h3>
        <p>Say "Hola" followed by your command, speak into your microphone, or enter a prompt below.</p>
      </div>
    `;
    showToast("History cleared");
  }
});

// Quick Prompts
document.querySelectorAll(".prompt-chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    promptInput.value = chip.dataset.query;
    textChatForm.dispatchEvent(new Event("submit"));
  });
});

// Text Chat Submit
textChatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = promptInput.value.trim();
  if (!text) return;

  promptInput.value = "";
  appendMessage("user", text);
  startAssistantStream();
  updateAgentState("thinking", "Thinking…");

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

// Settings Save
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
      showToast("Configuration saved successfully!");
      loadState();
    } else {
      showToast("Error saving: " + data.error);
    }
  } catch (err) {
    showToast("Commit failure: " + err.message);
  }
});

// Add Note
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
    showToast("Storage error: " + err.message);
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
        if (!isMicTesting) {
          updateMeterUI(level);
          drawSyntheticWaveform(level);
        }
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
        updateAgentState("idle", "Assistant stopped");
        return;
      }

      if (type === "history_cleared") {
        chatHistory.innerHTML = "";
        return;
      }

      updateAgentState(type, text);
    } catch (err) {
      console.error("WebSocket message parse error:", err);
    }
  });

  ws.addEventListener("close", () => {
    setTimeout(connectWebSocket, wsRetryMs);
    wsRetryMs = Math.min(wsRetryMs * 2, 10000);
  });
}

// Initial draw & setup
drawSyntheticWaveform(0);
loadState();
connectWebSocket();
