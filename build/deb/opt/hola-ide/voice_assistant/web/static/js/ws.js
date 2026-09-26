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

      // Dispatch global custom event for any module to listen
      window.dispatchEvent(new CustomEvent("assistant-event", { detail: msg }));

      switch (type) {
        case "ollama_pull":
          if (window.UIModule?.updateOllamaPull) UIModule.updateOllamaPull(msg);
          break;

        case "audio_level":
          if (typeof AudioModule !== "undefined" && AudioModule?.updateMeter) {
            const lv = parseFloat(text) || 0;
            AudioModule.updateMeter(lv);
          }
          break;

        case "token":
          if (window.ChatModule?.appendStreamToken) ChatModule.appendStreamToken(text);
          else if (window.UIModule?.appendStreamToken) UIModule.appendStreamToken(text);
          break;

        case "tool_start":
          if (window.ChatModule?.showToolExecution) ChatModule.showToolExecution(text);
          else if (window.UIModule?.showToolExecution) UIModule.showToolExecution(text);
          break;

        case "user":
          if (window.ChatModule?.appendMessage) {
            ChatModule.appendMessage("user", text);
            ChatModule.startAssistantStream?.();
          } else if (window.UIModule?.appendMessage) {
            UIModule.appendMessage("user", text);
            UIModule.startAssistantStream?.();
          }
          break;

        case "assistant":
          if (window.ChatModule?.finishAssistantStream) ChatModule.finishAssistantStream(text);
          else if (window.UIModule?.finishAssistantStream) UIModule.finishAssistantStream(text);
          if (window.UIModule?.updateAgentState) UIModule.updateAgentState("idle", "Ready", _isRunning);
          break;

        case "stopped":
          _isRunning = false;
          if (window.UIModule?.setRunningState) UIModule.setRunningState(false);
          if (window.UIModule?.updateAgentState) UIModule.updateAgentState("idle", "Assistant stopped", false);
          break;

        case "history_cleared":
          if (window.ChatModule?.clearChat) ChatModule.clearChat();
          else if (window.UIModule?.clearChat) UIModule.clearChat();
          break;

        default:
          if (window.UIModule?.updateAgentState) UIModule.updateAgentState(type, text, _isRunning);
      }
    });

    _ws.addEventListener("close", () => {
      setTimeout(connect, _retryMs);
      _retryMs = Math.min(_retryMs * 2, 10000);
    });
  }

  return { connect, setRunning };
})();
