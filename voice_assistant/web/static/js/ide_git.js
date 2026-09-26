/**
 * ide_git.js — Source Control integration for Hola IDE
 * Git status, branch telemetry, diff inspection, commit log & staging
 */

const GitModule = (() => {
  const $ = (id) => document.getElementById(id);

  function init() {
    const refreshBtn = $('gitRefreshBtn');
    const commitBtn = $('gitCommitBtn');
    const commitInput = $('gitCommitMsg');

    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => refresh());
    }

    if (commitBtn) {
      commitBtn.addEventListener('click', () => commit());
    }

    if (commitInput) {
      commitInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          commit();
        }
      });
    }

    // Initial load
    refresh();
  }

  async function refresh() {
    await Promise.all([loadStatus(), loadLog()]);
  }

  async function loadStatus() {
    const root = window.ExplorerModule?.getCurrentRoot() || '.';
    const branchLabel = $('gitBranchLabel');
    const statusBranchName = $('statusBranchName');
    const badge = $('gitBadge');
    const fileList = $('gitFileList');

    try {
      const res = await API.gitStatus(root);
      if (!res || !res.ok) {
        if (branchLabel) branchLabel.textContent = 'Not a git repository';
        if (statusBranchName) statusBranchName.textContent = '–';
        if (badge) badge.hidden = true;
        if (fileList) fileList.innerHTML = '<div style="padding:10px 4px;color:var(--text-dim);font-size:12px;">Not a git repo or git not found</div>';
        return;
      }

      const branch = res.branch || 'main';
      if (branchLabel) branchLabel.textContent = branch;
      if (statusBranchName) statusBranchName.textContent = branch;

      const files = res.files || [];
      if (badge) {
        if (files.length > 0) {
          badge.textContent = files.length > 99 ? '99+' : files.length;
          badge.hidden = false;
        } else {
          badge.hidden = true;
        }
      }

      if (fileList) {
        fileList.innerHTML = '';
        if (files.length === 0) {
          fileList.innerHTML = '<div style="padding:10px 4px;color:var(--text-dim);font-size:12px;">Working tree clean</div>';
          return;
        }

        const frag = document.createDocumentFragment();
        files.forEach((f) => {
          const item = document.createElement('div');
          item.className = 'git-file-item';
          item.dataset.path = f.path;

          const rawStatus = (f.status || 'M').charAt(0).toUpperCase();
          const badgeClass = ['M', 'A', 'D', 'R'].includes(rawStatus) ? rawStatus : 'Q';

          const badgeEl = document.createElement('span');
          badgeEl.className = `git-status-badge ${badgeClass}`;
          badgeEl.textContent = rawStatus === '?' ? 'U' : rawStatus;

          const nameEl = document.createElement('span');
          nameEl.style.overflow = 'hidden';
          nameEl.style.textOverflow = 'ellipsis';
          nameEl.style.whiteSpace = 'nowrap';
          nameEl.textContent = f.path;

          item.appendChild(badgeEl);
          item.appendChild(nameEl);

          item.addEventListener('click', async () => {
            await _onFileClick(f.path, root);
          });

          frag.appendChild(item);
        });
        fileList.appendChild(frag);
      }
    } catch (err) {
      console.error('Git status error:', err);
    }
  }

  async function loadLog() {
    const root = window.ExplorerModule?.getCurrentRoot() || '.';
    const logContainer = $('gitLog');
    if (!logContainer) return;

    try {
      const res = await API.gitLog(root, 15);
      if (!res || !res.ok) {
        logContainer.innerHTML = '<div style="padding:6px 0;color:var(--text-dim);font-size:11px;">No git commits found</div>';
        return;
      }

      const commits = res.commits || [];
      logContainer.innerHTML = '';
      if (commits.length === 0) {
        logContainer.innerHTML = '<div style="padding:6px 0;color:var(--text-dim);font-size:11px;">No commits yet</div>';
        return;
      }

      const frag = document.createDocumentFragment();
      commits.forEach((c) => {
        const item = document.createElement('div');
        item.className = 'git-commit-item';

        const msg = document.createElement('div');
        msg.className = 'git-commit-msg';
        msg.textContent = c.message;

        const meta = document.createElement('div');
        meta.className = 'git-commit-meta';

        const hash = document.createElement('span');
        hash.className = 'git-commit-hash';
        hash.textContent = c.hash;

        const time = document.createElement('span');
        time.className = 'git-commit-time';
        time.textContent = `${c.time} · ${c.author}`;

        meta.appendChild(hash);
        meta.appendChild(time);

        item.appendChild(msg);
        item.appendChild(meta);
        frag.appendChild(item);
      });
      logContainer.appendChild(frag);
    } catch (err) {
      console.error('Git log error:', err);
    }
  }

  async function commit() {
    const commitInput = $('gitCommitMsg');
    if (!commitInput) return;

    const msg = commitInput.value.trim();
    if (!msg) {
      if (window.UIModule?.showToast) {
        UIModule.showToast('Please enter a commit message');
      }
      commitInput.focus();
      return;
    }

    const root = window.ExplorerModule?.getCurrentRoot() || '.';

    try {
      const res = await API.gitCommit(msg, root, true);
      if (res && res.ok) {
        commitInput.value = '';
        if (window.UIModule?.showToast) {
          UIModule.showToast('Commit created successfully');
        }
        await refresh();
      } else {
        alert(res.error || res.detail || 'Commit failed');
      }
    } catch (err) {
      console.error('Commit error:', err);
      alert(`Commit error: ${err.message}`);
    }
  }

  async function _onFileClick(filePath, root) {
    if (!window.EditorModule) return;
    try {
      const fullPath = root === '.' ? filePath : `${root}/${filePath}`;
      const res = await API.getFile(fullPath);
      if (res && res.ok) {
        EditorModule.openFile(res.path, res.language, res.content);
      }
    } catch (err) {
      console.error('Error opening git file:', err);
    }
  }

  return {
    init,
    refresh,
    commit,
  };
})();

window.GitModule = GitModule;
