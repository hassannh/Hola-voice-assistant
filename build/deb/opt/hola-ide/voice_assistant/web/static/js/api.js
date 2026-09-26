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
    getProviders: ()         => _fetch("/api/llm/providers"),
    testConnection: (payload) => _fetch("/api/llm/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
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
    // IDE endpoints
    getTree: (root) => _fetch(`/api/ide/tree?root=${encodeURIComponent(root || ".")}`),
    getFile: (path) => _fetch(`/api/ide/file?path=${encodeURIComponent(path)}`),
    saveFile: (path, content) => _fetch("/api/ide/file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, content }),
    }),
    search: (q, root, caseSensitive) => _fetch(
      `/api/ide/search?q=${encodeURIComponent(q)}&root=${encodeURIComponent(root || ".")}&case_sensitive=${Boolean(caseSensitive)}`
    ),
    gitStatus: (root) => _fetch(`/api/ide/git/status?root=${encodeURIComponent(root || ".")}`),
    gitDiff: (path, root) => _fetch(`/api/ide/git/diff?path=${encodeURIComponent(path || ".")}&root=${encodeURIComponent(root || ".")}`),
    gitLog: (root, n = 20) => _fetch(`/api/ide/git/log?root=${encodeURIComponent(root || ".")}&n=${n}`),
    gitCommit: (message, root, stageAll = true) => _fetch("/api/ide/git/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, root: root || ".", stage_all: stageAll }),
    }),
  };
})();
