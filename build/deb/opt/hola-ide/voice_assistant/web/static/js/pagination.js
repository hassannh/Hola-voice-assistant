/**
 * pagination.js — Generic client-side paginator
 * Exposes: Paginator (class, global)
 *
 * Usage:
 *   const pg = new Paginator({ items: [], pageSize: 5,
 *     containerEl: '#toolsList', paginationEl: '#toolsPagination',
 *     renderItem: (item) => '<div>...</div>' });
 *   pg.setItems(newItems);
 */
class Paginator {
  /**
   * @param {object} opts
   * @param {HTMLElement|string} opts.containerEl  - where items render
   * @param {HTMLElement|string} opts.paginationEl - where page buttons render
   * @param {function}           opts.renderItem   - (item) => HTML string
   * @param {number}             [opts.pageSize=6]
   * @param {Array}              [opts.items=[]]
   */
  constructor({ containerEl, paginationEl, renderItem, pageSize = 6, items = [] }) {
    this._container  = typeof containerEl  === "string" ? document.querySelector(containerEl)  : containerEl;
    this._pagination = typeof paginationEl === "string" ? document.querySelector(paginationEl) : paginationEl;
    this._renderItem = renderItem;
    this._pageSize   = pageSize;
    this._page       = 1;
    this._items      = [];
    if (items.length) this.setItems(items);
  }

  get totalPages() {
    return Math.max(1, Math.ceil(this._items.length / this._pageSize));
  }

  setItems(items) {
    this._items = items || [];
    this._page  = 1;
    this._render();
  }

  goTo(page) {
    this._page = Math.max(1, Math.min(page, this.totalPages));
    this._render();
  }

  _render() {
    if (!this._container) return;

    const start = (this._page - 1) * this._pageSize;
    const slice = this._items.slice(start, start + this._pageSize);

    if (this._items.length === 0) {
      this._container.innerHTML = '<p class="hint-text empty-hint">Nothing here yet.</p>';
    } else {
      this._container.innerHTML = slice.map(this._renderItem).join("");
    }

    this._renderPagination();
  }

  _renderPagination() {
    if (!this._pagination) return;
    const total = this.totalPages;

    if (total <= 1) {
      this._pagination.innerHTML = "";
      return;
    }

    let html = `<div class="pg-row">`;

    // Prev
    html += `<button class="pg-btn${this._page === 1 ? " disabled" : ""}" data-page="${this._page - 1}" aria-label="Previous page" ${this._page === 1 ? "disabled" : ""}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
    </button>`;

    // Pages (compact window: show max 5 page numbers)
    const window = 2;
    for (let p = 1; p <= total; p++) {
      if (p === 1 || p === total || Math.abs(p - this._page) <= window) {
        html += `<button class="pg-btn${p === this._page ? " active" : ""}" data-page="${p}" aria-label="Page ${p}" aria-current="${p === this._page ? "page" : "false"}">${p}</button>`;
      } else if (Math.abs(p - this._page) === window + 1) {
        html += `<span class="pg-ellipsis">…</span>`;
      }
    }

    // Next
    html += `<button class="pg-btn${this._page === total ? " disabled" : ""}" data-page="${this._page + 1}" aria-label="Next page" ${this._page === total ? "disabled" : ""}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
    </button>`;

    html += `<span class="pg-label">${this._page} / ${total}</span></div>`;
    this._pagination.innerHTML = html;

    this._pagination.querySelectorAll(".pg-btn:not(.disabled)").forEach((btn) => {
      btn.addEventListener("click", () => this.goTo(Number(btn.dataset.page)));
    });
  }
}
