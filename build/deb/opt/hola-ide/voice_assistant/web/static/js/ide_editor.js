/**
 * ide_editor.js — Monaco Editor integration & tab management for Hola IDE
 * Antigravity theme, multi-tab buffer, save, and cursor telemetry
 */

const EditorModule = (() => {
  let _editor = null;
  let _isMonacoReady = false;
  let _pendingFile = null;

  // Tabs state: Array of { path, name, language, content, originalContent, isModified, viewState }
  const _tabs = [];
  let _activePath = null;

  const $ = (id) => document.getElementById(id);

  function _detectLanguageFromPath(path) {
    const ext = (path.split('.').pop() || '').toLowerCase();
    const map = {
      js: 'javascript', mjs: 'javascript', cjs: 'javascript',
      ts: 'typescript', tsx: 'typescript', jsx: 'javascript',
      py: 'python', pyw: 'python',
      html: 'html', htm: 'html',
      css: 'css', scss: 'scss', less: 'less',
      json: 'json',
      md: 'markdown', markdown: 'markdown',
      sh: 'shell', bash: 'shell', zsh: 'shell',
      yaml: 'yaml', yml: 'yaml',
      sql: 'sql',
      rs: 'rust',
      go: 'go',
      c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp',
      java: 'java',
      php: 'php',
      xml: 'xml', svg: 'xml',
      toml: 'ini', ini: 'ini',
    };
    return map[ext] || 'plaintext';
  }

  function init() {
    function _loadMonaco() {
      if (typeof require === 'undefined' || typeof require !== 'function') {
        setTimeout(_loadMonaco, 100);
        return;
      }

      require(['vs/editor/editor.main'], function () {
      // Define Antigravity Deep Space theme
      monaco.editor.defineTheme('antigravity-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [
          { token: 'comment', foreground: '64748b', fontStyle: 'italic' },
          { token: 'keyword', foreground: 'c084fc', fontStyle: 'bold' }, // neon purple
          { token: 'identifier', foreground: 'e2e8f0' },
          { token: 'string', foreground: '4ade80' },  // green
          { token: 'number', foreground: '22d3ee' },  // cyan
          { token: 'delimiter', foreground: '94a3b8' },
          { token: 'type', foreground: '38bdf8' },
          { token: 'function', foreground: 'f472b6' },
        ],
        colors: {
          'editor.background': '#0b0d18',
          'editor.foreground': '#e2e8f0',
          'editorLineNumber.foreground': '#334155',
          'editorLineNumber.activeForeground': '#a855f7',
          'editorCursor.foreground': '#22d3ee',
          'editor.selectionBackground': '#a855f730',
          'editor.inactiveSelectionBackground': '#a855f718',
          'editor.lineHighlightBackground': '#14172860',
          'editorIndentGuide.background': '#ffffff08',
          'editorIndentGuide.activeBackground': '#a855f740',
          'editorGutter.background': '#07080f',
          'editorWidget.background': '#0f1120',
          'editorWidget.border': '#a855f740',
        },
      });

      const container = $('monacoContainer');
      _editor = monaco.editor.create(container, {
        value: '',
        language: 'plaintext',
        theme: 'antigravity-dark',
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        fontSize: 13,
        lineHeight: 20,
        automaticLayout: true,
        minimap: { enabled: true, renderCharacters: false },
        scrollBeyondLastLine: false,
        smoothScrolling: true,
        cursorBlinking: 'smooth',
        cursorSmoothCaretAnimation: 'on',
        renderWhitespace: 'selection',
        tabSize: 4,
        insertSpaces: true,
      });

      // Cursor movement tracking
      _editor.onDidChangeCursorPosition((e) => {
        const statusCursor = $('statusCursor');
        if (statusCursor) {
          statusCursor.textContent = `Ln ${e.position.lineNumber}, Col ${e.position.column}`;
        }
      });

      // Content change tracking for modified indicator
      _editor.onDidChangeModelContent(() => {
        const tab = _tabs.find((t) => t.path === _activePath);
        if (tab) {
          const currentVal = _editor.getValue();
          tab.content = currentVal;
          const wasModified = tab.isModified;
          tab.isModified = currentVal !== tab.originalContent;
          if (wasModified !== tab.isModified) {
            _renderTabs();
          }
        }
      });

      // Ctrl+S / Cmd+S save command inside Monaco
      _editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        saveCurrentFile();
      });

      _isMonacoReady = true;

      if (_pendingFile) {
        const { path, language, content } = _pendingFile;
        _pendingFile = null;
        openFile(path, language, content);
      }
    });
  }

  _loadMonaco();

    // Global Ctrl+S shortcut fallback
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveCurrentFile();
      }
    });

    // Welcome screen buttons
    const welcomeNewBtn = $('welcomeNewBtn');
    if (welcomeNewBtn) {
      welcomeNewBtn.addEventListener('click', () => {
        createNewFile();
      });
    }
  }

  function _renderTabs() {
    const tabsContainer = $('openTabs');
    if (!tabsContainer) return;
    tabsContainer.innerHTML = '';

    _tabs.forEach((tab) => {
      const el = document.createElement('div');
      el.className = `editor-tab ${tab.path === _activePath ? 'active' : ''} ${tab.isModified ? 'modified' : ''}`;
      el.dataset.path = tab.path;
      el.title = tab.path;

      const nameSpan = document.createElement('span');
      nameSpan.className = 'tab-name';
      nameSpan.textContent = tab.name;

      const closeSpan = document.createElement('span');
      closeSpan.className = 'tab-close';
      closeSpan.innerHTML = '&times;';
      closeSpan.title = 'Close (Ctrl+W)';
      closeSpan.addEventListener('click', (e) => {
        e.stopPropagation();
        closeTab(tab.path);
      });

      el.appendChild(nameSpan);
      el.appendChild(closeSpan);

      el.addEventListener('click', () => {
        switchTab(tab.path);
      });

      tabsContainer.appendChild(el);
    });

    _updateUiForActiveTab();
  }

  function _updateUiForActiveTab() {
    const welcome = $('welcomeScreen');
    const container = $('monacoContainer');
    const titlebarFile = $('titlebarFile');
    const breadcrumbPath = $('breadcrumbPath');
    const statusLang = $('statusLang');

    const activeTab = _tabs.find((t) => t.path === _activePath);

    if (!activeTab) {
      if (welcome) welcome.hidden = false;
      if (container) container.hidden = true;
      if (titlebarFile) titlebarFile.textContent = 'No file open';
      if (breadcrumbPath) breadcrumbPath.textContent = 'Welcome';
      if (statusLang) statusLang.textContent = '–';
      window.dispatchEvent(new CustomEvent('editor-file-changed', { detail: null }));
      return;
    }

    if (welcome) welcome.hidden = true;
    if (container) container.hidden = false;
    if (titlebarFile) titlebarFile.textContent = `${activeTab.name}${activeTab.isModified ? ' ●' : ''}`;
    if (breadcrumbPath) breadcrumbPath.textContent = activeTab.path;
    if (statusLang) statusLang.textContent = activeTab.language;

    window.dispatchEvent(new CustomEvent('editor-file-changed', {
      detail: {
        path: activeTab.path,
        name: activeTab.name,
        language: activeTab.language,
        content: activeTab.content,
      }
    }));
  }

  function openFile(path, language, content) {
    if (!_isMonacoReady) {
      _pendingFile = { path, language, content };
      return;
    }

    const name = path.split('/').pop() || path;
    const lang = language || _detectLanguageFromPath(path);

    let tab = _tabs.find((t) => t.path === path);
    if (!tab) {
      tab = {
        path,
        name,
        language: lang,
        content: content !== undefined ? content : '',
        originalContent: content !== undefined ? content : '',
        isModified: false,
        viewState: null,
      };
      _tabs.push(tab);
    } else if (content !== undefined) {
      tab.content = content;
      tab.originalContent = content;
      tab.isModified = false;
    }

    switchTab(path);
  }

  function switchTab(path) {
    const currentTab = _tabs.find((t) => t.path === _activePath);
    if (currentTab && _editor) {
      currentTab.viewState = _editor.saveViewState();
    }

    _activePath = path;
    const tab = _tabs.find((t) => t.path === path);
    if (!tab) {
      _renderTabs();
      return;
    }

    if (_editor) {
      const oldModel = _editor.getModel();
      const newModel = monaco.editor.createModel(tab.content, tab.language);
      _editor.setModel(newModel);
      if (oldModel) oldModel.dispose();

      if (tab.viewState) {
        _editor.restoreViewState(tab.viewState);
      }
      _editor.focus();
    }

    _renderTabs();
  }

  function closeTab(path) {
    const idx = _tabs.findIndex((t) => t.path === path);
    if (idx === -1) return;

    const tab = _tabs[idx];
    if (tab.isModified) {
      if (!confirm(`"${tab.name}" has unsaved changes. Close anyway?`)) {
        return;
      }
    }

    _tabs.splice(idx, 1);

    if (_activePath === path) {
      if (_tabs.length > 0) {
        const nextTab = _tabs[Math.max(0, idx - 1)];
        switchTab(nextTab.path);
      } else {
        _activePath = null;
        if (_editor) {
          const oldModel = _editor.getModel();
          if (oldModel) oldModel.dispose();
        }
        _renderTabs();
      }
    } else {
      _renderTabs();
    }
  }

  function createNewFile() {
    const filename = prompt('Enter new file name:', 'untitled.py');
    if (!filename) return;
    openFile(filename, null, '# New file\n');
  }

  async function saveCurrentFile() {
    const tab = _tabs.find((t) => t.path === _activePath);
    if (!tab) return;

    try {
      const content = _editor ? _editor.getValue() : tab.content;
      const res = await API.saveFile(tab.path, content);
      if (res && res.ok) {
        tab.originalContent = content;
        tab.content = content;
        tab.isModified = false;
        _renderTabs();
        if (window.UIModule?.showToast) {
          UIModule.showToast(`Saved ${tab.name}`);
        }
      } else {
        throw new Error(res.error || 'Failed to save');
      }
    } catch (err) {
      console.error('Save error:', err);
      if (window.UIModule?.showToast) {
        UIModule.showToast(`Save failed: ${err.message}`);
      }
    }
  }

  function revealLine(lineNumber) {
    if (_editor && lineNumber) {
      _editor.revealLineInCenter(lineNumber);
      _editor.setPosition({ lineNumber, column: 1 });
      _editor.focus();
    }
  }

  return {
    init,
    openFile,
    switchTab,
    closeTab,
    saveCurrentFile,
    createNewFile,
    revealLine,
    getCurrentPath: () => _activePath,
    getCurrentContent: () => (_editor ? _editor.getValue() : (_tabs.find((t) => t.path === _activePath)?.content || '')),
    getCurrentLanguage: () => _tabs.find((t) => t.path === _activePath)?.language || 'plaintext',
    getTabs: () => _tabs,
  };
})();

// Auto-initialize when Monaco loader is available
window.EditorModule = EditorModule;
