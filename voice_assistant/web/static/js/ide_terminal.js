/**
 * ide_terminal.js — Integrated Bash Terminal using xterm.js and async PTY WebSocket
 * Antigravity theme, fit addon, shell resizing, and bidirectional streaming
 */

const TerminalModule = (() => {
  let _term = null;
  let _fitAddon = null;
  let _ws = null;
  let _connected = false;
  let _retryTimer = null;

  const $ = (id) => document.getElementById(id);

  function init() {
    const container = $('terminalContainer');
    if (!container || typeof Terminal === 'undefined') {
      console.warn('Terminal container or xterm.js not found');
      return;
    }

    _term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontSize: 13,
      lineHeight: 1.25,
      theme: {
        background: '#07080f',
        foreground: '#e2e8f0',
        cursor: '#22d3ee',
        cursorAccent: '#07080f',
        selectionBackground: 'rgba(168, 85, 247, 0.35)',
        black: '#07080f',
        red: '#f87171',
        green: '#4ade80',
        yellow: '#fbbf24',
        blue: '#818cf8',
        magenta: '#c084fc',
        cyan: '#22d3ee',
        white: '#e2e8f0',
        brightBlack: '#475569',
        brightRed: '#fca5a5',
        brightGreen: '#86efac',
        brightYellow: '#fde047',
        brightBlue: '#a5b4fc',
        brightMagenta: '#e879f9',
        brightCyan: '#67e8f9',
        brightWhite: '#ffffff',
      },
    });

    if (typeof FitAddon !== 'undefined') {
      _fitAddon = new FitAddon.FitAddon();
      _term.loadAddon(_fitAddon);
    }

    _term.open(container);
    if (_fitAddon) {
      setTimeout(() => _fitAddon.fit(), 100);
    }

    // Connect to Backend PTY WebSocket
    _connectWebSocket();

    // Bottom Panel Tabs Switching (AI Agent <-> Terminal)
    _initTabs();

    // Resize on window resize
    window.addEventListener('resize', () => {
      _fitAndNotify();
    });
  }

  function _initTabs() {
    const tabAiChat = $('tabAiChat');
    const tabTerminal = $('tabTerminal');
    const bottomChatView = $('bottomChatView');
    const bottomTerminalView = $('bottomTerminalView');

    if (tabAiChat && tabTerminal) {
      tabAiChat.addEventListener('click', () => {
        tabAiChat.classList.add('active');
        tabTerminal.classList.remove('active');
        if (bottomChatView) bottomChatView.hidden = false;
        if (bottomTerminalView) bottomTerminalView.hidden = true;
      });

      tabTerminal.addEventListener('click', () => {
        tabTerminal.classList.add('active');
        tabAiChat.classList.remove('active');
        if (bottomChatView) bottomChatView.hidden = true;
        if (bottomTerminalView) bottomTerminalView.hidden = false;
        setTimeout(() => {
          _fitAndNotify();
          if (_term) _term.focus();
        }, 50);
      });
    }
  }

  function _connectWebSocket() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = `${proto}://${location.host}/ws/terminal`;

    _ws = new WebSocket(wsUrl);

    _ws.onopen = () => {
      _connected = true;
      clearTimeout(_retryTimer);
      _fitAndNotify();
    };

    _ws.onmessage = (e) => {
      if (_term) {
        _term.write(e.data);
      }
    };

    _ws.onerror = (err) => {
      console.warn('Terminal WS error:', err);
    };

    _ws.onclose = () => {
      _connected = false;
      _retryTimer = setTimeout(() => {
        _connectWebSocket();
      }, 3000);
    };

    // Forward user keystrokes to PTY
    _term.onData((data) => {
      if (_connected && _ws.readyState === WebSocket.OPEN) {
        _ws.send(data);
      }
    });
  }

  function _fitAndNotify() {
    if (!_fitAddon || !_term) return;
    try {
      _fitAddon.fit();
      if (_connected && _ws && _ws.readyState === WebSocket.OPEN) {
        _ws.send(JSON.stringify({
          type: 'resize',
          cols: _term.cols,
          rows: _term.rows,
        }));
      }
    } catch (e) {
      // Container might be hidden
    }
  }

  function sendCommand(cmd, execute = true) {
    focus();
    const payload = execute ? `${cmd}\n` : cmd;
    if (_connected && _ws && _ws.readyState === WebSocket.OPEN) {
      _ws.send(payload);
    }
  }

  function focus() {
    const tabTerminal = $('tabTerminal');
    const bottomPanel = $('ideBottomPanel');
    if (bottomPanel) bottomPanel.classList.remove('collapsed');
    if (tabTerminal) tabTerminal.click();
    if (_term) _term.focus();
  }

  return {
    init,
    sendCommand,
    focus,
    refit: _fitAndNotify,
  };
})();

window.TerminalModule = TerminalModule;
