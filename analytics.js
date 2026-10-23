// Shared GA4 measurement for DONGZE and Paperbag Crew.
// Automated QA and explicit ?analytics=off visits do not send analytics.
(() => {
  'use strict';
  function startMeasurement() {
  const params = new URLSearchParams(location.search);
  if (navigator.webdriver || params.get('analytics') === 'off' ||
      !['dongze.win', 'www.dongze.win', 'paperbagcrew.com', 'www.paperbagcrew.com'].includes(location.hostname)) return;
  const measurementId = 'G-7XNY9JBP6C';
  const siteName = location.hostname.includes('paperbagcrew') ? 'Paperbag Crew' : 'DONGZE';
  const language = () => params.get('lang') === 'en' || document.documentElement.lang.startsWith('en') ? 'en' : 'zh-Hant';
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', measurementId, { site_name: siteName, content_language: language() });
  const tag = document.createElement('script');
  tag.async = true;
  tag.src = 'https://www.googletagmanager.com/gtag/js?id=' + measurementId;
  document.head.appendChild(tag);
  document.addEventListener('click', event => {
    const link = event.target.closest && event.target.closest('a[href]');
    if (!link) return;
    const target = new URL(link.href, location.href);
    let eventName;
    const detail = { site_name: siteName, content_language: document.documentElement.lang || language(), transport_type: 'beacon' };
    if (target.hostname === 'line.me' && target.pathname.startsWith('/S/sticker/')) {
      eventName = 'sticker_store_click';
      detail.sticker_id = target.pathname.split('/').filter(Boolean).pop();
    } else if (target.hostname === 'paypal.com' || target.hostname.endsWith('.paypal.com')) {
      eventName = 'support_click';
    } else if (target.hostname === 'dongze.win' && target.hash === '#line-stickers') {
      eventName = 'sticker_preview_click';
    }
    if (eventName) window.gtag('event', eventName, detail);
  });
  }
  if (document.readyState === 'complete') startMeasurement();
  else document.addEventListener('DOMContentLoaded', startMeasurement, { once: true });
})();
