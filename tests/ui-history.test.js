// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHistory, renderDetail } from '../src/ui-history.js';
import {
  createPractice, savePractice, listPractices, searchPractices, getPractice, clearAll,
} from '../src/storage.js';
import { computeMetrics } from '../src/metrics.js';
import { ROUND1, ROUND2, ROUND3 } from './fixtures/transcripts.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 27, 21, 0, 0);

function roundOf(index, transcript, seconds) {
  return {
    index,
    seconds,
    transcript,
    needsManualEntry: false,
    audio: new TextEncoder().encode('a').buffer,
    audioType: 'audio/webm',
    audioPurged: false,
    metrics: computeMetrics(transcript, seconds),
  };
}

async function seed(id, title, createdAt, rounds) {
  const p = createPractice({ now: createdAt });
  p.id = id;
  p.title = title;
  p.createdAt = createdAt;
  p.status = 'done';
  p.rounds = rounds;
  await savePractice(p);
  return p;
}

function mount() {
  const div = document.createElement('div');
  document.body.appendChild(div);
  return div;
}

beforeEach(async () => {
  await clearAll();
  document.body.replaceChildren();
});

describe('T15 歷史紀錄與搜尋', () => {
  it('存入三筆，依日期由新到舊列出', async () => {
    await seed('a', '最舊的主題', NOW - 2 * DAY, [roundOf(1, '最舊的內容', 60)]);
    await seed('b', '今天的主題', NOW, [roundOf(1, '今天的內容', 60)]);
    await seed('c', '昨天的主題', NOW - DAY, [roundOf(1, '昨天的內容', 60)]);

    const box = mount();
    renderHistory(box, { practices: await listPractices({ now: NOW }) });
    const items = box.querySelectorAll('.history-item');
    expect([...items].map((i) => i.dataset.id)).toEqual(['b', 'c', 'a']);
    expect(items[0].textContent).toContain('今天的主題');
  });

  it('搜尋逐字稿中的詞找得到該筆', async () => {
    await seed('x', '無關的標題', NOW, [roundOf(1, '他把手機放到另一個房間', 90)]);
    await seed('y', '另一筆', NOW - DAY, [roundOf(1, '完全不同的內容', 90)]);

    const found = await searchPractices('另一個房間', { now: NOW });
    const box = mount();
    renderHistory(box, { practices: found, keyword: '另一個房間' });
    const items = box.querySelectorAll('.history-item');
    expect(items).toHaveLength(1);
    expect(items[0].dataset.id).toBe('x');
  });

  it('打字會把關鍵字交出去', async () => {
    const onSearch = vi.fn();
    const box = mount();
    renderHistory(box, { practices: [] }, { onSearch });
    const input = box.querySelector('#history-search');
    input.value = '專注力';
    input.dispatchEvent(new Event('input'));
    expect(onSearch).toHaveBeenCalledWith('專注力');
  });

  it('重畫清單不會把搜尋框整個換掉', async () => {
    const box = mount();
    renderHistory(box, { practices: [] });
    const first = box.querySelector('#history-search');
    renderHistory(box, { practices: await listPractices({ now: NOW }), keyword: '無' });
    expect(box.querySelector('#history-search')).toBe(first);
  });

  it('沒有結果時說沒有找到，沒有紀錄時說還沒有紀錄', () => {
    const box = mount();
    renderHistory(box, { practices: [], keyword: '找不到的詞' });
    expect(box.querySelector('.empty').textContent).toContain('沒有找到');
    document.body.replaceChildren();
    const box2 = mount();
    renderHistory(box2, { practices: [], keyword: '' });
    expect(box2.querySelector('.empty').textContent).toContain('還沒有任何練習紀錄');
  });

  it('點入某筆會把編號交出去', async () => {
    await seed('a', '主題', NOW, [roundOf(1, '內容', 60)]);
    const onOpen = vi.fn();
    const box = mount();
    renderHistory(box, { practices: await listPractices({ now: NOW }) }, { onOpen });
    box.querySelector('.history-item').click();
    expect(onOpen).toHaveBeenCalledWith('a');
  });

  it('點入某筆：三遍逐字稿與數據都顯示，且上下堆疊', async () => {
    await seed('a', '專注力那篇文章', NOW, [
      roundOf(1, ROUND1, 180),
      roundOf(2, ROUND2, 130),
      roundOf(3, ROUND3, 95),
    ]);
    const box = mount();
    renderDetail(box, await getPractice('a', { now: NOW }));

    const cards = box.querySelectorAll('.round-card');
    expect(cards).toHaveLength(3);
    expect(cards[0].querySelector('textarea').value).toBe(ROUND1);
    expect(cards[2].querySelector('textarea').value).toBe(ROUND3);
    for (const card of cards) {
      expect(card.querySelector('.metrics').textContent).toContain('贅詞密度');
    }
    expect(box.querySelector('#detail-rounds').className).toContain('round-stack');
    expect(box.textContent).toContain('專注力那篇文章');
  });

  it('第 2、3 遍顯示與前一遍的差距', async () => {
    await seed('a', '主題', NOW, [roundOf(1, ROUND1, 180), roundOf(2, ROUND2, 130), roundOf(3, ROUND3, 95)]);
    const box = mount();
    renderDetail(box, await getPractice('a', { now: NOW }));
    const cards = box.querySelectorAll('.round-card');
    expect(cards[0].querySelector('.delta')).toBeNull();
    expect(cards[1].querySelectorAll('.delta').length).toBe(5);
    expect(cards[2].querySelectorAll('.delta').length).toBe(5);
  });

  it('未完成的練習也列得出來，並標示未完成', async () => {
    const p = createPractice({ now: NOW });
    p.id = 'open';
    p.rounds = [roundOf(1, '講到一半', 60)];
    await savePractice(p);
    const box = mount();
    renderHistory(box, { practices: await listPractices({ now: NOW }) });
    expect(box.querySelector('.history-item').textContent).toContain('未完成');
  });

  it('釘選與刪除按鈕會把動作交出去', async () => {
    await seed('a', '主題', NOW, [roundOf(1, '內容', 60)]);
    const onTogglePin = vi.fn();
    const onDelete = vi.fn();
    const box = mount();
    renderDetail(box, await getPractice('a', { now: NOW }), { onTogglePin, onDelete });
    box.querySelector('#detail-pin').click();
    expect(onTogglePin).toHaveBeenCalledWith('a', true);
    box.querySelector('#detail-delete').click();
    expect(onDelete).toHaveBeenCalledWith('a');
  });

  it('沒有音檔的紀錄不出現釘選按鈕，因為釘選只保護音檔', async () => {
    // 第一版不錄音，這就是實際會存下來的樣子
    const p = createPractice({ now: NOW });
    p.id = 'noaudio';
    p.title = '主題';
    p.status = 'done';
    p.rounds = [{
      index: 1,
      seconds: 60,
      transcript: '沒有音檔的一遍',
      needsManualEntry: false,
      audio: null,
      audioType: null,
      audioPurged: false,
      metrics: computeMetrics('沒有音檔的一遍', 60),
    }];
    await savePractice(p);

    const box = mount();
    renderDetail(box, await getPractice('noaudio', { now: NOW }));
    expect(box.querySelector('#detail-pin')).toBeNull();
    expect(box.querySelector('#detail-delete')).not.toBeNull();
    expect(box.querySelector('[data-role="export-audio"]')).toBeNull();
    // 逐字稿與數據照常顯示
    expect(box.querySelector('textarea').value).toBe('沒有音檔的一遍');
    expect(box.querySelector('.metrics').textContent).toContain('贅詞密度');
  });

  it('回到歷史紀錄的按鈕會把動作交出去', async () => {
    await seed('a', '主題', NOW, [roundOf(1, '內容', 60)]);
    const onBack = vi.fn();
    const box = mount();
    renderDetail(box, await getPractice('a', { now: NOW }), { onBack });
    box.querySelector('#detail-back').click();
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('找不到那筆時不當掉', () => {
    const box = mount();
    renderDetail(box, null);
    expect(box.textContent).toContain('找不到');
  });
});
