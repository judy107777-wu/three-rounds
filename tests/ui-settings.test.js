// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getApiKey, setApiKey, clearApiKey, hasApiKey, renderSettings,
} from '../src/ui-settings.js';

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
