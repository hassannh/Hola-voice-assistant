/**
 * ide_search.js — Workspace Code Search using ripgrep & grep fallbacks
 * Grouped file matches, syntax highlighting, and line jumping
 */

const SearchModule = (() => {
  let _debounceTimer = null;
  const $ = (id) => document.getElementById(id);

  function init() {
    const input = $('searchQueryInput');
    const caseCheck = $('searchCaseCheck');

    if (input) {
      input.addEventListener('input', () => {
        clearTimeout(_debounceTimer);
        _debounceTimer = setTimeout(() => {
          performSearch();
        }, 350);
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          clearTimeout(_debounceTimer);
          performSearch();
        }
      });
    }

    if (caseCheck) {
      caseCheck.addEventListener('change', () => {
        performSearch();
      });
    }
  }

  function _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function _highlightMatch(text, query, caseSensitive) {
    if (!query) return _escapeHtml(text);
    const flags = caseSensitive ? 'g' : 'gi';
    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escapedQuery})`, flags);
    return _escapeHtml(text).replace(regex, '<mark class="search-hl">$1</mark>');
  }

  async function performSearch() {
    const input = $('searchQueryInput');
    const caseCheck = $('searchCaseCheck');
    const resultsContainer = $('searchResults');
    if (!input || !resultsContainer) return;

    const query = input.value.trim();
    if (!query) {
      resultsContainer.innerHTML = '<div class="search-empty">Type to search workspace files…</div>';
      return;
    }

    resultsContainer.innerHTML = '<div class="search-empty">Searching…</div>';

    const root = window.ExplorerModule?.getCurrentRoot() || '.';
    const isCase = Boolean(caseCheck && caseCheck.checked);

    try {
      const res = await API.search(query, root, isCase);
      if (!res || !res.ok) {
        resultsContainer.innerHTML = `<div class="search-empty" style="color:var(--red);">Search error: ${res.detail || 'failed'}</div>`;
        return;
      }

      const matches = res.matches || [];
      if (matches.length === 0) {
        resultsContainer.innerHTML = `<div class="search-empty">No results found for "${_escapeHtml(query)}"</div>`;
        return;
      }

      // Group matches by file
      const byFile = {};
      matches.forEach((m) => {
        if (!byFile[m.file]) byFile[m.file] = [];
        byFile[m.file].push(m);
      });

      resultsContainer.innerHTML = '';
      const frag = document.createDocumentFragment();

      Object.keys(byFile).forEach((filePath) => {
        const fileMatches = byFile[filePath];
        const group = document.createElement('div');
        group.className = 'search-file-group';

        const fileHeader = document.createElement('div');
        fileHeader.className = 'search-file-name';
        const displayPath = filePath.replace(root + '/', '');
        fileHeader.innerHTML = `<strong>${_escapeHtml(displayPath)}</strong> <span style="color:var(--text-dim);font-size:11px;">(${fileMatches.length})</span>`;
        group.appendChild(fileHeader);

        fileMatches.forEach((m) => {
          const row = document.createElement('div');
          row.className = 'search-match';
          row.dataset.file = m.file;
          row.dataset.line = m.line;

          const lineNo = document.createElement('span');
          lineNo.className = 'search-match-line';
          lineNo.textContent = m.line;

          const matchText = document.createElement('span');
          matchText.className = 'search-match-text';
          matchText.innerHTML = _highlightMatch(m.text || '', query, isCase);

          row.appendChild(lineNo);
          row.appendChild(matchText);

          row.addEventListener('click', async () => {
            await _jumpToMatch(m.file, m.line);
          });

          group.appendChild(row);
        });

        frag.appendChild(group);
      });

      resultsContainer.appendChild(frag);
    } catch (err) {
      console.error('Search error:', err);
      resultsContainer.innerHTML = `<div class="search-empty" style="color:var(--red);">Search failed: ${err.message}</div>`;
    }
  }

  async function _jumpToMatch(filePath, lineNumber) {
    if (!window.EditorModule) return;

    // Check if already open
    const openTabs = EditorModule.getTabs();
    const existing = openTabs.find((t) => t.path === filePath);

    if (existing) {
      EditorModule.switchTab(filePath);
      EditorModule.revealLine(lineNumber);
    } else {
      try {
        const res = await API.getFile(filePath);
        if (res && res.ok) {
          EditorModule.openFile(res.path, res.language, res.content);
          setTimeout(() => {
            EditorModule.revealLine(lineNumber);
          }, 150);
        }
      } catch (err) {
        console.error('Jump error:', err);
      }
    }
  }

  return {
    init,
    performSearch,
  };
})();

window.SearchModule = SearchModule;
