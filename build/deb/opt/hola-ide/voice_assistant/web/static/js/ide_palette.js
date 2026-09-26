/**
 * ide_palette.js — Command Palette (Ctrl+Shift+P / F1) for Hola IDE
 * Fuzzy search, quick action dispatch, keyboard navigation, and custom actions
 */

const PaletteModule = (() => {
  const $ = (id) => document.getElementById(id);

  let _commands = [];
  let _filteredCommands = [];
  let _selectedIndex = 0;
  let _isOpen = false;

  function init() {
    _registerDefaultCommands();

    const modal = $('commandPaletteModal');
    const input = $('paletteInput');

    if (!modal || !input) return;

    // Close on backdrop click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) close();
    });

    // Input typing filter
    input.addEventListener('input', () => {
      _filterCommands(input.value);
    });

    // Arrow keys & Enter
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        _selectedIndex = Math.min(_selectedIndex + 1, _filteredCommands.length - 1);
        _renderList();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        _selectedIndex = Math.max(_selectedIndex - 1, 0);
        _renderList();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        _executeSelected();
      }
    });

    // Global keyboard triggers
    window.addEventListener('keydown', (e) => {
      // Ctrl+Shift+P or Cmd+Shift+P or F1
      if (((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'p') || e.key === 'F1') {
        e.preventDefault();
        toggle();
      }
    });
  }

  function _registerDefaultCommands() {
    _commands = [
      {
        id: 'file.new',
        title: 'File: New File',
        icon: '📄',
        shortcut: 'Ctrl+N',
        action: () => window.EditorModule?.createNewFile(),
      },
      {
        id: 'file.save',
        title: 'File: Save Current File',
        icon: '💾',
        shortcut: 'Ctrl+S',
        action: () => window.EditorModule?.saveCurrentFile(),
      },
      {
        id: 'file.openFolder',
        title: 'File: Open Workspace Folder',
        icon: '📂',
        shortcut: 'Ctrl+O',
        action: () => window.ExplorerModule?.promptOpenFolder(),
      },
      {
        id: 'view.search',
        title: 'Search: Find in Files',
        icon: '🔍',
        shortcut: 'Ctrl+P',
        action: () => {
          document.querySelector('.activity-btn[data-panel="search"]')?.click();
          setTimeout(() => $('searchQueryInput')?.focus(), 100);
        },
      },
      {
        id: 'view.git',
        title: 'Source Control: Git Status & Staging',
        icon: '🌿',
        shortcut: 'Ctrl+Shift+G',
        action: () => document.querySelector('.activity-btn[data-panel="git"]')?.click(),
      },
      {
        id: 'git.commit',
        title: 'Git: Quick Stage All and Commit',
        icon: '💾',
        shortcut: 'Ctrl+Enter',
        action: () => window.GitModule?.commit(),
      },
      {
        id: 'view.terminal',
        title: 'Terminal: Open Integrated Bash Shell',
        icon: '💻',
        shortcut: 'Ctrl+`',
        action: () => window.TerminalModule?.focus(),
      },
      {
        id: 'view.chat',
        title: 'AI Agent: Focus Chat & Code Assistant',
        icon: '💬',
        shortcut: 'Ctrl+`',
        action: () => {
          const tab = $('tabAiChat');
          if (tab) tab.click();
          $('ideBottomPanel')?.classList.remove('collapsed');
          setTimeout(() => $('promptInput')?.focus(), 80);
        },
      },
      {
        id: 'voice.toggle',
        title: 'Voice: Start / Stop Voice Assistant',
        icon: '🎙️',
        shortcut: 'Voice Btn',
        action: () => $('toggleVoiceBtn')?.click(),
      },
      {
        id: 'view.settings',
        title: 'Preferences: Open Configuration',
        icon: '⚙️',
        shortcut: 'Settings',
        action: () => document.querySelector('.activity-btn[data-panel="settings"]')?.click(),
      },
      {
        id: 'help.shortcuts',
        title: 'Help: View All Keyboard Shortcuts',
        icon: '⌨',
        shortcut: 'Ctrl+K Ctrl+S',
        action: () => window.KeybindingsModule?.open(),
      },
      {
        id: 'chat.clear',
        title: 'AI Agent: Clear Chat History',
        icon: '🗑️',
        shortcut: '',
        action: () => window.ChatModule?.clearChat(),
      },
    ];
  }

  function registerCommand(cmd) {
    _commands.push(cmd);
  }

  function open() {
    const modal = $('commandPaletteModal');
    const input = $('paletteInput');
    if (!modal || !input) return;

    _isOpen = true;
    modal.hidden = false;
    input.value = '';
    _filterCommands('');
    setTimeout(() => input.focus(), 50);
  }

  function close() {
    const modal = $('commandPaletteModal');
    if (!modal) return;
    _isOpen = false;
    modal.hidden = true;
  }

  function toggle() {
    if (_isOpen) close();
    else open();
  }

  function _filterCommands(query) {
    const q = (query || '').toLowerCase().trim();
    if (!q) {
      _filteredCommands = [..._commands];
    } else {
      _filteredCommands = _commands.filter((cmd) => {
        return cmd.title.toLowerCase().includes(q) || (cmd.shortcut && cmd.shortcut.toLowerCase().includes(q));
      });
    }
    _selectedIndex = 0;
    _renderList();
  }

  function _renderList() {
    const list = $('paletteResults');
    if (!list) return;

    list.innerHTML = '';
    if (_filteredCommands.length === 0) {
      list.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-dim);font-size:12px;">No matching commands found</div>';
      return;
    }

    _filteredCommands.forEach((cmd, idx) => {
      const item = document.createElement('div');
      item.className = `palette-item ${idx === _selectedIndex ? 'active' : ''}`;
      item.dataset.index = idx;

      const left = document.createElement('div');
      left.className = 'palette-item-left';

      const icon = document.createElement('span');
      icon.className = 'palette-item-icon';
      icon.textContent = cmd.icon || '⌘';

      const title = document.createElement('span');
      title.className = 'palette-item-title';
      title.textContent = cmd.title;

      left.appendChild(icon);
      left.appendChild(title);
      item.appendChild(left);

      if (cmd.shortcut) {
        const sc = document.createElement('span');
        sc.className = 'palette-item-shortcut';
        sc.textContent = cmd.shortcut;
        item.appendChild(sc);
      }

      item.addEventListener('click', () => {
        _selectedIndex = idx;
        _executeSelected();
      });

      list.appendChild(item);
    });

    const activeEl = list.children[_selectedIndex];
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest' });
    }
  }

  function _executeSelected() {
    if (_selectedIndex >= 0 && _selectedIndex < _filteredCommands.length) {
      const cmd = _filteredCommands[_selectedIndex];
      close();
      try {
        if (typeof cmd.action === 'function') {
          cmd.action();
        }
      } catch (err) {
        console.error('Palette command error:', err);
      }
    }
  }

  return {
    init,
    open,
    close,
    toggle,
    registerCommand,
  };
})();

window.PaletteModule = PaletteModule;
