/**
 * ws.js — WebSocket connection with exponential back-off
 * Exposes: WSModule (global)
 * Depends on: UIModule, AudioModule
 */
const WSModule = (() => {
  let _ws        = null;
  let _retryMs   = 1000;
  let _isRunning = false;

  function setRunning(v) { _isRunning = v; }

  function connect() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    _ws = new WebSocket(`${proto}://${location.host}/ws`);

    _ws.addEventListener("open", () => {
      _retryMs = 1000;
    });

    _ws.addEventListener("message", (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }

      const { type, text } = msg;

      switch (type) {
        case "ollama_pull":
          UIModule.updateOllamaPull(msg);
          break;

        case "audio_level":
          if (!AudioModule.isTesting()) {
            const lv = parseFloat(text) || 0;
            AudioModule.updateMeter(lv);
            AudioModule.drawSynthetic(lv);
          }
          break;

        case "token":
          UIModule.appendStreamToken(text);
          break;

        case "tool_start":
          UIModule.showToolExecution(text);
          break;

        case "user":
          UIModule.appendMessage("user", text);
          UIModule.startAssistantStream();
          break;

        case "assistant":
          UIModule.finishAssistantStream(text);
          UIModule.updateAgentState("idle", "Ready", _isRunning);
          break;

        case "stopped":
          _isRunning = false;
          UIModule.setRunningState(false);
          UIModule.updateAgentState("idle", "Assistant stopped", false);
          break;

        case "history_cleared":
          UIModule.clearChat();
          break;

        default:
          UIModule.updateAgentState(type, text, _isRunning);
      }
    });

    _ws.addEventListener("close", () => {
      setTimeout(connect, _retryMs);
      _retryMs = Math.min(_retryMs * 2, 10000);
    });
  }

  return { connect, setRunning };
})();
