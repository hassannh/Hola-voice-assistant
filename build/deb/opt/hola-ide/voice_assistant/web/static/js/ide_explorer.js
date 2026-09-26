/**
 * ide_explorer.js — File Explorer tree rendering & navigation for Hola IDE
 * Antigravity tree view with collapsible folders and file opening
 */

const ExplorerModule = (() => {
  let _currentRoot = localStorage.getItem('hola_ide_root') || '.';
  const $ = (id) => document.getElementById(id);

  function _getFileIcon(name) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    const map = {
      py: '🐍',
      js: '⚡',
      ts: '🔷',
      html: '🌐',
      css: '🎨',
      json: '📋',
      md: '📝',
      sh: '💻',
      yml: '⚙️',
      yaml: '⚙️',
      txt: '📄',
      env: '🔒',
      git: '🌿',
    };
    return map[ext] || '📄';
  }

  function init() {
    const openFolderBtn = $('openFolderBtn');
    const welcomeOpenBtn = $('welcomeOpenBtn');
    const refreshTreeBtn = $('refreshTreeBtn');

    if (openFolderBtn) {
      openFolderBtn.addEventListener('click', promptOpenFolder);
    }
    if (welcomeOpenBtn) {
      welcomeOpenBtn.addEventListener('click', promptOpenFolder);
    }
    if (refreshTreeBtn) {
      refreshTreeBtn.addEventListener('click', () => loadTree(_currentRoot));
    }

    // Load initial tree
    loadTree(_currentRoot);
  }

  function promptOpenFolder() {
    const defaultVal = _currentRoot === '.' ? '/home/hassan/Desktop/personal-assistant' : _currentRoot;
    const folder = prompt('Enter absolute or relative folder path to open:', defaultVal);
    if (folder && folder.trim()) {
      loadTree(folder.trim());
    }
  }

  async function loadTree(rootPath) {
    const rootLabel = $('explorerRootName');
    const treeContainer = $('fileTree');
    if (!treeContainer) return;

    _currentRoot = rootPath || '.';
    localStorage.setItem('hola_ide_root', _currentRoot);

    if (rootLabel) {
      const parts = _currentRoot.replace(/\/+$/, '').split('/');
      rootLabel.textContent = parts[parts.length - 1] || _currentRoot;
      rootLabel.title = _currentRoot;
    }

    treeContainer.innerHTML = '<div style="padding:10px 14px;color:var(--text-dim);font-size:12px;">Loading directory…</div>';

    try {
      const res = await API.getTree(_currentRoot);
      if (res && res.ok && res.tree) {
        treeContainer.innerHTML = '';
        const frag = document.createDocumentFragment();
        if (res.tree.children && res.tree.children.length > 0) {
          res.tree.children.forEach((child) => {
            frag.appendChild(_renderTreeNode(child, 0));
          });
        } else {
          treeContainer.innerHTML = '<div style="padding:10px 14px;color:var(--text-dim);font-size:12px;">Folder is empty</div>';
          return;
        }
        treeContainer.appendChild(frag);
      } else {
        treeContainer.innerHTML = `<div style="padding:10px 14px;color:var(--red);font-size:12px;">Failed to load folder: ${res.detail || 'Not found'}</div>`;
      }
    } catch (err) {
      console.error('Tree load error:', err);
      treeContainer.innerHTML = `<div style="padding:10px 14px;color:var(--red);font-size:12px;">Error: ${err.message}</div>`;
    }
  }

  function _renderTreeNode(node, depth) {
    const wrap = document.createElement('div');
    wrap.className = 'tree-node-wrap';

    const row = document.createElement('div');
    row.className = `tree-node ${node.type === 'dir' ? 'is-dir' : ''}`;
    row.dataset.path = node.path;
    row.style.paddingLeft = `${depth * 14 + 10}px`;

    const icon = document.createElement('span');
    icon.className = 'tree-node-icon';
    if (node.type === 'dir') {
      icon.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
    } else {
      icon.textContent = _getFileIcon(node.name);
    }

    const name = document.createElement('span');
    name.className = 'tree-node-name';
    name.textContent = node.name;

    row.appendChild(icon);
    row.appendChild(name);
    wrap.appendChild(row);

    if (node.type === 'dir') {
      const childrenBox = document.createElement('div');
      childrenBox.className = 'tree-children';

      if (node.children && node.children.length > 0) {
        node.children.forEach((child) => {
          childrenBox.appendChild(_renderTreeNode(child, depth + 1));
        });
      }

      wrap.appendChild(childrenBox);

      row.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = childrenBox.classList.contains('open');
        if (isOpen) {
          childrenBox.classList.remove('open');
          row.classList.remove('expanded');
        } else {
          childrenBox.classList.add('open');
          row.classList.add('expanded');
        }
      });
    } else {
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        _openFileFromTree(node.path, row);
      });
    }

    return wrap;
  }

  async function _openFileFromTree(filePath, rowElement) {
    document.querySelectorAll('.tree-node.active').forEach((n) => n.classList.remove('active'));
    if (rowElement) rowElement.classList.add('active');

    try {
      const res = await API.getFile(filePath);
      if (res && res.ok) {
        if (window.EditorModule) {
          EditorModule.openFile(res.path, res.language, res.content);
        }
      } else {
        alert(res.detail || 'Could not open file');
      }
    } catch (err) {
      console.error('File open error:', err);
      alert(`Could not open file: ${err.message}`);
    }
  }

  return {
    init,
    loadTree,
    promptOpenFolder,
    getCurrentRoot: () => _currentRoot,
  };
})();

window.ExplorerModule = ExplorerModule;
