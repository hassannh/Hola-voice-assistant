/**
 * api.js — All fetch/REST calls to the FastAPI backend
 * Exposes: API (global)
 */
const API = (() => {
  async function _fetch(url, opts = {}) {
    const res = await fetch(url, opts);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return res.json();
  }

  return {
    loadState:    ()         => _fetch("/api/state"),
    start:        ()         => _fetch("/api/start",       { method: "POST" }),
    stop:         ()         => _fetch("/api/stop",        { method: "POST" }),
    clear:        ()         => _fetch("/api/clear",       { method: "POST" }),
    pullModel:    ()         => _fetch("/api/ollama/pull", { method: "POST" }),
    saveSettings: (payload)  => _fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
    chat: (text, speak) => _fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, speak }),
    }),
  };
})();
