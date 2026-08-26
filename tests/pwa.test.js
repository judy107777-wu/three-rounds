import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.webmanifest'), 'utf8'));
const sw = readFileSync(resolve(root, 'sw.js'), 'utf8');
const html = readFileSync(resolve(root, 'index.html'), 'utf8');

/** 從 PNG 檔頭讀出寬高 */
function pngSize(file) {
  const buf = readFileSync(file);
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < signature.length; i += 1) {
    if (buf[i] !== signature[i]) throw new Error(`${file} 不是 PNG`);
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe('T17 桌面圖示與離線', () => {
  it('設定檔含名稱、圖示、啟動網址、全螢幕顯示', () => {
    expect(manifest.name).toBe('三遍練習');
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBe('./');
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
  });

  it('圖示檔真的存在，尺寸與設定一致', () => {
    for (const icon of manifest.icons) {
      const file = resolve(root, icon.src);
      expect(statSync(file).isFile(), icon.src).toBe(true);
      const { width, height } = pngSize(file);
      expect(`${width}x${height}`, icon.src).toBe(icon.sizes);
      expect(icon.type).toBe('image/png');
    }
  });

  it('有一張 maskable 圖示，Android 桌面才不會被切掉邊', () => {
    expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true);
  });

  it('底色用米白，與畫面一致', () => {
    expect(manifest.background_color).toBe('#FAF6F0');
    expect(manifest.theme_color).toBe('#FAF6F0');
  });

  it('頁面有掛上設定檔與圖示', () => {
    expect(html).toContain('rel="manifest"');
    expect(html).toContain('manifest.webmanifest');
    expect(html).toContain('apple-touch-icon');
  });

  it('離線快取涵蓋全部程式檔，少一個都不行', () => {
    const files = readdirSync(resolve(root, 'src')).filter((f) => f.endsWith('.js') || f.endsWith('.css'));
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      expect(sw, f).toContain(`src/${f}`);
    }
    expect(sw).toContain('index.html');
    expect(sw).toContain('manifest.webmanifest');
  });

  it('不快取外部服務，AI 檢查一律走網路', () => {
    expect(sw).not.toContain('generativelanguage');
    expect(sw).toContain('url.origin !== self.location.origin');
  });

  it('只快取 GET，不動寫入類的請求', () => {
    expect(sw).toContain("request.method !== 'GET'");
  });

  it('改版時會清掉舊快取', () => {
    expect(sw).toContain('caches.delete');
    expect(sw).toMatch(/CACHE_NAME\s*=\s*'[^']+'/);
  });

  it('先走網路再用快取，改好的版本才送得到手機上', () => {
    expect(sw).toContain('networkFirst');
    // 網路失敗才回頭找快取
    const fn = sw.slice(sw.indexOf('async function networkFirst'));
    expect(fn.indexOf('await fetch(request)')).toBeLessThan(fn.indexOf('caches.match(request)'));
  });

  it('主程式會註冊離線快取', () => {
    const app = readFileSync(resolve(root, 'src/app.js'), 'utf8');
    expect(app).toContain('serviceWorker');
    expect(app).toContain("register('sw.js')");
    // start() 是非同步的，load 可能早就發生過，不能只靠 load 事件
    expect(app).toContain("document.readyState === 'complete'");
  });
});
