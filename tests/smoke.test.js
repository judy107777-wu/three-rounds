// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('T01 專案骨架', () => {
  it('測試環境跑得起來', () => {
    expect(1 + 1).toBe(2);
  });

  it('index.html 標題正確', () => {
    const html = readFileSync(resolve(root, 'index.html'), 'utf8');
    document.documentElement.innerHTML = html;
    expect(document.title).toBe('三遍練習');
  });

  it('index.html 具備四個畫面容器', () => {
    const html = readFileSync(resolve(root, 'index.html'), 'utf8');
    document.documentElement.innerHTML = html;
    for (const id of ['view-today', 'view-history', 'view-settings', 'view-detail']) {
      expect(document.getElementById(id), id).toBeTruthy();
    }
  });
});
