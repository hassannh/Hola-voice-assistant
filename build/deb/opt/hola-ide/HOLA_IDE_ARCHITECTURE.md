# 🌌 Hola IDE — Architecture & Developer Guide

**Hola IDE** is a modern, AI-powered desktop code editor designed with the **Google Antigravity** aesthetic (deep space dark `#07080f`, neon purple `#a855f7` and cyan `#22d3ee` accents, glassmorphic panels, and glowing status telemetry).

It integrates:
- **Monaco Editor Engine** (the same editor engine powering VS Code).
- **Integrated Bash Terminal** (`xterm.js` connected to an asynchronous Linux PTY).
- **Context-Aware AI Agent** with real-time token streaming and Autonomous Coding Action Cards.
- **Dual LLM Engines**: Local offline privacy via **Ollama** + Cloud providers (**Groq, OpenAI, Anthropic, Gemini, OpenRouter, DeepSeek**).
- **Source Control**: Git status badges, diff inspection, commit history, and staging.
- **Workspace Code Search**: Blazing fast `ripgrep` search with line jumping.
- **Command Palette (`Ctrl+Shift+P` / `F1`)** and customizable keybindings.
- **Linux Desktop Packaging**: Native `.deb` package and `.desktop` application menu integration.

---

## 🏛️ High-Level Architecture

```mermaid
graph TD
    subgraph Desktop Shell
        A[ide.py Launcher] --> B[FastAPI Backend :8765]
        A --> C[Desktop Window: PyWebView / Chromium App]
    end

    subgraph Frontend Client (Antigravity UI)
        C --> D[Monaco Editor Engine]
        C --> E[XTerm.js Bash Terminal]
        C --> F[Activity Bar & Side Panel]
        C --> G[AI Agent Chat Dock]
        C --> H[Command Palette]
    end

    subgraph Backend Services
        B --> I[IDE REST API]
        B --> J[Terminal PTY WebSocket]
        B --> K[Telemetry WebSocket]
        B --> L[LLM & Agent Engine]
        B --> M[Autonomous Tools]
    end

    subgraph External
        L --> N[Local Ollama Daemon]
        L --> O[Cloud LLMs API]
        J --> P[Linux Bash /bin/bash]
        M --> Q[Local Filesystem & Git]
    end
```

---

## 📁 Repository Structure

```
personal-assistant/
├── ide.py                         # Desktop launcher (FastAPI server + PyWebView/Chromium window)
├── run.sh                         # Linux quick-launch shell script
├── run.bat                        # Windows launch script
├── install_desktop.sh             # Linux Application Menu (.desktop + SVG icon) installer
├── package_deb.sh                 # Debian (.deb) package builder
├── hola-ide.desktop               # Linux XDG desktop entry
├── HOLA_IDE_ARCHITECTURE.md       # Architecture & developer documentation (this file)
├── dist/                          # Built packages (hola-ide_1.0.0_all.deb)
├── requirements.txt               # Python dependencies
│
└── voice_assistant/
    ├── config.py                  # Pydantic IDE settings & environment management
    ├── db.py                      # SQLite persistent store (notes, prompt history)
    ├── llm.py                     # Provider adapters (Ollama, Groq, OpenAI, Gemini, etc.)
    ├── tools.py                   # Autonomous agent tools (file write, patch, run terminal)
    ├── runtime.py                 # Runtime manager & event bus
    │
    └── web/
        ├── app.py                 # FastAPI server (IDE APIs, PTY WebSockets, file tree, git)
        └── static/
            ├── index.html         # Main IDE shell layout (VS Code + Antigravity style)
            ├── styles.css         # Antigravity design system tokens & component styles
            ├── hola_icon.svg      # High-resolution vector neon app icon
            │
            └── js/
                ├── api.js         # REST API client
                ├── ws.js          # Telemetry & token streaming WebSocket client
                ├── ide_editor.js  # Monaco Editor, tabs, syntax highlighter & saving
                ├── ide_explorer.js# File tree navigation & directory expanding
                ├── ide_git.js     # Git branch telemetry, status, log, diffs & commits
                ├── ide_search.js  # Ripgrep search with case matching & line jumps
                ├── ide_chat.js    # AI Agent chat dock with context & action cards
                ├── ide_terminal.js# xterm.js terminal emulator connected to bash PTY
                ├── ide_palette.js # Command Palette modal (Ctrl+Shift+P / F1)
                ├── ide_keybindings.js # Shortcuts cheat-sheet & Monaco code snippets
                └── ide_main.js    # Master coordinator, layout resizing & settings sync
```

---

## 💻 Frontend Subsystems

### 1. Monaco Editor Buffer (`ide_editor.js`)
- Loaded via CDN (`monaco-editor@0.45.0`).
- Configured with custom theme `antigravity-dark` (`#0b0d18` editor background, `#a855f7` line numbers, `#22d3ee` cursor).
- Maintains a multi-tab document buffer. Each tab tracks:
  - `path`, `name`, `language`, `content`, `originalContent`, `isModified`, `viewState`.
- Automatic dirty indicator (`●`) on modified tabs.
- `Ctrl+S` auto-saves back to the disk via `POST /api/ide/file`.
- Dispatches global `editor-file-changed` event to notify AI chat of active context.

### 2. Integrated Terminal (`ide_terminal.js` + `xterm.js`)
- Renders an interactive terminal in the bottom panel tab `[💻 Terminal]`.
- Connects to `/ws/terminal` using WebSockets.
- Uses `FitAddon` to automatically calculate terminal dimensions (`cols` and `rows`) and synchronize with the Linux pseudo-terminal window size (`TIOCSWINSZ`).

### 3. AI Agent Chat Dock (`ide_chat.js`)
- Lives in the bottom collapsible split panel.
- **Context Injection**: Automatically grabs the active file's path, language, and code snippet, embedding it into user prompts so the agent always knows what you're working on.
- **Token Streaming**: Real-time token by token response stream using WebSockets.
- **Autonomous Action Cards**: When the AI outputs a bash command or code block, interactive action buttons appear:
  - `▶ Run in Terminal`: Dispatches the command directly to the integrated bash terminal.
  - `✨ Apply to Editor`: Opens or updates the file buffer in Monaco with 1 click.
  - `📋 Copy`: Copies snippet to system clipboard.

### 4. Command Palette (`ide_palette.js`)
- Triggered with `Ctrl+Shift+P` or `F1`.
- Fuzzy-searches all IDE commands (File operations, Git, Terminal, AI Agent, Theme).
- Keyboard navigation with `Up`/`Down` arrows, `Enter` to execute, `Esc` to dismiss.

---

## ⚡ Backend Endpoints & WebSockets

### REST API

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/state` | Returns IDE state, current provider, active model, devices |
| `GET` | `/api/ide/tree?root=` | Returns recursive JSON file tree |
| `GET` | `/api/ide/file?path=` | Reads file text with language detection |
| `POST` | `/api/ide/file` | Writes content to file |
| `GET` | `/api/ide/search?q=&root=` | Performs ripgrep search (with grep fallback) |
| `GET` | `/api/ide/git/status?root=` | Returns git branch and file change statuses |
| `GET` | `/api/ide/git/diff?path=&root=` | Returns git diff output |
| `GET` | `/api/ide/git/log?root=&n=` | Returns git commit history |
| `POST` | `/api/ide/git/commit` | Stages all and commits with message |
| `POST` | `/api/chat` | AI conversation endpoint (returns reply text & tokens) |
| `POST` | `/api/settings` | Updates LLM provider, models, and voice settings |

### WebSockets

| Endpoint | Protocol | Purpose |
|---|---|---|
| `/ws` | JSON messages | Telemetry, state pills, tool execution alerts, token streaming |
| `/ws/terminal` | Raw PTY text / JSON resize | Bidirectional interactive bash pseudo-terminal |

---

## ⌨️ Keyboard Shortcuts Reference

| Shortcut | Action |
|---|---|
| `Ctrl + S` | Save active file |
| `Ctrl + P` | Search workspace files |
| `Ctrl + Shift + P` or `F1` | Open Command Palette |
| `Ctrl + \`` | Toggle AI Agent / Terminal split panel |
| `Ctrl + Shift + E` | Focus File Explorer |
| `Ctrl + Shift + G` | Focus Git Source Control |
| `Ctrl + Enter` | Quick Git Commit (in commit message input) |
| `Enter` | Send prompt to AI Agent |
| `Shift + Enter` | Insert newline in AI Agent prompt |
| `Ctrl + K, Ctrl + S` | View all keyboard shortcuts |
| `Esc` | Close open modal (Palette, Shortcuts) |

---

## 🚀 Desktop Launch & Packaging

### Running Locally

```bash
# Standalone Chromium desktop app window (Recommended)
python3 ide.py --app

# Native PyWebView GTK window
python3 ide.py

# In default web browser
python3 ide.py --browser
```

### Installing into System Applications Menu

To have Hola IDE appear in your GNOME / Ubuntu application launcher with its custom neon icon:

```bash
./install_desktop.sh
```

### Building a `.deb` Installer

To create an installable Debian package for Ubuntu/Debian:

```bash
./package_deb.sh
```
This generates `dist/hola-ide_1.0.0_all.deb`, which can be installed with:
```bash
sudo dpkg -i dist/hola-ide_1.0.0_all.deb
```
