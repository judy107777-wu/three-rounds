// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderReview } from '../src/ui-review.js';
import { renderDetail } from '../src/ui-history.js';
import { requestReview } from '../src/ai-review.js';
import { loadSession } from '../src/session.js';
import { clearAll, getPractice, searchPractices } from '../src/storage.js';
import { ROUND1, ROUND2, ROUND3 } from './fixtures/transcripts.js';

const NOW = Date.UTC(2026, 7, 27, 21, 0, 0);

const REVIEW = {
  rescue: [
    { point: '手機放到另一個房間這個做法', reason: '第 3 遍只剩結論，少了他實際怎麼做' },
    { point: '前五天最痛苦這段', reason: '這是唯一有過程感的部分' },
  ],
  cut: ['我今天要講的重點是', '這個實驗最有意思的地方是'],
  newContent: ['備課時間從兩個小時掉到一個小時十五分'],
  conclusion: { isFirstSentence: false, note: '專注力其實是可以練的這句應該提到最前面' },
};

function spoken(transcript, seconds) {
  return { transcript, seconds, needsManualEntry: false };
}

function mount() {
  const div = document.createElement('div');
  document.body.appendChild(div);
  return div;
}

async function finishedSession() {
  const s = await loadSession({ now: NOW });
  await s.completeRound(spoken(ROUND1, 180));
  await s.completeRound(spoken(ROUND2, 130));
  await s.completeRound(spoken(ROUND3, 95));
  await s.finish('專注力那篇文章');
  return s;
}

beforeEach(async () => {
  await clearAll();
  document.body.replaceChildren();
});

describe('T14 AI 分析結果畫面與保存', () => {
  it('分析完成後四個區塊都出現', () => {
    const box = mount();
    box.appendChild(renderReview(REVIEW));
    const sections = box.querySelectorAll('.review-section');
    expect([...sections].map((s) => s.dataset.section)).toEqual([
      'rescue', 'cut', 'newContent', 'conclusion',
    ]);
    expect(box.textContent).toContain('該救回的');
    expect(box.textContent).toContain('該刪但還留著的');
    expect(box.textContent).toContain('新內容');
    expect(box.textContent).toContain('結論位置');
  });

  it('該救回的每一項都帶著理由', () => {
    const box = mount();
    box.appendChild(renderReview(REVIEW));
    const items = box.querySelectorAll('[data-section="rescue"] li');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('手機放到另一個房間');
    expect(items[0].textContent).toContain('第 3 遍只剩結論');
  });

  it('結論不在第一句時指出哪一句該提前', () => {
    const box = mount();
    box.appendChild(renderReview(REVIEW));
    const section = box.querySelector('[data-section="conclusion"]');
    expect(section.textContent).toContain('不是結論');
    expect(section.textContent).toContain('應該提到最前面');
  });

  it('結論已在第一句時直接說明', () => {
    const box = mount();
    box.appendChild(renderReview({ ...REVIEW, conclusion: { isFirstSentence: true, note: '' } }));
    expect(box.querySelector('[data-section="conclusion"]').textContent).toContain('就是結論');
  });

  it('某個區塊沒有內容時說明沒有，區塊仍然在', () => {
    const box = mount();
    box.appendChild(renderReview({ rescue: [], cut: [], newContent: [], conclusion: { isFirstSentence: true, note: '' } }));
    expect(box.querySelectorAll('.review-section')).toHaveLength(4);
    expect(box.querySelector('[data-section="rescue"]').textContent).toContain('沒有');
  });

  it('還沒做分析時說還沒做，不當掉', () => {
    const box = mount();
    box.appendChild(renderReview(null));
    expect(box.textContent).toContain('還沒做 AI 分析');
  });

  it('畫面上沒有分數、等第或鼓勵性評語', () => {
    const box = mount();
    box.appendChild(renderReview(REVIEW));
    for (const word of ['分數', '等第', '排名', '很棒', '加油', '做得好', '進步很多']) {
      expect(box.textContent, word).not.toContain(word);
    }
  });

  it('分析結果與該次練習一起存檔，重新進入還在', async () => {
    const session = await finishedSession();
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ candidates: [{ content: { parts: [{ text: JSON.stringify(REVIEW) }] } }] }),
      }),
    );

    const result = await requestReview({
      rounds: session.rounds,
      apiKey: 'KEY',
      fetch: fetchMock,
      online: true,
    });
    expect(result.ok).toBe(true);
    await session.attachReview(result.review);

    // 模擬關掉再從歷史紀錄進來
    const reopened = await getPractice(session.practice.id, { now: NOW });
    expect(reopened.review.rescue).toHaveLength(2);

    const box = mount();
    renderDetail(box, reopened);
    expect(box.querySelector('#detail-review').textContent).toContain('手機放到另一個房間');
    expect(box.querySelectorAll('.review-section')).toHaveLength(4);
  });

  it('分析內容不進入搜尋範圍', async () => {
    const session = await finishedSession();
    await session.attachReview(REVIEW);
    // 這句只出現在 AI 分析裡，逐字稿沒說過
    expect(await searchPractices('第 3 遍只剩結論', { now: NOW })).toEqual([]);
    expect(await searchPractices('應該提到最前面', { now: NOW })).toEqual([]);
    expect(await searchPractices('專注力', { now: NOW })).toHaveLength(1);
  });
});
