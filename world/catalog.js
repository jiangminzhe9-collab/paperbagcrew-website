(() => {
  'use strict';
  const buttons = [...document.querySelectorAll('[data-filter]')];
  const cards = [...document.querySelectorAll('[data-category]')];
  const count = document.getElementById('catalog-count');
  if (!buttons.length || !count) return;
  const filters = new Set(buttons.map(b => b.dataset.filter));
  const current = () => { const value = new URL(location.href).searchParams.get('category'); return filters.has(value) ? value : 'all'; };
  function render(filter) {
    buttons.forEach(b => { b.disabled = false; b.setAttribute('aria-pressed', String(b.dataset.filter === filter)); });
    cards.forEach(c => { c.hidden = filter !== 'all' && c.dataset.category !== filter; });
    const total = cards.filter(c => !c.hidden).length;
    count.textContent = `${total} collection${total === 1 ? '' : 's'} · ${buttons.find(b => b.dataset.filter === filter).dataset.label}`;
  }
  buttons.forEach(button => button.addEventListener('click', () => {
    const filter = button.dataset.filter;
    if (filter !== current()) {
      const url = new URL(location.href);
      if (filter === 'all') url.searchParams.delete('category'); else url.searchParams.set('category', filter);
      history.pushState(null, '', url);
    }
    render(filter);
  }));
  addEventListener('popstate', () => render(current()));
  addEventListener('pageshow', () => render(current()));
  render(current());
})();
