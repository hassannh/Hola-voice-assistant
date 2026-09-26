/**
 * ide_chat.js — AI Agent Chat with Monaco file context & token streaming
 * Antigravity chat bubbles, markdown rendering, tool pills, and prompt chips
 */

const ChatModule = (() => {
  let _activeFileContext = null;
  let _currentStreamBubble = null;
  let _currentStreamBuffer = '';
  let _isStreaming = false;

  const $ = (id) => document.getElementById(id);

  function init() {
    const form = $('textChatForm');
    const input = $('promptInput');
    const clearBtn = $('clearHistoryBtn');

    // Context tracking from EditorModule
    window.addEventListener('editor-file-changed', (e) => {
      _activeFileContext = e.detail;
      _updateContextPill();
    });

    // Form submit
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        submitMessage();
      });
    }

    // Input keys: Enter sends, Shift+Enter newlines
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          submitMessage();
        }
      });

      // Auto-resize textarea
      input.addEventListener('input', () => {
        input.style.height = 'auto';
        input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
      });
    }

    // Clear history
    if (clearBtn) {
      clearBtn.addEventListener('click', async () => {
        try {
          await API.clear();
          clearChat();
          if (window.UIModule?.showToast) {
            UIModule.showToast('Chat history cleared');
          }
        } catch (err) {
          console.error('Clear chat error:', err);
        }
      });
    }

    // Chips
    _bindChips();
  }

  function _bindChips() {
    document.querySelectorAll('.chat-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const query = chip.dataset.query || chip.textContent;
        const input = $('promptInput');
        if (input) {
          input.value = query;
          input.focus();
          submitMessage();
        }
      });
    });
  }

  function _updateContextPill() {
    const pill = $('chatContextFile');
    const label = $('chatContextFileName');
    if (!pill || !label) return;

    if (_activeFileContext && _activeFileContext.name) {
      label.textContent = _activeFileContext.name;
      pill.hidden = false;
      pill.title = _activeFileContext.path;
    } else {
      pill.hidden = true;
    }
  }

  function _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function _formatMarkdown(raw) {
    if (!raw) return '';
    let text = raw;

    // Fenced code blocks ```lang\ncode\n```
    text = text.replace(/```([a-zA-Z0-9_\-]*)\n([\s\S]*?)```/g, (_, lang, code) => {
      return `<pre><code class="lang-${lang || 'plaintext'}">${_escapeHtml(code.trim())}</code></pre>`;
    });

    // Inline code `code`
    text = text.replace(/`([^`]+)`/g, (_, code) => `<code>${_escapeHtml(code)}</code>`);

    // Bold **text**
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // Italic *text*
    text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // Newlines to <br> outside <pre>
    const parts = text.split(/(<pre[\s\S]*?<\/pre>)/g);
    for (let i = 0; i < parts.length; i += 2) {
      parts[i] = parts[i].replace(/\n/g, '<br>');
    }

    return parts.join('');
  }

  function _scrollToBottom() {
    const feed = $('chatHistory');
    if (feed) {
      feed.scrollTop = feed.scrollHeight;
    }
  }

  function _removeEmptyState() {
    const feed = $('chatHistory');
    const empty = feed ? feed.querySelector('.ide-chat-empty') : null;
    if (empty) empty.remove();
  }

  function _bindActionButtons(bubble) {
    if (!bubble) return;

    bubble.querySelectorAll('pre').forEach((pre) => {
      const codeEl = pre.querySelector('code');
      if (!codeEl) return;

      const codeText = codeEl.textContent || '';
      const isBash = codeEl.className.includes('lang-bash') || codeEl.className.includes('lang-sh');

      const bar = document.createElement('div');
      bar.style.cssText = 'display:flex;justify-content:flex-end;gap:6px;margin:6px 0 4px;';

      // Copy code button
      const copyBtn = document.createElement('button');
      copyBtn.className = 'btn-action-reject';
      copyBtn.textContent = '📋 Copy';
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(codeText);
        copyBtn.textContent = '✓ Copied';
        setTimeout(() => { copyBtn.textContent = '📋 Copy'; }, 1500);
      });
      bar.appendChild(copyBtn);

      if (isBash) {
        const runBtn = document.createElement('button');
        runBtn.className = 'btn-action-apply';
        runBtn.innerHTML = '▶ Run in Terminal';
        runBtn.addEventListener('click', () => {
          if (window.TerminalModule) {
            TerminalModule.sendCommand(codeText.trim());
          }
        });
        bar.appendChild(runBtn);
      } else if (_activeFileContext && _activeFileContext.path) {
        const applyBtn = document.createElement('button');
        applyBtn.className = 'btn-action-apply';
        applyBtn.innerHTML = `✨ Apply to ${_activeFileContext.name || 'Editor'}`;
        applyBtn.addEventListener('click', () => {
          if (window.EditorModule) {
            EditorModule.openFile(_activeFileContext.path, null, codeText);
            if (window.UIModule?.showToast) {
              UIModule.showToast(`Applied code to ${_activeFileContext.name}`);
            }
          }
        });
        bar.appendChild(applyBtn);
      }

      pre.parentNode.insertBefore(bar, pre);
    });
  }

  function appendMessage(role, text) {
    _removeEmptyState();
    const feed = $('chatHistory');
    if (!feed) return;

    const row = document.createElement('div');
    row.className = `chat-msg ${role}`;

    const avatar = document.createElement('div');
    avatar.className = 'chat-avatar';
    avatar.textContent = role === 'user' ? 'U' : '⌘';

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    bubble.innerHTML = _formatMarkdown(text);

    if (role === 'user') {
      row.appendChild(bubble);
      row.appendChild(avatar);
    } else {
      row.appendChild(avatar);
      row.appendChild(bubble);
      _bindActionButtons(bubble);
    }

    feed.appendChild(row);
    _scrollToBottom();
    return bubble;
  }

  function startAssistantStream() {
    _removeEmptyState();
    const feed = $('chatHistory');
    if (!feed) return;

    _isStreaming = true;
    _currentStreamBuffer = '';

    const row = document.createElement('div');
    row.className = 'chat-msg assistant streaming-msg';

    const avatar = document.createElement('div');
    avatar.className = 'chat-avatar';
    avatar.textContent = '⌘';

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble streaming-cursor';
    bubble.textContent = '';

    row.appendChild(avatar);
    row.appendChild(bubble);
    feed.appendChild(row);

    _currentStreamBubble = bubble;
    _scrollToBottom();
  }

  function appendStreamToken(token) {
    if (!_currentStreamBubble) {
      startAssistantStream();
    }
    _currentStreamBuffer += token;
    if (_currentStreamBubble) {
      _currentStreamBubble.textContent = _currentStreamBuffer;
      _scrollToBottom();
    }
  }

  function finishAssistantStream(fullText) {
    const finalContent = fullText || _currentStreamBuffer;
    if (_currentStreamBubble) {
      _currentStreamBubble.classList.remove('streaming-cursor');
      _currentStreamBubble.innerHTML = _formatMarkdown(finalContent);
      _bindActionButtons(_currentStreamBubble);
      _currentStreamBubble = null;
    }
    _currentStreamBuffer = '';
    _isStreaming = false;
    _scrollToBottom();
  }

  function showToolExecution(toolText) {
    _removeEmptyState();
    const feed = $('chatHistory');
    if (!feed) return;

    const pill = document.createElement('div');
    pill.style.cssText = `
      align-self: center;
      padding: 3px 12px;
      font-size: 11px;
      font-family: var(--font-mono);
      color: var(--accent-2);
      background: var(--accent-2-dim);
      border: 1px solid rgba(34,211,238,0.3);
      border-radius: 99px;
      margin: 4px 0;
      animation: msg-in 0.2s ease;
    `;
    pill.innerHTML = `⚡ <span>${_escapeHtml(toolText)}</span>`;
    feed.appendChild(pill);
    _scrollToBottom();
  }

  function clearChat() {
    const feed = $('chatHistory');
    if (!feed) return;
    feed.innerHTML = `
      <div class="ide-chat-empty">
        <div class="ide-chat-empty-icon">⌘</div>
        <p>Ask Hola to explain code, generate diffs, fix bugs, or run terminal commands.</p>
        <div class="ide-chat-chips">
          <button class="chat-chip" data-query="Explain this file">📄 Explain file</button>
          <button class="chat-chip" data-query="Find bugs in this code">🐛 Find bugs</button>
          <button class="chat-chip" data-query="Write unit tests for this">🧪 Write tests</button>
          <button class="chat-chip" data-query="Refactor for readability">✨ Refactor</button>
          <button class="chat-chip" data-query="Run git status">💾 Git status</button>
        </div>
      </div>
    `;
    _bindChips();
  }

  async function submitMessage() {
    const input = $('promptInput');
    const speakToggle = $('speakReplyToggle');
    if (!input) return;

    const rawText = input.value.trim();
    if (!rawText) return;

    // Reset input
    input.value = '';
    input.style.height = 'auto';

    let promptToSend = rawText;

    // Prepend context if active file is open and user prompt references file or chips
    if (_activeFileContext && _activeFileContext.path) {
      const codeSnippet = (_activeFileContext.content || '').slice(0, 1500);
      promptToSend = `[Active file: ${_activeFileContext.path} (${_activeFileContext.language})]\n` +
        `\`\`\`${_activeFileContext.language}\n${codeSnippet}\n\`\`\`\n\n` +
        rawText;
    }

    appendMessage('user', rawText);
    startAssistantStream();

    const speak = Boolean(speakToggle && speakToggle.checked);

    try {
      if (window.UIModule?.updateAgentState) {
        UIModule.updateAgentState('thinking', 'Thinking…', true);
      }
      const res = await API.chat(promptToSend, speak);
      if (res && res.text) {
        finishAssistantStream(res.text);
      }
    } catch (err) {
      console.error('Chat error:', err);
      finishAssistantStream(`⚠️ Error: ${err.message}`);
    } finally {
      if (window.UIModule?.updateAgentState) {
        UIModule.updateAgentState('idle', 'Ready', false);
      }
    }
  }

  return {
    init,
    appendMessage,
    startAssistantStream,
    appendStreamToken,
    finishAssistantStream,
    showToolExecution,
    clearChat,
    submitMessage,
  };
})();

window.ChatModule = ChatModule;
