// @vitest-environment jsdom

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let css = '';

beforeAll(() => {
  css = readFileSync(resolve(root, 'src/styles.css'), 'utf8');
});

/** 取出 :root 裡某個變數的值 */
function token(name) {
  const m = css.match(new RegExp(`${name}\\s*:\\s*([^;]+);`));
  return m ? m[1].trim() : null;
}

/** 取出某個選擇器的區塊 */
function rule(selector) {
  const m = css.match(new RegExp(`(^|\\n)${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`));
  return m ? m[2] : null;
}

describe('T02 設計樣式基底', () => {
  it('色票與架構文件 3.4 一致', () => {
    expect(token('--bg')).toBe('#FAF6F0');
    expect(token('--card')).toBe('#FFFFFF');
    expect(token('--primary')).toBe('#8B6F52');
    expect(token('--secondary')).toBe('#D9C7B4');
    expect(token('--accent')).toBe('#C1654F');
    expect(token('--text')).toBe('#3D3630');
    expect(token('--text-sub')).toBe('#8A7F73');
    expect(token('--good')).toBe('#5F7A52');
    expect(token('--bad')).toBe('#B08968');
  });

  it('退步用淺褐，不用紅色', () => {
    expect(token('--bad').toLowerCase()).not.toBe('#ff0000');
    expect(token('--bad').toLowerCase()).not.toContain('red');
  });

  it('頁面背景是米白', () => {
    expect(rule('body')).toContain('background: var(--bg)');
  });

  it('主要按鈕用主色', () => {
    const primaryBtn = rule('.btn-primary');
    expect(primaryBtn).toContain('background: var(--primary)');
    expect(primaryBtn).toContain('color: var(--card)');
  });

  it('卡片是白底、圓角 12px', () => {
    expect(token('--radius')).toBe('12px');
    const card = rule('.card');
    expect(card).toContain('background: var(--card)');
    expect(card).toContain('border-radius: var(--radius)');
  });

  it('逐字稿框撐滿容器，不用瀏覽器預設寬度', () => {
    // 沒有 width 的 textarea 一行只放得下 11 個字
    expect(rule('.transcript')).toContain('width: 100%');
  });

  it('窄螢幕把邊界縮小，讓逐字稿一行放得下 18 個字', () => {
    expect(css).toContain('@media (max-width: 430px)');
  });

  it('逐字稿行高放寬到 1.8', () => {
    expect(token('--line-height-read')).toBe('1.8');
    expect(rule('.transcript')).toContain('line-height: var(--line-height-read)');
  });

  it('數字用等寬字體，方便三遍上下對齊比較', () => {
    expect(token('--font-mono')).toContain('mono');
    for (const sel of ['.metric-value', '.timer', '.delta']) {
      expect(rule(sel), sel).toContain('font-family: var(--font-mono)');
    }
  });

  it('全部使用系統內建字體，不載入外部字型檔', () => {
    expect(css).not.toContain('@import');
    expect(css).not.toContain('@font-face');
    expect(css).not.toContain('fonts.googleapis.com');
  });

  it('進步苔綠、退步淺褐、其餘灰褐', () => {
    expect(rule('.delta.tone-good')).toContain('var(--good)');
    expect(rule('.delta.tone-bad')).toContain('var(--bad)');
    expect(rule('.delta.tone-neutral')).toContain('var(--text-sub)');
  });

  it('錄音按鈕夠大且放低，單手拇指可及', () => {
    const record = rule('.btn-record');
    expect(parseInt(record.match(/width:\s*(\d+)px/)[1], 10)).toBeGreaterThanOrEqual(120);
    // 吃掉剩下的高度並置中，落在畫面下半部的中間
    const area = rule('.record-area');
    expect(area).toContain('flex: 1 0 auto');
    expect(area).toContain('justify-content: center');
    expect(css).toContain('#view-today:not([hidden])');
  });

  it('今日畫面該隱藏的時候還是要隱藏', () => {
    // id 選擇器優先度比 .view[hidden] 高，所以必須用 :not([hidden]) 寫
    expect(css).not.toMatch(/#view-today\s*\{/);
  });

  it('三遍比對是上下堆疊，不是左右並排', () => {
    expect(rule('.round-stack')).toContain('flex-direction: column');
  });

  it('不做動畫特效', () => {
    expect(css).not.toContain('@keyframes');
    expect(css).not.toMatch(/\banimation\s*:/);
    expect(css).not.toMatch(/\btransition\s*:/);
  });

  it('樣式表可以掛進頁面而不出錯', () => {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    expect(document.styleSheets.length).toBeGreaterThan(0);
    style.remove();
  });
});
