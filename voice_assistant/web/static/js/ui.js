/**
 * ui.js — DOM manipulation, component rendering, sidebar, state display
 * Exposes: UIModule (global)
 * Depends on: pagination.js (Paginator)
 */
const UIModule = (() => {
  // ── DOM refs ───────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);

  // ── Toast ──────────────────────────────────────────────────────
  let _toastTimer = null;
  function showToast(msg, duration = 3500) {
    const t = $("toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => { t.hidden = true; }, duration);
  }

  // ── Sidebar collapse / expand ──────────────────────────────────
  let _sidebarOpen = true;

  function _initSidebar() {
    const sidebar       = $("sidebar");
    const toggleBtn     = $("sidebarToggleBtn");
    const expandBtn     = $("sidebarExpandBtn");
    const collapsedStrip= $("sidebarCollapsedStrip");
    const mainContent   = $("mainContent");

    function collapse() {
      _sidebarOpen = false;
      sidebar.classList.add("collapsed");
      collapsedStrip.classList.add("visible");
      mainContent.classList.add("sidebar-hidden");
      toggleBtn.setAttribute("aria-expanded", "false");
      // Flip chevron
      toggleBtn.querySelector(".chevron-icon").style.transform = "rotate(180deg)";
    }

    function expand() {
      _sidebarOpen = true;
      sidebar.classList.remove("collapsed");
      collapsedStrip.classList.remove("visible");
      mainContent.classList.remove("sidebar-hidden");
      toggleBtn.setAttribute("aria-expanded", "true");
      toggleBtn.querySelector(".chevron-icon").style.transform = "";
    }

    toggleBtn.addEventListener("click", () => _sidebarOpen ? collapse() : expand());
    expandBtn.addEventListener("click", expand);
  }

  // ── Sidebar tab switching ──────────────────────────────────────
  function _initTabs() {
    document.querySelectorAll(".sidebar-tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".sidebar-tab-btn").forEach((b) => {
          b.classList.remove("active");
          b.setAttribute("aria-selected", "false");
        });
        document.querySelectorAll(".sidebar-panel").forEach((p) => p.classList.remove("active"));
        btn.classList.add("active");
        btn.setAttribute("aria-selected", "true");
        const panelId = btn.getAttribute("aria-controls");
        const panel = document.getElementById(panelId);
        if (panel) panel.classList.add("active");
      });
    });
  }

  // ── Agent state pill ───────────────────────────────────────────
  function updateAgentState(state, text, isRunning) {
    const pill = $("agentStatePill");
    const label = $("agentStateText");
    pill.className = `telemetry-pill state-pill ${state}`;
    label.textContent = text || state.toUpperCase();

    if (!AudioModule.isTesting()) {
      const msg = $("orbStatusMessage");
      const map = {
        listening:    "Listening to voice input…",
        transcribing: "Transcribing speech stream…",
        thinking:     "Hola is reasoning with local LLM…",
        speaking:     "Vocalizing response…",
        idle:         isRunning ? "Voice loop active · Listening for 'Hola'" : "Ready · Press 'Start Assistant' or type below",
        error:        text || "An error occurred",
      };
      if (msg && map[state]) msg.textContent = map[state];
      if (state === "transcribing" || state === "thinking") AudioModule.updateMeter(0);
      if (state === "speaking") AudioModule.drawSynthetic(0.8);
      if (state === "idle") { AudioModule.updateMeter(0); AudioModule.drawSynthetic(0); }
    }
  }

  // ── Ollama pill ────────────────────────────────────────────────
  function updateOllamaPill(ollama) {
    if (!ollama) return;
    const pill      = $("ollamaPill");
    const txt       = $("ollamaStatusText");
    const pullBtn   = $("pullModelBtn");

    if (ollama.reachable) {
      if (ollama.has_configured_model) {
        pill.className = "telemetry-pill ready";
        txt.textContent = "Ollama: Ready";
        if (pullBtn) pullBtn.hidden = true;
      } else {
        pill.className = "telemetry-pill warning";
        txt.textContent = "Ollama: Model Missing";
        if (pullBtn) pullBtn.hidden = false;
      }
    } else {
      pill.className = "telemetry-pill error";
      txt.textContent = "Ollama: Offline";
      if (pullBtn) pullBtn.hidden = true;
    }
  }

  // ── Ollama download progress ───────────────────────────────────
  let _pullStartTime  = null;
  let _pullLastBytes  = 0;
  let _pullLastTime   = null;

  function startPullBanner(modelName) {
    _pullStartTime = Date.now();
    _pullLastBytes = 0;
    _pullLastTime  = Date.now();
    const banner = $("ollamaDownloadBanner");
    $("dlModelName").textContent  = modelName;
    $("dlProgressFill").style.width = "0%";
    $("dlStatusText").textContent   = "Connecting to Ollama…";
    $("dlPercent").textContent       = "0%";
    $("dlSpeed").textContent         = "";
    if (banner) banner.hidden = false;
  }

  function updateOllamaPull(event) {
    const banner = $("ollamaDownloadBanner");
    if (banner && banner.hidden) banner.hidden = false;

    const { status, total, completed, percent, done, error } = event;

    // Speed calculation
    const now = Date.now();
    const dtSec = (now - (_pullLastTime || now)) / 1000;
    const dBytes = (completed || 0) - (_pullLastBytes || 0);
    _pullLastBytes = completed || 0;
    _pullLastTime  = now;
    const bps = dtSec > 0 ? dBytes / dtSec : 0;
    const speed = bps > 0 ? _formatSpeed(bps) : "";

    if ($("dlProgressFill")) $("dlProgressFill").style.width  = `${Math.min(percent || 0, 100)}%`;
    if ($("dlPercent"))      $("dlPercent").textContent       = `${(percent || 0).toFixed(1)}%`;
    if ($("dlStatusText"))   $("dlStatusText").textContent    = error ? `Error: ${error}` : (status || "…");
    if ($("dlSpeed"))        $("dlSpeed").textContent         = speed;

    if (error) {
      showToast(`Model download failed: ${error}`, 6000);
      if ($("dlProgressFill")) $("dlProgressFill").style.background = "var(--accent-rose)";
    }

    if (done) {
      if ($("dlProgressFill")) $("dlProgressFill").style.width = "100%";
      if ($("dlPercent"))      $("dlPercent").textContent = "100%";
      if ($("dlStatusText"))   $("dlStatusText").textContent = "✓ Download complete!";
      if ($("dlSpeed"))        $("dlSpeed").textContent = "";
      showToast("Model downloaded successfully! ✓", 4000);
      setTimeout(() => { const b = $("ollamaDownloadBanner"); if (b) b.hidden = true; }, 4000);
    }
  }

  function _formatSpeed(bps) {
    if (bps >= 1e9)  return `${(bps/1e9).toFixed(1)} GB/s`;
    if (bps >= 1e6)  return `${(bps/1e6).toFixed(1)} MB/s`;
    if (bps >= 1e3)  return `${(bps/1e3).toFixed(0)} KB/s`;
    return `${Math.round(bps)} B/s`;
  }

  // ── Running state ──────────────────────────────────────────────
  function setRunningState(running) {
    const btn = $("toggleVoiceBtn");
    const txt = $("toggleVoiceText");
    btn.classList.toggle("running", running);
    txt.textContent = running ? "Stop Assistant" : "Start Assistant";
  }

  // ── Chat messages ──────────────────────────────────────────────
  // All messages stored in-memory for pagination
  const _allMessages = [];
  let _chatPaginator = null;
  let _streamBubble  = null;
  let _streamContent = "";

  function _renderChatItem(msg) {
    const time = new Date(msg.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return `
      <div class="chat-msg ${msg.role}">
        <div class="chat-bubble">${_escapeHtml(msg.text)}</div>
        <div class="msg-meta">${msg.role === "user" ? "You" : "Hola"} · ${time}</div>
      </div>`;
  }

  function _escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }

  function _initChatPaginator() {
    _chatPaginator = new Paginator({
      containerEl:  "#chatHistory",
      paginationEl: "#chatPagination",
      renderItem:   _renderChatItem,
      pageSize:     10,
    });
  }

  function appendMessage(role, text) {
    // Remove empty state on first message
    const empty = $("chatHistory")?.querySelector(".empty-state");
    if (empty) {
      _allMessages.length = 0; // fresh
    }

    const msg = { role, text, ts: Date.now() };
    _allMessages.push(msg);

    if (_chatPaginator) {
      _chatPaginator.setItems([..._allMessages]);
      // Jump to last page
      _chatPaginator.goTo(_chatPaginator.totalPages);
    }
  }

  // ── Streaming bubble ───────────────────────────────────────────
  function startAssistantStream() {
    // Remove empty state
    const empty = $("chatHistory")?.querySelector(".empty-state");
    if (empty) empty.remove();

    // Create streaming bubble directly in DOM (not paginated yet)
    const feed = $("chatHistory");
    const wrap = document.createElement("div");
    wrap.className = "chat-msg assistant streaming";
    wrap.id = "streamingBubble";

    const bubble = document.createElement("div");
    bubble.className = "chat-bubble";
    bubble.innerHTML = '<span class="cursor">▊</span>';

    const meta = document.createElement("div");
    meta.className = "msg-meta";
    meta.textContent = `Hola · ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;

    wrap.appendChild(bubble);
    wrap.appendChild(meta);
    feed.appendChild(wrap);
    feed.scrollTop = feed.scrollHeight;

    _streamBubble  = bubble;
    _streamContent = "";
  }

  function appendStreamToken(token) {
    if (!_streamBubble) startAssistantStream();
    _streamContent += token;
    _streamBubble.textContent = _streamContent;
    const feed = $("chatHistory");
    if (feed) feed.scrollTop = feed.scrollHeight;
  }

  function finishAssistantStream(finalText) {
    if (_streamBubble) {
      _streamBubble.textContent = finalText || _streamContent;
      _streamBubble = null;
    }
    // Now commit to paginator
    if (finalText || _streamContent) {
      _allMessages.push({ role: "assistant", text: finalText || _streamContent, ts: Date.now() });
      _streamContent = "";
    }
    // Remove temporary streaming node and re-render via paginator
    const streamNode = document.getElementById("streamingBubble");
    if (streamNode) streamNode.remove();
    if (_chatPaginator) {
      _chatPaginator.setItems([..._allMessages]);
      _chatPaginator.goTo(_chatPaginator.totalPages);
    }
  }

  function showToolExecution(toolName) {
    const feed = $("chatHistory");
    const badge = document.createElement("div");
    badge.className = "tool-badge";
    badge.innerHTML = `⚡ <span>Tool: ${_escapeHtml(toolName)}</span>`;
    feed.appendChild(badge);
    feed.scrollTop = feed.scrollHeight;
  }

  function clearChat() {
    _allMessages.length = 0;
    _streamBubble  = null;
    _streamContent = "";
    const feed = $("chatHistory");
    if (feed) {
      feed.innerHTML = `
        <div class="empty-state">
          <div class="empty-glyph">⌘</div>
          <h3>Hola AI is ready</h3>
          <p>Say "Hola" followed by your command, speak into your microphone, or enter a prompt below.</p>
        </div>`;
    }
    if (_chatPaginator) _chatPaginator.setItems([]);
  }

  // ── Tools list (paginated) ─────────────────────────────────────
  let _toolsPaginator = null;

  function _initToolsPaginator() {
    _toolsPaginator = new Paginator({
      containerEl:  "#toolsList",
      paginationEl: "#toolsPagination",
      pageSize:     6,
      renderItem: (t) => `
        <div class="tool-card">
          <div class="tool-name">⚡ ${_escapeHtml(t.name)}</div>
          <div class="tool-description">${_escapeHtml(t.description)}</div>
        </div>`,
    });
  }

  function renderTools(tools) {
    if (_toolsPaginator) _toolsPaginator.setItems(tools || []);
  }

  // ── Notes list (paginated) ─────────────────────────────────────
  let _notesPaginator = null;

  function _initNotesPaginator() {
    _notesPaginator = new Paginator({
      containerEl:  "#notesList",
      paginationEl: "#notesPagination",
      pageSize:      5,
      renderItem: (n) => {
        const date = new Date(n.created_at * 1000).toLocaleString();
        return `
          <div class="note-card">
            <div>${_escapeHtml(n.content)}</div>
            <div class="note-stamp">${date}</div>
          </div>`;
      },
    });
  }

  function renderNotes(notes) {
    if (_notesPaginator) _notesPaginator.setItems(notes || []);
  }

  // ── Settings form population ───────────────────────────────────
  function fillSettings(settings, devices) {
    const deviceSel = $("input_device");
    deviceSel.innerHTML = "";
    const auto = document.createElement("option");
    auto.value = "";
    auto.textContent = "System Default Audio Source";
    deviceSel.appendChild(auto);

    (devices || []).forEach((dev) => {
      const opt = document.createElement("option");
      opt.value = String(dev.id);
      opt.textContent = `${dev.id}: ${dev.name} (${dev.channels}ch)`;
      deviceSel.appendChild(opt);
    });
    if (settings.input_device != null) deviceSel.value = String(settings.input_device);

    $("stt_model_size").value    = settings.stt_model_size    || "tiny";
    $("llm_model").value         = settings.llm_model         || "llama3.2:3b";
    $("wake_word").value         = settings.wake_word         || "hola";
    $("adaptive_vad").checked    = Boolean(settings.adaptive_vad);
    $("use_vad").checked         = Boolean(settings.use_vad);
    $("enable_tools").checked    = Boolean(settings.enable_tools);
    $("stream_tokens").checked   = Boolean(settings.stream_tokens);
    $("tts_rate").value          = settings.tts_rate          || 175;
    $("max_record_seconds").value= settings.max_record_seconds|| 12;
    $("system_prompt").value     = settings.system_prompt     || "";

    const modelBadge = $("activeModelName");
    if (modelBadge) modelBadge.textContent = settings.llm_model || "llama3.2:3b";
  }

  // ── Init ───────────────────────────────────────────────────────
  function init() {
    _initSidebar();
    _initTabs();
    _initChatPaginator();
    _initToolsPaginator();
    _initNotesPaginator();
  }

  return {
    init,
    showToast,
    updateAgentState,
    updateOllamaPill,
    startPullBanner,
    updateOllamaPull,
    setRunningState,
    appendMessage,
    startAssistantStream,
    appendStreamToken,
    finishAssistantStream,
    showToolExecution,
    clearChat,
    renderTools,
    renderNotes,
    fillSettings,
  };
})();
