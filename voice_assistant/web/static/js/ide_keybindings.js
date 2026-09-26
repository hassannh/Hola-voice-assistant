/**
 * ide_keybindings.js — Keyboard Shortcuts modal & Monaco Code Snippets for Hola IDE
 */

const KeybindingsModule = (() => {
  const $ = (id) => document.getElementById(id);

  const _shortcuts = [
    { desc: 'Save current file', keys: ['Ctrl', 'S'] },
    { desc: 'Open Command Palette', keys: ['Ctrl', 'Shift', 'P'] },
    { desc: 'Quick Command Palette', keys: ['F1'] },
    { desc: 'Search workspace files', keys: ['Ctrl', 'P'] },
    { desc: 'Toggle AI Agent / Terminal panel', keys: ['Ctrl', '`'] },
    { desc: 'Focus File Explorer', keys: ['Ctrl', 'Shift', 'E'] },
    { desc: 'Focus Source Control (Git)', keys: ['Ctrl', 'Shift', 'G'] },
    { desc: 'Quick Commit (inside git message)', keys: ['Ctrl', 'Enter'] },
    { desc: 'Send AI Chat prompt', keys: ['Enter'] },
    { desc: 'Insert newline in chat prompt', keys: ['Shift', 'Enter'] },
    { desc: 'Open keyboard shortcuts', keys: ['Ctrl', 'K', 'Ctrl', 'S'] },
    { desc: 'Close any open modal or dialog', keys: ['Esc'] },
  ];

  function init() {
    const modal = $('keybindingsModal');
    const closeBtn = $('closeKeybindingsBtn');

    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) close();
      });
    }

    if (closeBtn) {
      closeBtn.addEventListener('click', close);
    }

    _renderList();

    // Key chord listener: Ctrl+K followed by Ctrl+S
    let lastKeyK = false;
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        lastKeyK = true;
        setTimeout(() => { lastKeyK = false; }, 1200);
      } else if (lastKeyK && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        lastKeyK = false;
        open();
      } else if (e.key === 'Escape') {
        close();
      }
    });

    _registerMonacoSnippets();
  }

  function _renderList() {
    const list = $('keybindingsList');
    if (!list) return;

    list.innerHTML = '';
    _shortcuts.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'keybinding-row';

      const desc = document.createElement('span');
      desc.className = 'keybinding-desc';
      desc.textContent = item.desc;

      const keysWrap = document.createElement('div');
      keysWrap.className = 'keybinding-keys';

      item.keys.forEach((k) => {
        const kbd = document.createElement('kbd');
        kbd.textContent = k;
        keysWrap.appendChild(kbd);
      });

      row.appendChild(desc);
      row.appendChild(keysWrap);
      list.appendChild(row);
    });
  }

  function _registerMonacoSnippets() {
    // If monaco languages API is loaded, register helper snippets
    if (typeof monaco === 'undefined' || !monaco.languages) return;

    try {
      // Python snippets
      monaco.languages.registerCompletionItemProvider('python', {
        provideCompletionItems: () => {
          const suggestions = [
            {
              label: 'def',
              kind: monaco.languages.CompletionItemKind.Snippet,
              insertText: 'def ${1:function_name}(${2:params}) -> ${3:None}:\n\t"""${4:Docstring}"""\n\t${0:pass}',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: 'Define a Python function with docstring',
            },
            {
              label: 'fastapi',
              kind: monaco.languages.CompletionItemKind.Snippet,
              insertText: '@app.get("/${1:route}")\nasync def ${2:endpoint}() -> dict:\n\treturn {"ok": True, "data": ${0:None}}',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: 'FastAPI async route handler',
            },
            {
              label: 'main',
              kind: monaco.languages.CompletionItemKind.Snippet,
              insertText: 'if __name__ == "__main__":\n\t${0:main()}',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: 'Python main block',
            },
          ];
          return { suggestions };
        },
      });

      // JavaScript snippets
      monaco.languages.registerCompletionItemProvider('javascript', {
        provideCompletionItems: () => {
          const suggestions = [
            {
              label: 'afn',
              kind: monaco.languages.CompletionItemKind.Snippet,
              insertText: 'async function ${1:name}(${2:params}) {\n\t${0}\n}',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: 'Async function declaration',
            },
            {
              label: 'fetch',
              kind: monaco.languages.CompletionItemKind.Snippet,
              insertText: 'const res = await fetch("${1:url}");\nconst data = await res.json();\n${0}',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: 'Async fetch request',
            },
          ];
          return { suggestions };
        },
      });
    } catch (e) {
      console.warn('Snippet registration skipped:', e);
    }
  }

  function open() {
    const modal = $('keybindingsModal');
    if (modal) modal.hidden = false;
  }

  function close() {
    const modal = $('keybindingsModal');
    if (modal) modal.hidden = true;
  }

  return {
    init,
    open,
    close,
  };
})();

window.KeybindingsModule = KeybindingsModule;
