// Browser-local owner/QA exclusion. Never identifies a visitor from an IP address.
(() => {
  'use strict';
  const key = 'dz_analytics_excluded';
  const measurementId = 'G-7XNY9JBP6C';
  const params = new URLSearchParams(location.search);
  const host = location.hostname;
  const domain = ['dongze.win', 'paperbagcrew.com', 'minzeh.com'].find(d => host === d || host === 'www.' + d);
  const cookieScope = '; Path=/; SameSite=Lax' + (location.protocol === 'https:' ? '; Secure' : '') + (domain ? '; Domain=' + domain : '');
  function read() {
    let local = false, cookie = false;
    try { local = localStorage.getItem(key) === '1'; } catch (_) {}
    try { cookie = document.cookie.split(';').some(p => p.trim() === key + '=1'); } catch (_) {}
    return local || cookie;
  }
  function save(value) {
    try { if (value) localStorage.setItem(key, '1'); else localStorage.removeItem(key); } catch (_) {}
    try {
      document.cookie = key + (value ? '=1; Max-Age=31536000' : '=; Max-Age=0') + cookieScope;
      // Remove any older host-only cookie when restoring measurement.
      if (!value) document.cookie = key + '=; Max-Age=0; Path=/; SameSite=Lax';
    } catch (_) {}
    return read() === value;
  }
  let excluded = read();
  let saved = true;
  if (params.get('analytics') === 'off' || params.get('analytics') === 'on') {
    excluded = params.get('analytics') === 'off';
    saved = save(excluded);
    // Fail closed if a stored exclusion could not be removed.
    if (!excluded && read()) excluded = true;
  }
  const automatic = !!(navigator.webdriver || navigator.globalPrivacyControl || navigator.doNotTrack === '1');
  const settingsPage = /^\/site-stats(?:\/|$|\.html)/.test(location.pathname || '');
  const api = {
    get excluded() { return excluded; },
    get saved() { return saved; },
    get automatic() { return automatic; },
    get blocked() { return excluded || automatic || settingsPage; },
    setExcluded(value) {
      excluded = value === true;
      saved = save(excluded);
      if (!excluded && read()) excluded = true;
      window['ga-disable-' + measurementId] = api.blocked;
      return { excluded, saved };
    }
  };
  window.siteAnalyticsPreferences = api;
  window['ga-disable-' + measurementId] = api.blocked;
  window.addEventListener('storage', event => {
    if (event.key !== key && event.key !== null) return;
    excluded = read();
    window['ga-disable-' + measurementId] = api.blocked;
  });
})();

// Shared GA4 measurement for DONGZE and Paperbag Crew.
// Owner exclusion is remembered on this browser; settings pages and QA send no events.
(() => {
  'use strict';
  function startMeasurement() {
  const params = new URLSearchParams(location.search);
  if (window.siteAnalyticsPreferences.blocked ||
      !['dongze.win', 'www.dongze.win', 'paperbagcrew.com', 'www.paperbagcrew.com'].includes(location.hostname)) return;
  const measurementId = 'G-7XNY9JBP6C';
  const siteName = location.hostname.includes('paperbagcrew') ? 'Paperbag Crew' : 'DONGZE';
  const language = () => params.get('lang') === 'en' || document.documentElement.lang.startsWith('en') ? 'en' : 'zh-Hant';
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  // Keep only a validated public referring origin; never credentials, path, query or fragment.
  let referrerOrigin = '';
  try {
    const referrer = new URL(document.referrer);
    if (['http:', 'https:'].includes(referrer.protocol) && !referrer.username && !referrer.password) referrerOrigin = referrer.origin;
  } catch (_) {}
  // Never forward query strings or auth fragments.
  window.gtag('config', measurementId, { site_name: siteName, content_language: language(), page_location: location.origin + location.pathname, page_referrer: referrerOrigin, allow_google_signals: false, allow_ad_personalization_signals: false });
  const tag = document.createElement('script');
  tag.async = true;
  tag.src = 'https://www.googletagmanager.com/gtag/js?id=' + measurementId;
  document.head.appendChild(tag);
  document.addEventListener('click', event => {
    if (window.siteAnalyticsPreferences.blocked) return;
    const link = event.target.closest && event.target.closest('a[href]');
    if (!link) return;
    const target = new URL(link.href, location.href);
    let eventName;
    const detail = { site_name: siteName, content_language: document.documentElement.lang || language(), transport_type: 'beacon' };
    const stickerMatch = target.hostname === 'line.me'
      ? target.pathname.match(/^\/S\/sticker\/(\d+)\/?$/)
      : target.hostname === 'store.line.me'
        ? target.pathname.match(/^\/stickershop\/product\/(\d+)(?:\/[A-Za-z-]+)?\/?$/)
        : null;
    if (stickerMatch) {
      eventName = 'sticker_store_click';
      detail.sticker_id = stickerMatch[1];
    } else if (target.hostname === 'dongze.win' && target.hash === '#line-stickers') {
      eventName = 'sticker_preview_click';
    }
    if (eventName) window.gtag('event', eventName, detail);
  });
  }
  if (document.readyState === 'complete') startMeasurement();
  else document.addEventListener('DOMContentLoaded', startMeasurement, { once: true });
})();


