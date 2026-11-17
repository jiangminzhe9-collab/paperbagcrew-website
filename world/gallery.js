(() => {
  'use strict';
  const box = document.querySelector('#gallery');
  const triggers = [...document.querySelectorAll('[data-preview]')];
  if (!box || !triggers.length) return;
  const image = box.querySelector('img');
  const close = box.querySelector('[data-close]');
  const previous = box.querySelector('[data-previous]');
  const next = box.querySelector('[data-next]');
  const caption = box.querySelector('figcaption');
  const status = box.querySelector('[data-status]');
  const position = box.querySelector('[data-position]');
  const controls = box.querySelector('.gallery-controls');
  let active = 0, lastFocus, overflow = '', request = 0;
  function show(index) {
    active = index;
    const trigger = triggers[index], ticket = ++request;
    const title = trigger.querySelector('img')?.alt || 'Artwork preview';
    caption.textContent = image.alt = title;
    position.textContent = `${index + 1} of ${triggers.length}`;
    controls.hidden = triggers.length < 2;
    previous.disabled = index === 0; next.disabled = index === triggers.length - 1;
    image.hidden = true; status.hidden = false; status.textContent = 'Loading preview…';
    box.setAttribute('aria-busy', 'true');
    image.onload = () => { if (ticket !== request || !box.open) return; image.hidden = false; status.hidden = true; box.setAttribute('aria-busy', 'false'); };
    image.onerror = () => { if (ticket !== request || !box.open) return; image.hidden = true; status.textContent = 'This preview could not load. Close it and try again, or choose another image.'; box.setAttribute('aria-busy', 'false'); };
    image.src = trigger.dataset.preview;
  }
  function move(step) {
    if (active + step < 0 || active + step >= triggers.length) return;
    const focus = document.activeElement; show(active + step);
    if (focus === next && next.disabled) previous.focus();
    if (focus === previous && previous.disabled) next.focus();
  }
  triggers.forEach((trigger,index) => {
    trigger.setAttribute('aria-haspopup','dialog'); trigger.setAttribute('aria-controls','gallery');
    trigger.addEventListener('click', () => { if (box.open) return; lastFocus = trigger; overflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; box.showModal(); show(index); close.focus(); });
  });
  previous.addEventListener('click', () => move(-1)); next.addEventListener('click', () => move(1));
  close.addEventListener('click', () => box.close());
  box.addEventListener('click', event => { if (event.target === box) box.close(); });
  box.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); move(event.key === 'ArrowLeft' ? -1 : 1); }
    if (event.key === 'Tab') {
      const focusable = [close, previous, next].filter(b => !b.disabled && (b === close || !controls.hidden));
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  box.addEventListener('close', () => { ++request; image.onload = image.onerror = null; image.removeAttribute('src'); image.hidden = true; document.body.style.overflow = overflow; lastFocus?.focus(); });
})();
