// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getApiKey, setApiKey, clearApiKey, hasApiKey, renderSettings, hardRefresh, currentCacheName,
} from '../src/ui-settings.js';
import { GEMINI_MODEL } from '../src/ai-review.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function mount() {
  const div = document.createElement('div');
  document.body.appendChild(div);
  return div;
}

beforeEach(() => {
  localStorage.clear();
  document.body.replaceChildren();
});

describe('T12 設定頁與金鑰保存', () => {
  it('輸入金鑰後重新載入，金鑰還在', () => {
    const box = mount();
    renderSettings(box);
    box.querySelector('#settings-api-key').value = 'TEST-KEY-1234';
    box.querySelector('#settings-save').click();

    // 模擬重新載入：重新畫一次設定頁
    const box2 = mount();
    renderSettings(box2);
    expect(box2.querySelector('#settings-api-key').value).toBe('TEST-KEY-1234');
    expect(getApiKey()).toBe('TEST-KEY-1234');
  });

  it('金鑰存在本機儲存，不放在網址或程式裡', () => {
    setApiKey('ABC123');
    expect(localStorage.getItem('stt.gemini-key')).toBe('ABC123');
  });

  it('前後空白會被去掉', () => {
    setApiKey('  KEY-WITH-SPACES  ');
    expect(getApiKey()).toBe('KEY-WITH-SPACES');
  });

  it('沒有金鑰時 hasApiKey 為 false', () => {
    expect(hasApiKey()).toBe(false);
    setApiKey('   ');
    expect(hasApiKey()).toBe(false);
    setApiKey('K');
    expect(hasApiKey()).toBe(true);
  });

  it('清除金鑰之後讀不到', () => {
    setApiKey('K');
    clearApiKey();
    expect(getApiKey()).toBe('');
    expect(localStorage.getItem('stt.gemini-key')).toBeNull();
  });

  it('設定頁的清除按鈕會把輸入框也清空', () => {
    setApiKey('K');
    const box = mount();
    renderSettings(box);
    box.querySelector('#settings-clear').click();
    expect(box.querySelector('#settings-api-key').value).toBe('');
    expect(getApiKey()).toBe('');
  });

  it('金鑰輸入框不是明碼顯示', () => {
    const box = mount();
    renderSettings(box);
    expect(box.querySelector('#settings-api-key').type).toBe('password');
  });

  it('設定頁有匯出入口，按下會呼叫匯出', () => {
    const onExport = vi.fn();
    const box = mount();
    renderSettings(box, { onExport });
    box.querySelector('#settings-export').click();
    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it('設定頁可以直接測金鑰，成功時顯示結果', async () => {
    const onTest = vi.fn(() => Promise.resolve({ ok: true, message: '金鑰可以用（gemini-2.5-flash）' }));
    const box = mount();
    renderSettings(box, { onTest });
    box.querySelector('#settings-api-key').value = 'KEY';
    box.querySelector('#settings-test').click();
    await new Promise((r) => setTimeout(r, 0));
    expect(onTest).toHaveBeenCalledWith('KEY');
    const result = box.querySelector('#settings-test-result');
    expect(result.textContent).toContain('可以用');
    expect(result.className).toBe('hint');
  });

  it('測金鑰失敗時用醒目的樣式顯示原因', async () => {
    const onTest = vi.fn(() => Promise.resolve({ ok: false, message: '金鑰被拒絕了（HTTP 400｜API key not valid）' }));
    const box = mount();
    renderSettings(box, { onTest });
    box.querySelector('#settings-api-key').value = 'BAD';
    box.querySelector('#settings-test').click();
    await new Promise((r) => setTimeout(r, 0));
    const result = box.querySelector('#settings-test-result');
    expect(result.textContent).toContain('API key not valid');
    expect(result.className).toBe('notice');
  });

  it('輸入框空白時測的是已經存起來的那把金鑰', async () => {
    setApiKey('SAVED-KEY');
    const onTest = vi.fn(() => Promise.resolve({ ok: true, message: 'ok' }));
    const box = mount();
    renderSettings(box, { onTest });
    box.querySelector('#settings-api-key').value = '';
    box.querySelector('#settings-test').click();
    await new Promise((r) => setTimeout(r, 0));
    expect(onTest).toHaveBeenCalledWith('SAVED-KEY');
  });

  it('設定頁把現在跑的模型顯示出來，改版有沒有生效一眼就看得到', () => {
    const box = mount();
    renderSettings(box, { readCacheName: () => Promise.resolve('three-rounds-v6') });
    expect(box.querySelector('#settings-model').textContent).toContain(GEMINI_MODEL);
  });

  it('設定頁顯示實際生效的離線快取版本', async () => {
    const box = mount();
    renderSettings(box, { readCacheName: () => Promise.resolve('three-rounds-v6') });
    await new Promise((r) => setTimeout(r, 0));
    expect(box.querySelector('#settings-cache').textContent).toContain('three-rounds-v6');
  });

  it('強制更新會註銷 service worker、清掉快取，然後重新載入', async () => {
    const unregister = vi.fn(() => Promise.resolve(true));
    const del = vi.fn(() => Promise.resolve(true));
    const reload = vi.fn();
    await hardRefresh({
      serviceWorker: { getRegistrations: () => Promise.resolve([{ unregister }, { unregister }]) },
      cacheStorage: { keys: () => Promise.resolve(['three-rounds-v5', 'three-rounds-v4']), delete: del },
      reload,
    });
    expect(unregister).toHaveBeenCalledTimes(2);
    expect(del).toHaveBeenCalledTimes(2);
    expect(del).toHaveBeenCalledWith('three-rounds-v5');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('強制更新不會碰到練習紀錄，也不會清掉金鑰', async () => {
    setApiKey('KEEP-ME');
    const reload = vi.fn();
    await hardRefresh({
      serviceWorker: { getRegistrations: () => Promise.resolve([]) },
      cacheStorage: { keys: () => Promise.resolve([]), delete: vi.fn() },
      reload,
    });
    expect(getApiKey()).toBe('KEEP-ME');
    expect(reload).toHaveBeenCalled();
  });

  it('沒有 service worker 或快取時，強制更新照樣重新載入不報錯', async () => {
    const reload = vi.fn();
    await hardRefresh({ serviceWorker: undefined, cacheStorage: undefined, reload });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('設定頁的強制更新按鈕會被呼叫', () => {
    const onHardRefresh = vi.fn();
    const box = mount();
    renderSettings(box, { onHardRefresh, readCacheName: () => Promise.resolve('x') });
    box.querySelector('#settings-refresh').click();
    expect(onHardRefresh).toHaveBeenCalledTimes(1);
  });

  it('讀不到快取名稱時不炸掉', async () => {
    expect(await currentCacheName({ keys: () => Promise.reject(new Error('nope')) })).toBe('（讀不到）');
    expect(await currentCacheName({ keys: () => Promise.resolve([]) })).toContain('沒有');
  });

  it('金鑰不出現在原始碼中', () => {
    const files = readdirSync(resolve(root, 'src')).filter((f) => f.endsWith('.js'));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const text = readFileSync(resolve(root, 'src', f), 'utf8');
      // Google API 金鑰的格式
      expect(text, f).not.toMatch(/AIza[0-9A-Za-z_-]{20,}/);
      expect(text, f).not.toMatch(/apiKey\s*=\s*['"][A-Za-z0-9_-]{20,}['"]/);
    }
  });
});
