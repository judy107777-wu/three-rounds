/**
 * 設定畫面
 * 負責：Gemini 金鑰的輸入與保存、匯出入口
 * 不負責：呼叫 Gemini、產生匯出檔內容
 *
 * 金鑰只存在這台裝置的瀏覽器裡，不會進原始碼、不會上傳。
 */

import { GEMINI_MODEL } from './ai-review.js';

const KEY_STORAGE = 'stt.gemini-key';

function store() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

export function getApiKey() {
  const s = store();
  if (!s) return '';
  return (s.getItem(KEY_STORAGE) || '').trim();
}

export function setApiKey(key) {
  const s = store();
  if (!s) return '';
  const value = (key || '').trim();
  if (value) s.setItem(KEY_STORAGE, value);
  else s.removeItem(KEY_STORAGE);
  return value;
}

export function clearApiKey() {
  const s = store();
  if (s) s.removeItem(KEY_STORAGE);
}

export function hasApiKey() {
  return getApiKey() !== '';
}

/**
 * 把離線快取與 service worker 全部清掉再重新載入。
 * 練習紀錄存在 IndexedDB，這裡完全不動它。
 * 相依項目可以注入，方便測試。
 */
export async function hardRefresh({
  serviceWorker = globalThis.navigator && globalThis.navigator.serviceWorker,
  cacheStorage = globalThis.caches,
  reload = () => globalThis.location.reload(),
} = {}) {
  try {
    if (serviceWorker && serviceWorker.getRegistrations) {
      const regs = await serviceWorker.getRegistrations();
      for (const reg of regs) await reg.unregister();
    }
  } catch {
    // 沒有就算了，重新載入本身就有機會拿到新版
  }
  try {
    if (cacheStorage && cacheStorage.keys) {
      const keys = await cacheStorage.keys();
      for (const key of keys) await cacheStorage.delete(key);
    }
  } catch {
    // 同上
  }
  reload();
}

/** 現在實際生效的快取版本。顯示真實狀態，不是寫死的版號 */
export async function currentCacheName(cacheStorage = globalThis.caches) {
  try {
    const keys = await cacheStorage.keys();
    return keys[0] || '（沒有離線快取）';
  } catch {
    return '（讀不到）';
  }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/**
 * 畫出設定頁。
 * @param {HTMLElement} container
 * @param {{onSaved?:Function, onExport?:Function, onToast?:Function}} handlers
 */
export function renderSettings(container, handlers = {}) {
  container.replaceChildren();

  const card = el('div', 'card');
  card.appendChild(el('h2', 'card-title', 'Gemini 金鑰'));
  card.appendChild(
    el('p', 'hint', '只存在這台手機裡，不會上傳、不會進原始碼。沒有金鑰也能練習，只是不能做 AI 分析。'),
  );

  const label = el('label', 'field');
  label.appendChild(el('span', 'field-label', '金鑰'));
  const input = el('input', 'input');
  input.type = 'password';
  input.id = 'settings-api-key';
  input.autocomplete = 'off';
  input.placeholder = '貼上你的 Gemini API 金鑰';
  input.value = getApiKey();
  label.appendChild(input);
  card.appendChild(label);

  const saveBtn = el('button', 'btn btn-primary', '儲存金鑰');
  saveBtn.type = 'button';
  saveBtn.id = 'settings-save';
  saveBtn.addEventListener('click', () => {
    const saved = setApiKey(input.value);
    input.value = saved;
    handlers.onToast?.(saved ? '金鑰已存在這台裝置' : '已清除金鑰');
    handlers.onSaved?.(saved);
  });
  card.appendChild(saveBtn);

  // 先驗金鑰，不用等講完三遍才知道它是壞的
  const testBtn = el('button', 'btn', '測試金鑰');
  testBtn.type = 'button';
  testBtn.id = 'settings-test';
  const testResult = el('p', 'hint');
  testResult.id = 'settings-test-result';
  testBtn.addEventListener('click', async () => {
    if (!handlers.onTest) return;
    testBtn.disabled = true;
    testResult.className = 'hint';
    testResult.textContent = '測試中…';
    const result = await handlers.onTest(input.value.trim() || getApiKey());
    testBtn.disabled = false;
    testResult.className = result.ok ? 'hint' : 'notice';
    testResult.textContent = result.message;
  });
  card.appendChild(testBtn);
  card.appendChild(testResult);

  const clearBtn = el('button', 'btn-text', '清除金鑰');
  clearBtn.type = 'button';
  clearBtn.id = 'settings-clear';
  clearBtn.addEventListener('click', () => {
    clearApiKey();
    input.value = '';
    testResult.textContent = '';
    handlers.onToast?.('已清除金鑰');
    handlers.onSaved?.('');
  });
  card.appendChild(clearBtn);

  container.appendChild(card);

  // 版本資訊。改版之後手機常常還吃著舊檔案，
  // 這裡直接把「現在跑的是哪一版」攤開來，不用猜。
  const infoCard = el('div', 'card');
  infoCard.appendChild(el('h2', 'card-title', '版本'));
  const modelLine = el('p', 'hint', `目前模型：${GEMINI_MODEL}`);
  modelLine.id = 'settings-model';
  infoCard.appendChild(modelLine);

  const cacheLine = el('p', 'hint', '離線快取：讀取中…');
  cacheLine.id = 'settings-cache';
  infoCard.appendChild(cacheLine);
  (handlers.readCacheName || currentCacheName)().then((name) => {
    cacheLine.textContent = `離線快取：${name}`;
  });

  const refreshBtn = el('button', 'btn', '強制更新到最新版');
  refreshBtn.type = 'button';
  refreshBtn.id = 'settings-refresh';
  refreshBtn.addEventListener('click', () => (handlers.onHardRefresh || hardRefresh)());
  infoCard.appendChild(refreshBtn);
  infoCard.appendChild(el('p', 'hint', '清掉離線快取再重新載入。練習紀錄不會被清掉。'));
  container.appendChild(infoCard);

  const exportCard = el('div', 'card');
  exportCard.appendChild(el('h2', 'card-title', '匯出'));
  exportCard.appendChild(el('p', 'hint', '把全部練習紀錄存成一個檔案，自己收好。'));
  const exportBtn = el('button', 'btn', '匯出全部紀錄');
  exportBtn.type = 'button';
  exportBtn.id = 'settings-export';
  exportBtn.addEventListener('click', () => handlers.onExport?.());
  exportCard.appendChild(exportBtn);
  container.appendChild(exportCard);

  return container;
}
