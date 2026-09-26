/**
 * ide_main.js — Main Coordinator, Shell Layout & Configuration for Hola IDE
 * Activity bar, split pane resizing, bottom panel collapse, voice loop & settings
 */

const UIModule = (() => {
  const $ = (id) => document.getElementById(id);
  let _toastTimer = null;

  function showToast(msg, duration = 3000) {
    const t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => {
      t.hidden = true;
    }, duration);
  }

  function updateAgentState(state, text, isRunning) {
    const pill = $('agentStatePill');
    const label = $('agentStateText');
    if (pill) {
      pill.className = `tb-pill state-pill ${state || 'idle'}`;
    }
    if (label) {
      label.textContent = text || (state ? state.toUpperCase() : 'IDLE');
    }
  }

  function setRunningState(isRunning) {
    const btn = $('toggleVoiceBtn');
    const txt = $('toggleVoiceText');
    if (btn) {
      if (isRunning) {
        btn.classList.add('running');
      } else {
        btn.classList.remove('running');
      }
    }
    if (txt) {
      txt.textContent = isRunning ? 'Stop Voice' : 'Start Voice';
    }
  }

  function updateOllamaPill(ollamaState) {
    const pill = $('ollamaPill');
    const txt = $('ollamaStatusText');
    if (!pill || !txt) return;

    if (ollamaState && ollamaState.status === 'ok') {
      pill.className = 'tb-pill online';
      txt.textContent = `Ollama ${ollamaState.version || 'OK'}`;
    } else {
      pill.className = 'tb-pill offline';
      txt.textContent = 'Ollama Offline';
    }
  }

  function updateOllamaPull(msg) {
    if (msg.status) {
      showToast(`Ollama: ${msg.status}`);
    }
  }

  // Delegation methods for ws.js / backward compatibility
  function appendMessage(role, text) {
    if (window.ChatModule) return ChatModule.appendMessage(role, text);
  }

  function startAssistantStream() {
    if (window.ChatModule) return ChatModule.startAssistantStream();
  }

  function appendStreamToken(text) {
    if (window.ChatModule) return ChatModule.appendStreamToken(text);
  }

  function finishAssistantStream(text) {
    if (window.ChatModule) return ChatModule.finishAssistantStream(text);
  }

  function showToolExecution(text) {
    if (window.ChatModule) return ChatModule.showToolExecution(text);
  }

  function clearChat() {
    if (window.ChatModule) return ChatModule.clearChat();
  }

  let _cachedProviders = {};
  let _currentSettings = null;

  function setProviders(providers) {
    _cachedProviders = providers || {};
  }

  function updateProviderUI(providerId) {
    providerId = (providerId || 'ollama').toLowerCase();
    const meta = _cachedProviders[providerId] || {};
    const modelInput = $('llm_model');
    const dataList = $('modelSuggestions');
    const pillsWrap = $('quickModelPills');
    const apiKeyGroup = $('apiKeyGroup');
    const apiKeyBadge = $('apiKeyBadge');
    const apiKeyInput = $('llm_api_key');
    const baseUrlGroup = $('baseUrlGroup');
    const baseUrlInput = $('llm_base_url');

    if (dataList) {
      dataList.innerHTML = '';
      (meta.models || []).forEach((m) => {
        const opt = document.createElement('option');
        opt.value = m;
        dataList.appendChild(opt);
      });
    }

    if (pillsWrap) {
      pillsWrap.innerHTML = '';
      (meta.models || []).slice(0, 5).forEach((m) => {
        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'quick-pill' + (modelInput && modelInput.value === m ? ' active' : '');
        pill.textContent = m.split('/').pop();
        pill.title = m;
        pill.addEventListener('click', () => {
          if (modelInput) {
            modelInput.value = m;
            modelInput.dispatchEvent(new Event('input'));
          }
          pillsWrap.querySelectorAll('.quick-pill').forEach((p) => p.classList.remove('active'));
          pill.classList.add('active');
          const activeModelName = $('activeModelName');
          if (activeModelName) activeModelName.textContent = m;
        });
        pillsWrap.appendChild(pill);
      });
    }

    if (apiKeyGroup) {
      if (meta.requires_key === false && providerId === 'ollama') {
        if (apiKeyBadge) {
          apiKeyBadge.textContent = 'Local (No Key)';
          apiKeyBadge.className = 'key-status-badge configured';
        }
      } else {
        const hasKey = Boolean(meta.has_key || (_currentSettings && _currentSettings.llm_provider === providerId && _currentSettings.has_api_key));
        if (apiKeyBadge) {
          apiKeyBadge.textContent = hasKey ? 'Configured' : 'Not Set';
          apiKeyBadge.className = `key-status-badge ${hasKey ? 'configured' : 'unconfigured'}`;
        }
        if (apiKeyInput) {
          if (hasKey && meta.masked_key && !apiKeyInput.value) {
            apiKeyInput.placeholder = meta.masked_key;
          } else if (_currentSettings && _currentSettings.llm_provider === providerId && _currentSettings.llm_api_key_masked && !apiKeyInput.value) {
            apiKeyInput.placeholder = _currentSettings.llm_api_key_masked;
          } else if (!apiKeyInput.value) {
            apiKeyInput.placeholder = meta.key_hint || 'Enter API Key';
          }
        }
      }
    }

    if (baseUrlGroup) {
      baseUrlGroup.hidden = !(providerId === 'custom' || (baseUrlInput && baseUrlInput.value));
    }
  }

  function showTestResult(status, message) {
    const el = $('llmTestResult');
    if (!el) return;
    el.hidden = false;
    el.className = 'llm-test-result ' + status;
    el.innerHTML = message;
  }

  function fillSettings(settings, devices, providers) {
    if (providers) setProviders(providers);

    const deviceSel = $('input_device');
    if (deviceSel && devices) {
      deviceSel.innerHTML = '';
      const defOpt = document.createElement('option');
      defOpt.value = '';
      defOpt.textContent = 'Default System Microphone';
      deviceSel.appendChild(defOpt);

      devices.forEach((d) => {
        const opt = document.createElement('option');
        opt.value = d.index;
        opt.textContent = `${d.name} (${d.channels}ch, ${Math.round(d.sample_rate / 1000)}kHz)`;
        if (settings && settings.input_device !== null && Number(settings.input_device) === d.index) {
          opt.selected = true;
        }
        deviceSel.appendChild(opt);
      });
    }

    if (!settings) return;
    _currentSettings = settings;

    if ($('llm_provider')) $('llm_provider').value = settings.llm_provider || 'ollama';
    if ($('llm_model')) $('llm_model').value = settings.llm_model || '';
    if ($('stt_model_size')) $('stt_model_size').value = settings.stt_model_size || 'base';
    if ($('wake_word')) $('wake_word').value = settings.wake_word || '';
    if ($('system_prompt')) $('system_prompt').value = settings.system_prompt || '';
    if ($('tts_rate')) $('tts_rate').value = settings.tts_rate || 175;
    if ($('max_record_seconds')) $('max_record_seconds').value = settings.max_record_seconds || 10;
    if ($('llm_base_url')) $('llm_base_url').value = settings.llm_base_url || '';

    if ($('adaptive_vad')) $('adaptive_vad').checked = Boolean(settings.adaptive_vad);
    if ($('use_vad')) $('use_vad').checked = Boolean(settings.use_vad);
    if ($('enable_tools')) $('enable_tools').checked = Boolean(settings.enable_tools);
    if ($('stream_tokens')) $('stream_tokens').checked = Boolean(settings.stream_tokens);

    const activeModelName = $('activeModelName');
    if (activeModelName) {
      activeModelName.textContent = settings.llm_model || 'llama3.2:3b';
    }

    updateProviderUI(settings.llm_provider || 'ollama');
  }

  return {
    showToast,
    updateAgentState,
    setRunningState,
    updateOllamaPill,
    updateOllamaPull,
    appendMessage,
    startAssistantStream,
    appendStreamToken,
    finishAssistantStream,
    showToolExecution,
    clearChat,
    fillSettings,
    updateProviderUI,
    showTestResult,
  };
})();

window.UIModule = UIModule;

// ── Application Bootstrap ─────────────────────────────────────────
(async () => {
  const $ = (id) => document.getElementById(id);
  let _isRunning = false;
  let _sidebarVisible = true;

  // 1. Initialize Submodules
  if (window.EditorModule) EditorModule.init();
  if (window.ExplorerModule) ExplorerModule.init();
  if (window.GitModule) GitModule.init();
  if (window.SearchModule) SearchModule.init();
  if (window.ChatModule) ChatModule.init();
  if (window.TerminalModule) TerminalModule.init();
  if (window.PaletteModule) PaletteModule.init();
  if (window.KeybindingsModule) KeybindingsModule.init();

  // Connect WebSocket
  if (window.WSModule) WSModule.connect();

  // 2. Activity Bar Navigation
  function _switchPanel(panelId) {
    const sidePanel = $('ideSidePanel');
    const buttons = document.querySelectorAll('.activity-btn');
    const panels = document.querySelectorAll('.side-panel-view');

    // Chat activity button toggles right-side Agent Panel
    if (panelId === 'chat') {
      const agentPanel = $('ideAgentPanel');
      if (agentPanel) {
        agentPanel.classList.toggle('collapsed');
        if (!agentPanel.classList.contains('collapsed')) {
          const promptInput = $('promptInput');
          if (promptInput) promptInput.focus();
        }
      }
      return;
    }

    // Check if clicking currently active button
    const targetBtn = document.querySelector(`.activity-btn[data-panel="${panelId}"]`);
    const isCurrentlyActive = targetBtn && targetBtn.classList.contains('active');

    if (isCurrentlyActive && _sidebarVisible) {
      // Toggle sidebar collapse
      sidePanel.style.display = 'none';
      _sidebarVisible = false;
      targetBtn.classList.remove('active');
      return;
    }

    // Ensure sidebar is visible
    sidePanel.style.display = 'flex';
    _sidebarVisible = true;

    buttons.forEach((b) => b.classList.remove('active'));
    panels.forEach((p) => p.classList.remove('active'));

    if (targetBtn) targetBtn.classList.add('active');

    const view = $('panel' + panelId.charAt(0).toUpperCase() + panelId.slice(1));
    if (view) view.classList.add('active');

    // Trigger panel-specific refreshes
    if (panelId === 'git') {
      GitModule.refresh();
    } else if (panelId === 'search') {
      const sInput = $('searchQueryInput');
      if (sInput) sInput.focus();
    }
  }

  document.querySelectorAll('.activity-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const panel = btn.dataset.panel;
      if (panel) _switchPanel(panel);
    });
  });

  const settingsToggleBtn = $('settingsToggleBtn');
  if (settingsToggleBtn) {
    settingsToggleBtn.addEventListener('click', () => {
      _switchPanel('settings');
    });
  }

  const modelPill = $('modelPill');
  if (modelPill) {
    modelPill.addEventListener('click', () => {
      _switchPanel('settings');
      $('llm_model')?.focus();
    });
  }

  const ollamaPill = $('ollamaPill');
  if (ollamaPill) {
    ollamaPill.addEventListener('click', () => {
      _switchPanel('settings');
      $('llm_provider')?.focus();
    });
  }

  // 3. Sidebar Horizontal Resize Handle (Left)
  const sidePanelResize = $('sidePanelResize');
  const sidePanel = $('ideSidePanel');
  if (sidePanelResize && sidePanel) {
    let isResizing = false;

    sidePanelResize.addEventListener('mousedown', () => {
      isResizing = true;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });

    window.addEventListener('mousemove', (e) => {
      if (!isResizing) return;
      const newWidth = Math.min(500, Math.max(160, e.clientX - 48)); // subtract activity bar width
      sidePanel.style.width = `${newWidth}px`;
    });

    window.addEventListener('mouseup', () => {
      if (isResizing) {
        isResizing = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    });
  }

  // 4. Right-Side Antigravity AI Agent Resize Handle
  const agentPanelResize = $('agentPanelResize');
  const agentPanel = $('ideAgentPanel');
  const toggleAgentPanel = $('toggleAgentPanel');

  if (toggleAgentPanel && agentPanel) {
    toggleAgentPanel.addEventListener('click', () => {
      agentPanel.classList.toggle('collapsed');
    });
  }

  if (agentPanelResize && agentPanel) {
    let isResizingAgent = false;

    agentPanelResize.addEventListener('mousedown', () => {
      isResizingAgent = true;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });

    window.addEventListener('mousemove', (e) => {
      if (!isResizingAgent) return;
      const newWidth = Math.min(800, Math.max(260, window.innerWidth - e.clientX));
      agentPanel.style.width = `${newWidth}px`;
    });

    window.addEventListener('mouseup', () => {
      if (isResizingAgent) {
        isResizingAgent = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    });
  }

  // 5. Bottom Terminal Panel Vertical Resize & Collapse
  const bottomPanelResize = $('bottomPanelResize');
  const bottomPanel = $('ideBottomPanel');
  const toggleBottomPanel = $('toggleBottomPanel');

  if (toggleBottomPanel && bottomPanel) {
    toggleBottomPanel.addEventListener('click', () => {
      bottomPanel.classList.toggle('collapsed');
      toggleBottomPanel.querySelector('svg').style.transform = bottomPanel.classList.contains('collapsed')
        ? 'rotate(180deg)'
        : '';
      setTimeout(() => {
        window.TerminalModule?.refit();
      }, 250);
    });
  }

  if (bottomPanelResize && bottomPanel) {
    let isResizingBottom = false;

    bottomPanelResize.addEventListener('mousedown', () => {
      isResizingBottom = true;
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
    });

    window.addEventListener('mousemove', (e) => {
      if (!isResizingBottom) return;
      const newHeight = Math.min(600, Math.max(80, window.innerHeight - e.clientY - 24)); // subtract statusbar
      bottomPanel.style.height = `${newHeight}px`;
      bottomPanel.classList.remove('collapsed');
      window.TerminalModule?.refit();
    });

    window.addEventListener('mouseup', () => {
      if (isResizingBottom) {
        isResizingBottom = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        window.TerminalModule?.refit();
      }
    });
  }

  // 6. Terminal Quick Action Buttons
  const termRunFileBtn = $('termRunFileBtn');
  const termPytestBtn = $('termPytestBtn');
  const termGitStatusBtn = $('termGitStatusBtn');
  const termClearBtn = $('termClearBtn');

  if (termRunFileBtn) {
    termRunFileBtn.addEventListener('click', () => {
      const activePath = window.EditorModule?.getCurrentPath();
      if (activePath) {
        const ext = activePath.split('.').pop() || '';
        const runner = ext === 'py' ? 'python3' : ext === 'js' ? 'node' : ext === 'sh' ? 'bash' : 'cat';
        window.TerminalModule?.sendCommand(`${runner} "${activePath}"`);
      } else {
        window.UIModule?.showToast('No active file open to run');
      }
    });
  }

  if (termPytestBtn) {
    termPytestBtn.addEventListener('click', () => {
      window.TerminalModule?.sendCommand('pytest -v');
    });
  }

  if (termGitStatusBtn) {
    termGitStatusBtn.addEventListener('click', () => {
      window.TerminalModule?.sendCommand('git status');
    });
  }

  if (termClearBtn) {
    termClearBtn.addEventListener('click', () => {
      window.TerminalModule?.sendCommand('clear');
    });
  }

  // 5. Voice Assistant Toggle
  const toggleVoiceBtn = $('toggleVoiceBtn');
  if (toggleVoiceBtn) {
    toggleVoiceBtn.addEventListener('click', async () => {
      try {
        if (!_isRunning) {
          UIModule.updateAgentState('listening', 'Starting microphone…', false);
          const data = await API.start();
          if (data.ok) {
            _isRunning = true;
            WSModule.setRunning(true);
            UIModule.setRunningState(true);
            UIModule.showToast('Hola voice assistant active');
          } else {
            UIModule.showToast('Voice start failed: ' + (data.error || 'Unknown'));
            UIModule.updateAgentState('error', data.error, false);
          }
        } else {
          const data = await API.stop();
          if (data.ok) {
            _isRunning = false;
            WSModule.setRunning(false);
            UIModule.setRunningState(false);
            UIModule.updateAgentState('idle', 'Assistant stopped', false);
            UIModule.showToast('Hola voice assistant stopped');
          }
        }
      } catch (err) {
        console.error('Voice toggle error:', err);
        UIModule.showToast('Voice toggle error: ' + err.message);
      }
    });
  }

  // 6. Settings Form Logic
  const providerSelect = $('llm_provider');
  if (providerSelect) {
    providerSelect.addEventListener('change', (e) => {
      UIModule.updateProviderUI(e.target.value);
    });
  }

  const toggleApiKeyVisibility = $('toggleApiKeyVisibility');
  const apiKeyInput = $('llm_api_key');
  const eyeOpenIcon = $('eyeOpenIcon');
  const eyeClosedIcon = $('eyeClosedIcon');

  if (toggleApiKeyVisibility && apiKeyInput) {
    toggleApiKeyVisibility.addEventListener('click', () => {
      const isPass = apiKeyInput.type === 'password';
      apiKeyInput.type = isPass ? 'text' : 'password';
      if (eyeOpenIcon) eyeOpenIcon.hidden = isPass;
      if (eyeClosedIcon) eyeClosedIcon.hidden = !isPass;
    });
  }

  // Real-time API key typing indicator
  if (apiKeyInput) {
    apiKeyInput.addEventListener('input', () => {
      const val = apiKeyInput.value.trim();
      const apiKeyBadge = $('apiKeyBadge');
      if (!apiKeyBadge) return;
      if (val.length > 8) {
        apiKeyBadge.textContent = 'Ready to Save';
        apiKeyBadge.className = 'key-status-badge configured';
      } else if (val.length > 0) {
        apiKeyBadge.textContent = 'Entering Key...';
        apiKeyBadge.className = 'key-status-badge unconfigured';
      } else {
        const provider = $('llm_provider')?.value || 'ollama';
        const meta = _cachedProviders[provider] || {};
        const hasKey = Boolean(meta.has_key || (_currentSettings && _currentSettings.llm_provider === provider && _currentSettings.has_api_key));
        apiKeyBadge.textContent = hasKey ? 'Configured' : 'Not Set';
        apiKeyBadge.className = `key-status-badge ${hasKey ? 'configured' : 'unconfigured'}`;
      }
    });
  }

  const testLlmBtn = $('testLlmBtn');
  if (testLlmBtn) {
    testLlmBtn.addEventListener('click', async () => {
      const provider = $('llm_provider')?.value || 'ollama';
      const model = $('llm_model')?.value || '';
      const apiKey = $('llm_api_key')?.value || '';
      const baseUrl = provider === 'custom' ? $('llm_base_url')?.value || '' : null;

      if (!model) {
        UIModule.showTestResult('error', 'Please specify a model name first.');
        return;
      }

      UIModule.showTestResult('loading', `Testing connection to ${provider.toUpperCase()} (${model})…`);
      try {
        const res = await API.testConnection({
          provider,
          model,
          api_key: apiKey || null,
          base_url: baseUrl || null,
        });
        if (res.ok) {
          UIModule.showTestResult(
            'success',
            `✓ Connected in ${res.latency_ms}ms!<br><span style="opacity:0.85">Reply: "${res.reply}"</span>`
          );

          // Update badge immediately to Configured
          const apiKeyBadge = $('apiKeyBadge');
          if (apiKeyBadge) {
            apiKeyBadge.textContent = 'Configured';
            apiKeyBadge.className = 'key-status-badge configured';
          }

          // Auto-save this validated configuration so the assistant uses it immediately
          try {
            const savePayload = {
              llm_provider: provider,
              llm_model: model,
            };
            if (apiKey && !apiKey.includes('••••') && !apiKey.includes('***')) {
              savePayload.llm_api_key = apiKey.trim();
            }
            if (baseUrl) savePayload.llm_base_url = baseUrl;

            const saveRes = await API.saveSettings(savePayload);
            if (saveRes && saveRes.ok) {
              if (saveRes.settings) _currentSettings = saveRes.settings;
              if (saveRes.providers) setProviders(saveRes.providers);
              const activeModelName = $('activeModelName');
              if (activeModelName) activeModelName.textContent = model;
              UIModule.showToast(`✓ ${provider.toUpperCase()} (${model}) verified and saved!`);
            }
          } catch (autoSaveErr) {
            console.warn('Auto-save error:', autoSaveErr);
          }
        } else {
          UIModule.showTestResult('error', `✕ ${res.error}`);
        }
      } catch (err) {
        UIModule.showTestResult('error', `✕ Network error: ${err.message}`);
      }
    });
  }

  // Quick Save Key & Model Button
  const saveKeyQuickBtn = $('saveKeyQuickBtn');
  if (saveKeyQuickBtn) {
    saveKeyQuickBtn.addEventListener('click', async () => {
      const provider = $('llm_provider')?.value || 'ollama';
      const model = $('llm_model')?.value || '';
      const rawApiKey = $('llm_api_key')?.value || '';
      const baseUrl = provider === 'custom' ? $('llm_base_url')?.value || '' : null;

      const payload = {
        llm_provider: provider,
        llm_model: model,
      };
      if (rawApiKey && !rawApiKey.includes('••••') && !rawApiKey.includes('***')) {
        payload.llm_api_key = rawApiKey.trim();
      }
      if (baseUrl) payload.llm_base_url = baseUrl;

      try {
        const data = await API.saveSettings(payload);
        if (data && data.ok) {
          if (data.settings) _currentSettings = data.settings;
          if (data.providers) setProviders(data.providers);
          const apiKeyBadge = $('apiKeyBadge');
          if (apiKeyBadge) {
            apiKeyBadge.textContent = 'Configured';
            apiKeyBadge.className = 'key-status-badge configured';
          }
          const activeModelName = $('activeModelName');
          if (activeModelName) activeModelName.textContent = model;
          UIModule.showToast(`✓ Saved ${provider.toUpperCase()} (${model}) successfully!`);
          UIModule.showTestResult('success', `✓ ${provider.toUpperCase()} (${model}) configuration saved.`);
        } else {
          UIModule.showToast('Save error: ' + (data?.error || 'Unknown'));
        }
      } catch (err) {
        UIModule.showToast('Save failure: ' + err.message);
      }
    });
  }

  const settingsForm = $('settingsForm');
  if (settingsForm) {
    settingsForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const dev = $('input_device')?.value;
      const rawApiKey = $('llm_api_key')?.value;
      const payload = {
        stt_model_size: $('stt_model_size')?.value,
        llm_provider: $('llm_provider')?.value || 'ollama',
        llm_model: $('llm_model')?.value,
        llm_base_url: $('llm_base_url')?.value || null,
        wake_word: $('wake_word')?.value || null,
        adaptive_vad: $('adaptive_vad')?.checked,
        use_vad: $('use_vad')?.checked,
        enable_tools: $('enable_tools')?.checked,
        stream_tokens: $('stream_tokens')?.checked,
        tts_rate: Number($('tts_rate')?.value || 175),
        max_record_seconds: Number($('max_record_seconds')?.value || 10),
        system_prompt: $('system_prompt')?.value,
        input_device: dev === '' || dev === undefined ? null : Number(dev),
      };

      if (rawApiKey && !rawApiKey.includes('••••') && !rawApiKey.includes('***')) {
        payload.llm_api_key = rawApiKey.trim();
      }

      try {
        const data = await API.saveSettings(payload);
        if (data && data.ok) {
          UIModule.showToast('Configuration saved successfully');
          const activeModelName = $('activeModelName');
          if (activeModelName) activeModelName.textContent = payload.llm_model;
          await loadInitialState();
        } else {
          UIModule.showToast('Error saving: ' + (data?.error || 'Unknown'));
        }
      } catch (err) {
        UIModule.showToast('Save failure: ' + err.message);
      }
    });
  }

  // 7. Global Keyboard Shortcuts
  let _zenActive = false;
  let _lastZenLeft = '260px';
  let _lastZenRight = '420px';

  window.addEventListener('keydown', (e) => {
    // Ctrl+` (backtick) or Ctrl+Shift+A toggles Right-Side AI Agent Dock
    if (((e.ctrlKey || e.metaKey) && e.key === '`') || ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'a')) {
      e.preventDefault();
      if (agentPanel) {
        agentPanel.classList.toggle('collapsed');
        if (!agentPanel.classList.contains('collapsed')) {
          const promptInput = $('promptInput');
          if (promptInput) promptInput.focus();
        }
      }
    }

    // Ctrl+J toggles Bottom Terminal Dock
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') {
      e.preventDefault();
      if (bottomPanel) {
        bottomPanel.classList.toggle('collapsed');
        toggleBottomPanel.querySelector('svg').style.transform = bottomPanel.classList.contains('collapsed')
          ? 'rotate(180deg)'
          : '';
        setTimeout(() => window.TerminalModule?.refit(), 250);
      }
    }

    // Ctrl+P opens search
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
      e.preventDefault();
      _switchPanel('search');
    }

    // Ctrl+Shift+E opens explorer
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'e') {
      e.preventDefault();
      _switchPanel('explorer');
    }

    // Ctrl+Shift+G opens git
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'g') {
      e.preventDefault();
      _switchPanel('git');
    }
  });

  // 8. Load Initial State from Backend
  async function loadInitialState() {
    try {
      const data = await API.loadState();
      UIModule.fillSettings(data.settings, data.devices, data.providers);
      UIModule.updateOllamaPill(data.ollama);

      _isRunning = Boolean(data.running);
      WSModule.setRunning(_isRunning);
      UIModule.setRunningState(_isRunning);
      UIModule.updateAgentState(data.status || 'idle', data.status || 'Ready', _isRunning);

      if (data.history && data.history.length > 0) {
        data.history
          .filter((m) => m.role !== 'system')
          .forEach((m) => ChatModule.appendMessage(m.role, m.content));
      }
    } catch (err) {
      console.warn('Initial state error:', err);
    }
  }

  await loadInitialState();
})();
