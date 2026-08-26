// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderToday } from '../src/ui-today.js';
import { loadSession } from '../src/session.js';
import { clearAll } from '../src/storage.js';
import { ROUND1, ROUND2, ROUND3 } from './fixtures/transcripts.js';

const NOW = Date.UTC(2026, 7, 27, 21, 0, 0);

function spoken(transcript, seconds) {
  return {
    transcript,
    seconds,
    audio: new TextEncoder().encode('audio').buffer,
    audioType: 'audio/webm',
    needsManualEntry: false,
  };
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

describe('T10 今日練習畫面', () => {
  it('開啟頁面不出現任何輸入框，直接看到錄音按鈕', async () => {
    const session = await loadSession({ now: NOW });
    const box = mount();
    renderToday(box, { session });

    expect(box.querySelector('input')).toBeNull();
    expect(box.querySelector('textarea')).toBeNull();
    const btn = box.querySelector('#record-btn');
    expect(btn).not.toBeNull();
    expect(btn.textContent).toBe('開始第 1 遍');
  });

  it('按下錄音按鈕會呼叫開始', async () => {
    const session = await loadSession({ now: NOW });
    const onStart = vi.fn();
    const box = mount();
    renderToday(box, { session }, { onStart });
    box.querySelector('#record-btn').click();
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('錄音中：按鈕變成停止，計時器往上數', async () => {
    const session = await loadSession({ now: NOW });
    const onStop = vi.fn();
    const box = mount();
    renderToday(box, { session, recording: true, elapsed: 95 }, { onStop });
    const btn = box.querySelector('#record-btn');
    expect(btn.textContent).toBe('停止');
    expect(btn.className).toContain('is-recording');
    expect(box.querySelector('#record-timer').textContent).toBe('1:35');
    btn.click();
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('一遍結束：逐字稿與數據出現在畫面上', async () => {
    const session = await loadSession({ now: NOW });
    await session.completeRound(spoken(ROUND3, 95));
    const box = mount();
    renderToday(box, { session });

    const card = box.querySelector('.round-card');
    expect(card).not.toBeNull();
    expect(card.querySelector('textarea').value).toBe(ROUND3);
    const metrics = card.querySelector('.metrics').textContent;
    expect(metrics).toContain('字數');
    expect(metrics).toContain('340');
    expect(metrics).toContain('贅詞密度');
    // 第 1 遍沒有前一遍，不顯示差距
    expect(card.querySelector('.delta')).toBeNull();
  });

  it('第 2 遍結束：同時出現與第 1 遍的差距', async () => {
    const session = await loadSession({ now: NOW });
    await session.completeRound(spoken(ROUND1, 180));
    await session.completeRound(spoken(ROUND2, 130));
    const box = mount();
    renderToday(box, { session });

    const cards = box.querySelectorAll('.round-card');
    expect(cards).toHaveLength(2);
    expect(cards[0].querySelector('.delta')).toBeNull();
    const deltas = cards[1].querySelectorAll('.delta');
    expect(deltas.length).toBe(5);
    const charDelta = cards[1].querySelector('.delta[data-field="charCount"]');
    expect(charDelta.textContent).toContain('+');
  });

  it('贅詞密度變好用苔綠、變差用淺褐，秒數字數保持中性', async () => {
    const session = await loadSession({ now: NOW });
    await session.completeRound(spoken('然後就是那個這個其實', 60));
    await session.completeRound(spoken('今天講的是專注力這件事情', 60));
    const box = mount();
    renderToday(box, { session });
    const second = box.querySelectorAll('.round-card')[1];
    expect(second.querySelector('.delta[data-field="fillerDensity"]').dataset.tone).toBe('good');
    expect(second.querySelector('.delta[data-field="seconds"]').dataset.tone).toBe('neutral');
    expect(second.querySelector('.delta[data-field="charCount"]').dataset.tone).toBe('neutral');
  });

  it('三遍未完成時不出現標題輸入', async () => {
    const session = await loadSession({ now: NOW });
    await session.completeRound(spoken(ROUND1, 180));
    await session.completeRound(spoken(ROUND2, 130));
    const box = mount();
    renderToday(box, { session });
    expect(box.querySelector('#title-form')).toBeNull();
    expect(box.querySelector('#title-input')).toBeNull();
    expect(box.querySelector('#record-btn')).not.toBeNull();
  });

  it('三遍完成：出現標題輸入且可存檔，錄音按鈕消失', async () => {
    const session = await loadSession({ now: NOW });
    await session.completeRound(spoken(ROUND1, 180));
    await session.completeRound(spoken(ROUND2, 130));
    await session.completeRound(spoken(ROUND3, 95));
    const onFinish = vi.fn();
    const box = mount();
    renderToday(box, { session }, { onFinish });

    expect(box.querySelector('#record-btn')).toBeNull();
    const input = box.querySelector('#title-input');
    expect(input).not.toBeNull();
    input.value = '專注力那篇文章';
    box.querySelector('#save-btn').click();
    expect(onFinish).toHaveBeenCalledWith('專注力那篇文章');
  });

  it('存檔之後出現 AI 檢查按鈕', async () => {
    const session = await loadSession({ now: NOW });
    await session.completeRound(spoken(ROUND1, 180));
    await session.completeRound(spoken(ROUND2, 130));
    await session.completeRound(spoken(ROUND3, 95));
    await session.finish('專注力那篇文章');
    const onReview = vi.fn();
    const box = mount();
    renderToday(box, { session }, { onReview });

    expect(box.textContent).toContain('專注力那篇文章');
    const btn = box.querySelector('#review-btn');
    expect(btn).not.toBeNull();
    btn.click();
    expect(onReview).toHaveBeenCalledTimes(1);
  });

  it('AI 檢查失敗時把原因顯示出來，資料還在', async () => {
    const session = await loadSession({ now: NOW });
    await session.completeRound(spoken(ROUND1, 180));
    await session.completeRound(spoken(ROUND2, 130));
    await session.completeRound(spoken(ROUND3, 95));
    await session.finish('主題');
    const box = mount();
    renderToday(box, { session, reviewError: '連不上 Gemini，稍後再試。' });
    expect(box.querySelector('#review-error').textContent).toContain('稍後再試');
    expect(box.querySelectorAll('.round-card')).toHaveLength(3);
  });

  it('麥克風出問題時把訊息顯示在錄音區', async () => {
    const session = await loadSession({ now: NOW });
    const box = mount();
    renderToday(box, { session, notice: '沒有麥克風權限。' });
    expect(box.querySelector('#record-notice').textContent).toContain('麥克風');
  });

  it('進度顯示現在是第幾遍', async () => {
    const session = await loadSession({ now: NOW });
    await session.completeRound(spoken(ROUND1, 180));
    const box = mount();
    renderToday(box, { session });
    expect(box.querySelector('#round-progress').textContent).toBe('第 2 遍 / 共 3 遍');
  });

  it('畫面上不出現分數、等第或連續天數', async () => {
    const session = await loadSession({ now: NOW });
    await session.completeRound(spoken(ROUND3, 95));
    const box = mount();
    renderToday(box, { session });
    for (const word of ['分數', '等第', '排名', '連續', '打卡', '徽章']) {
      expect(box.textContent, word).not.toContain(word);
    }
  });
});
