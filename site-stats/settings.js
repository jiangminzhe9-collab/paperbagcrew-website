(() => {
  'use strict';
  const prefs = window.siteAnalyticsPreferences;
  const english = document.documentElement.lang === 'en';
  const status = document.getElementById('browser-status');
  const detail = document.getElementById('browser-detail');
  const saveNote = document.getElementById('save-note');
  function render() {
    if (!prefs) {
      status.textContent = english ? 'Setting could not be loaded' : '設定尚未載入';
      detail.textContent = english ? 'Reload this page before changing the setting.' : '請重新整理此頁後再操作。';
      return;
    }
    status.textContent = prefs.excluded
      ? (english ? 'Your browsing is excluded' : '已排除此瀏覽器的瀏覽')
      : prefs.automatic
        ? (english ? 'Excluded by a browser privacy or QA setting' : '已依瀏覽器隱私或測試設定排除')
        : (english ? 'Your browsing is currently included' : '此瀏覽器目前會計入統計');
    detail.textContent = prefs.excluded
      ? (english ? 'Visits on this website will not be sent to Google Analytics from this browser.' : '使用這個瀏覽器瀏覽本站時，不會將瀏覽資料傳送至 Google Analytics。')
      : (english ? 'Use the button below on your own devices to exclude testing and routine edits.' : '請在自己常用的裝置按下排除按鈕，避免測試與例行查看影響訪客數。');
    saveNote.textContent = !prefs.saved
      ? (english ? 'This browser could not save the preference. Exclusion applies to this page only; allow site storage and try again.' : '瀏覽器無法儲存設定，目前只保證此頁排除；請允許網站儲存資料後重試。')
      : (english ? 'Applies to this browser and website. Repeat on each device, browser and website. Clearing website data resets this preference.' : '設定只適用於這個瀏覽器與網站。每台裝置、不同瀏覽器與不同網站都需各設定一次；清除網站資料後需重設。');
  }
  document.getElementById('exclude').addEventListener('click', () => { prefs?.setExcluded(true); render(); });
  document.getElementById('restore').addEventListener('click', () => { prefs?.setExcluded(false); render(); });
  window.addEventListener('storage', render);
  render();
})();
