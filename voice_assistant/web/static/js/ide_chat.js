/**
 * ide_chat.js — AI Agent Chat with Monaco file context & token streaming
 * Antigravity chat bubbles, markdown rendering, tool pills, and prompt chips
 */

const ChatModule = (() => {
  let _activeFileContext = null;
  let _currentStreamBubble = null;
  let _currentStreamBuffer = '';
  let _isStreaming = false;
  let _estimatedTokens = 0;
  let _turnCount = 0;
  let _voiceEnabled = localStorage.getItem('hola_voice_enabled') !== 'false';

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

    // Chips & ECC actions
    _bindChips();
    _bindEccPills();
    _updateBudgetPill();
    _initVoiceToggle();
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

  function _bindEccPills() {
    document.querySelectorAll('.ecc-pill').forEach((pill) => {
      pill.addEventListener('click', () => {
        const prefix = pill.dataset.prefix || '';
        const input = $('promptInput');
        if (input) {
          if (!input.value.startsWith(prefix.trim())) {
            input.value = prefix + input.value.replace(/^\/(plan|fix|test|review|search)\s*/, '');
          }
          input.focus();
          input.setSelectionRange(input.value.length, input.value.length);
        }
      });
    });
  }

  function _updateBudgetPill() {
    const textEl = $('chatContextBudgetText');
    if (!textEl) return;
    if (_turnCount === 0) {
      textEl.textContent = 'Ready';
    } else {
      const kTokens = (_estimatedTokens / 1000).toFixed(1);
      textEl.textContent = `~${kTokens}k tok | ${_turnCount} turns`;
    }
  }

  function _setVoiceEnabled(enabled, syncBackend = true) {
    _voiceEnabled = Boolean(enabled);
    localStorage.setItem('hola_voice_enabled', _voiceEnabled ? 'true' : 'false');

    const speakToggle = $('speakReplyToggle');
    if (speakToggle) {
      speakToggle.checked = _voiceEnabled;
    }

    const muteBtn = $('agentVoiceMuteBtn');
    const iconActive = $('voiceIconActive');
    const iconMuted = $('voiceIconMuted');
    if (muteBtn) {
      muteBtn.classList.toggle('muted', !_voiceEnabled);
      muteBtn.title = _voiceEnabled ? 'Agent Voice: ON (Click to Mute)' : 'Agent Voice: MUTED (Click to Enable Voice)';
    }
    if (iconActive) iconActive.hidden = !_voiceEnabled;
    if (iconMuted) iconMuted.hidden = _voiceEnabled;

    const switchLabel = $('speakSwitchLabel');
    if (switchLabel) {
      switchLabel.textContent = _voiceEnabled ? 'Voice' : 'Muted';
    }

    if (syncBackend && window.API?.toggleVoiceMute) {
      API.toggleVoiceMute(_voiceEnabled).catch((err) => {
        console.warn('Voice mute sync error:', err);
      });
    }

    if (window.UIModule?.showToast) {
      UIModule.showToast(_voiceEnabled ? 'Agent voice enabled 🔊' : 'Agent voice muted — Text chat only 🔇');
    }
  }

  function _initVoiceToggle() {
    const muteBtn = $('agentVoiceMuteBtn');
    const speakToggle = $('speakReplyToggle');

    const saved = localStorage.getItem('hola_voice_enabled');
    _voiceEnabled = saved !== 'false';

    if (speakToggle) {
      speakToggle.checked = _voiceEnabled;
      speakToggle.addEventListener('change', () => {
        _setVoiceEnabled(speakToggle.checked);
      });
    }

    const iconActive = $('voiceIconActive');
    const iconMuted = $('voiceIconMuted');
    const switchLabel = $('speakSwitchLabel');
    if (muteBtn) {
      muteBtn.classList.toggle('muted', !_voiceEnabled);
      muteBtn.title = _voiceEnabled ? 'Agent Voice: ON (Click to Mute)' : 'Agent Voice: MUTED (Click to Enable Voice)';
      muteBtn.addEventListener('click', () => {
        _setVoiceEnabled(!_voiceEnabled);
      });
    }
    if (iconActive) iconActive.hidden = !_voiceEnabled;
    if (iconMuted) iconMuted.hidden = _voiceEnabled;
    if (switchLabel) switchLabel.textContent = _voiceEnabled ? 'Voice' : 'Muted';

    if (window.API?.toggleVoiceMute) {
      API.toggleVoiceMute(_voiceEnabled).catch(() => {});
    }
  }

  function _expandEccCommand(rawText) {
    const trimmed = rawText.trim();
    if (trimmed.startsWith('/plan')) {
      const task = trimmed.replace(/^\/plan\s*/, '') || 'the current objective';
      return `[ECC Plan Mode]\nDeconstruct this engineering task into an architectural plan before modifying code. Explore the codebase first, assess dependencies and risks, then outline step-by-step implementation and verification phases.\n\nObjective: ${task}`;
    }
    if (trimmed.startsWith('/test')) {
      const feat = trimmed.replace(/^\/test\s*/, '') || 'the target module';
      return `[ECC TDD Mode]\nApply Test-Driven Development (TDD). First inspect the existing test setup, design targeted unit tests with mocks/fixtures, run them via execute_terminal_command to confirm failure, then write minimal code to pass.\n\nTarget: ${feat}`;
    }
    if (trimmed.startsWith('/fix')) {
      const err = trimmed.replace(/^\/fix\s*/, '') || 'the current issue';
      return `[ECC Fix Mode]\nDiagnose and fix this error using root-cause isolation. Search for the error location, inspect the stack trace, formulate a hypothesis, apply a surgical patch (do not mask errors), and verify using tests/linters.\n\nError/Issue: ${err}`;
    }
    if (trimmed.startsWith('/review')) {
      const target = trimmed.replace(/^\/review\s*/, '') || (_activeFileContext?.name ? `active file ${_activeFileContext.name}` : 'the current code');
      return `[ECC Review Mode]\nConduct an exhaustive, fresh-context code review on ${target}. Check for:\n1. Edge cases & null safety\n2. Security vulnerabilities & injection points\n3. Performance bottlenecks & memory leaks\n4. Type safety & architectural consistency`;
    }
    if (trimmed.startsWith('/search')) {
      const query = trimmed.replace(/^\/search\s*/, '');
      return `[ECC Search Mode]\nConduct deep multi-source research. Search codebase symbols with search_code_and_files and search web documentation with search_developer_web to find official patterns.\n\nQuery: ${query}`;
    }
    return rawText;
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
        // Review Diff button
        const diffBtn = document.createElement('button');
        diffBtn.className = 'btn-action-reject';
        diffBtn.innerHTML = '⚖️ Diff';
        diffBtn.title = 'Review side-by-side diff against current file';
        diffBtn.addEventListener('click', () => {
          if (window.EditorModule) {
            const currentContent = EditorModule.getCurrentContent();
            EditorModule.showDiff(currentContent, codeText, _activeFileContext.name);
          }
        });
        bar.appendChild(diffBtn);

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

  let _activeToolCard = null;

  function finishAssistantStream(fullText) {
    if (_activeToolCard) {
      const badge = _activeToolCard.querySelector('.agent-tool-badge');
      const ind = _activeToolCard.querySelector('.agent-tool-indicator');
      if (badge) {
        badge.textContent = 'Done';
        badge.classList.add('done');
      }
      if (ind) ind.classList.add('done');
      _activeToolCard = null;
    }

    const finalContent = fullText || _currentStreamBuffer;
    if (_currentStreamBubble) {
      _currentStreamBubble.classList.remove('streaming-cursor');
      _currentStreamBubble.innerHTML = _formatMarkdown(finalContent);
      _bindActionButtons(_currentStreamBubble);
      _currentStreamBubble = null;
    } else if (finalContent) {
      appendMessage('assistant', finalContent);
    }
    if (finalContent) {
      _estimatedTokens += Math.ceil(finalContent.length / 4);
      _updateBudgetPill();
    }
    _currentStreamBuffer = '';
    _isStreaming = false;
    _scrollToBottom();
  }

  function showToolExecution(toolText) {
    _removeEmptyState();
    const feed = $('chatHistory');
    if (!feed) return;

    if (_activeToolCard) {
      const badge = _activeToolCard.querySelector('.agent-tool-badge');
      const ind = _activeToolCard.querySelector('.agent-tool-indicator');
      if (badge) {
        badge.textContent = 'Done';
        badge.classList.add('done');
      }
      if (ind) ind.classList.add('done');
    }

    const card = document.createElement('div');
    card.className = 'agent-tool-card';
    card.innerHTML = `
      <div class="agent-tool-header">
        <div class="agent-tool-left">
          <div class="agent-tool-indicator"></div>
          <div class="agent-tool-title">${_formatMarkdown(toolText || 'Executing action…')}</div>
        </div>
        <span class="agent-tool-badge">Running…</span>
      </div>
    `;

    _activeToolCard = card;
    feed.appendChild(card);
    _scrollToBottom();
  }

  function clearChat() {
    _estimatedTokens = 0;
    _turnCount = 0;
    _updateBudgetPill();
    const feed = $('chatHistory');
    if (!feed) return;
    feed.innerHTML = `
      <div class="ide-chat-empty">
        <div class="ide-chat-empty-icon">⌘</div>
        <p>Autonomous AI pair programmer powered by the ECC engineering harness. Plan architectures, write TDD tests, isolate bugs, and verify with terminal commands.</p>
        <div class="ide-chat-chips">
          <button class="chat-chip" data-query="/plan Refactor current module with risk assessment">⚡ /plan</button>
          <button class="chat-chip" data-query="/fix Diagnose and fix error in active file">🐛 /fix</button>
          <button class="chat-chip" data-query="/test Write and run pytest suite">🧪 /test</button>
          <button class="chat-chip" data-query="/review Check security, edge cases, and performance">🛡️ /review</button>
          <button class="chat-chip" data-query="/search Find symbol definitions and usages">🔍 /search</button>
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

    // ECC /compact or /clear shortcut
    if (rawText === '/compact' || rawText === '/clear') {
      try {
        await API.clear();
        clearChat();
        if (window.UIModule?.showToast) {
          UIModule.showToast('Context budget compacted & cleared');
        }
      } catch (err) {
        console.error('Clear chat error:', err);
      }
      return;
    }

    const expandedText = _expandEccCommand(rawText);
    let promptToSend = expandedText;

    // Prepend context if active file is open and user prompt does not already embed file
    if (_activeFileContext && _activeFileContext.path && !expandedText.includes('[Active file:')) {
      const codeSnippet = (_activeFileContext.content || '').slice(0, 1500);
      promptToSend = `[Active file: ${_activeFileContext.path} (${_activeFileContext.language})]\n` +
        `\`\`\`${_activeFileContext.language}\n${codeSnippet}\n\`\`\`\n\n` +
        expandedText;
    }

    _estimatedTokens += Math.ceil(promptToSend.length / 4);
    _turnCount += 1;
    _updateBudgetPill();

    appendMessage('user', rawText);
    startAssistantStream();

    const speak = _voiceEnabled;

    try {
      if (window.UIModule?.updateAgentState) {
        UIModule.updateAgentState('thinking', 'Thinking…', true);
      }
      const res = await API.chat(promptToSend, speak);
      const answer = res?.reply || res?.text || '';
      if (answer) {
        finishAssistantStream(answer);
      } else if (res && res.error) {
        finishAssistantStream(`⚠️ Error: ${res.error}`);
      } else {
        finishAssistantStream(_currentStreamBuffer || 'No response received.');
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

  async function sendPrompt(text) {
    if (!text || !text.trim()) return;

    if (text === '/compact' || text === '/clear') {
      try {
        await API.clear();
        clearChat();
      } catch (err) {
        console.error('Clear error:', err);
      }
      return;
    }

    const expanded = _expandEccCommand(text);
    _estimatedTokens += Math.ceil(expanded.length / 4);
    _turnCount += 1;
    _updateBudgetPill();

    appendMessage('user', text);
    startAssistantStream();

    const speak = _voiceEnabled;

    try {
      if (window.UIModule?.updateAgentState) {
        UIModule.updateAgentState('thinking', 'Thinking…', true);
      }
      const res = await API.chat(expanded, speak);
      const answer = res?.reply || res?.text || '';
      if (answer) {
        finishAssistantStream(answer);
      } else if (res && res.error) {
        finishAssistantStream(`⚠️ Error: ${res.error}`);
      } else {
        finishAssistantStream(_currentStreamBuffer || 'No response received.');
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
    sendPrompt,
    setVoiceEnabled: _setVoiceEnabled,
    isVoiceEnabled: () => _voiceEnabled,
  };
})();

window.ChatModule = ChatModule;
window.IdeChatModule = ChatModule;
