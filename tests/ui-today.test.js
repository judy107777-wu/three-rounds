// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderToday, getNote, setNote, clearNote } from '../src/ui-today.js';
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
  localStorage.clear();
  document.body.replaceChildren();
});

describe('T10 今日練習畫面', () => {
  it('開啟頁面不要求輸入任何文字，直接看到錄音按鈕', async () => {
    const session = await loadSession({ now: NOW });
    const box = mount();
    renderToday(box, { session });

    // 沒有任何必填欄位：沒有標題輸入，也沒有逐字稿
    expect(box.querySelector('input')).toBeNull();
    expect(box.querySelector('#title-input')).toBeNull();
    expect(box.querySelector('[data-role="transcript"]')).toBeNull();

    // 重點整理是選填的筆記，預設空白，不填也能直接開始
    const note = box.querySelector('#quick-notes');
    expect(note).not.toBeNull();
    expect(note.value).toBe('');
    expect(note.required).toBe(false);

    const btn = box.querySelector('#record-btn');
    expect(btn).not.toBeNull();
    expect(btn.textContent).toBe('開始第 1 遍');
  });

  it('重點整理是五行的框，寫了會自己留著', async () => {
    const session = await loadSession({ now: NOW });
    const box = mount();
    renderToday(box, { session });
    const note = box.querySelector('#quick-notes');
    expect(note.rows).toBe(5);

    note.value = '一 那篇文章講什麼';
    note.dispatchEvent(new Event('input'));
    expect(getNote()).toContain('那篇文章講什麼');

    // 重畫（例如講完一遍）之後筆記還在
    document.body.replaceChildren();
    const box2 = mount();
    renderToday(box2, { session });
    expect(box2.querySelector('#quick-notes').value).toContain('那篇文章講什麼');
  });

  it('重點整理可以一鍵清空', async () => {
    setNote('先寫的東西');
    const session = await loadSession({ now: NOW });
    const box = mount();
    renderToday(box, { session });
    box.querySelector('#note-clear').click();
    expect(box.querySelector('#quick-notes').value).toBe('');
    expect(getNote()).toBe('');
  });

  it('重點整理不會進到練習紀錄裡', async () => {
    setNote('這是筆記不該被存起來');
    const session = await loadSession({ now: NOW });
    await session.completeRound(spoken(ROUND1, 180));
    expect(JSON.stringify(session.practice)).not.toContain('這是筆記不該被存起來');
    clearNote();
  });

  it('存檔之後不再顯示重點整理', async () => {
    setNote('講之前寫的');
    const session = await loadSession({ now: NOW });
    await session.completeRound(spoken(ROUND1, 180));
    await session.completeRound(spoken(ROUND2, 130));
    await session.completeRound(spoken(ROUND3, 95));
    await session.finish('主題');
    const box = mount();
    renderToday(box, { session });
    expect(box.querySelector('#quick-notes')).toBeNull();
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

  it('一遍結束：逐字稿出現在卡片，數據出現在對比表', async () => {
    const session = await loadSession({ now: NOW });
    await session.completeRound(spoken(ROUND3, 95));
    const box = mount();
    renderToday(box, { session });

    const card = box.querySelector('.round-card');
    expect(card).not.toBeNull();
    expect(card.querySelector('textarea').value).toBe(ROUND3);
    // 數據不再散在每一遍下方
    expect(card.querySelector('.metrics')).toBeNull();

    const table = box.querySelector('[data-role="metrics-table"]');
    expect(table).not.toBeNull();
    expect(table.textContent).toContain('字數');
    expect(table.textContent).toContain('340');
    expect(table.textContent).toContain('贅詞密度');
    // 只有一遍，沒有前一遍可比
    expect(table.querySelector('.delta')).toBeNull();
  });

  it('對比表每個指標一列，每一遍一欄', async () => {
    const session = await loadSession({ now: NOW });
    await session.completeRound(spoken(ROUND1, 180));
    await session.completeRound(spoken(ROUND2, 130));
    await session.completeRound(spoken(ROUND3, 95));
    const box = mount();
    renderToday(box, { session });

    const table = box.querySelector('.metrics-table');
    const headers = [...table.querySelectorAll('thead th')].map((th) => th.textContent);
    expect(headers).toEqual(['', '第 1 遍', '第 2 遍', '第 3 遍']);
    const rows = [...table.querySelectorAll('tbody tr')].map((tr) => tr.dataset.field);
    expect(rows).toEqual(['seconds', 'charCount', 'speed', 'fillerCount', 'fillerDensity']);
    // 每一列都有三欄數字
    expect(table.querySelector('tbody tr').querySelectorAll('td')).toHaveLength(3);
  });

  it('對比表放在第 3 遍與 AI 分析之間', async () => {
    const session = await loadSession({ now: NOW });
    await session.completeRound(spoken(ROUND1, 180));
    await session.completeRound(spoken(ROUND2, 130));
    await session.completeRound(spoken(ROUND3, 95));
    await session.finish('主題');
    const box = mount();
    renderToday(box, { session });

    const kids = [...box.children];
    const stackIndex = kids.findIndex((k) => k.classList.contains('round-stack'));
    const tableIndex = kids.findIndex((k) => k.dataset.role === 'metrics-table');
    const reviewIndex = kids.findIndex((k) => k.id === 'review-area');
    expect(tableIndex).toBeGreaterThan(stackIndex);
    expect(reviewIndex).toBeGreaterThan(tableIndex);
  });

  it('第 2 遍起在對比表裡顯示與前一遍的差距', async () => {
    const session = await loadSession({ now: NOW });
    await session.completeRound(spoken(ROUND1, 180));
    await session.completeRound(spoken(ROUND2, 130));
    const box = mount();
    renderToday(box, { session });

    const table = box.querySelector('.metrics-table');
    const row = table.querySelector('tbody tr[data-field="charCount"]');
    const cells = row.querySelectorAll('td');
    // 第 1 遍那欄沒有差距，第 2 遍那欄有
    expect(cells[0].querySelector('.delta')).toBeNull();
    expect(cells[1].querySelector('.delta').textContent).toContain('+');
  });

  it('贅詞密度變好用苔綠、變差用淺褐，秒數字數保持中性', async () => {
    const session = await loadSession({ now: NOW });
    await session.completeRound(spoken('然後就是那個這個其實', 60));
    await session.completeRound(spoken('今天講的是專注力這件事情', 60));
    const box = mount();
    renderToday(box, { session });
    const table = box.querySelector('.metrics-table');
    const toneOfField = (field) =>
      table.querySelector('tbody tr[data-field="' + field + '"] td:last-child .delta').dataset.tone;
    expect(toneOfField('fillerDensity')).toBe('good');
    expect(toneOfField('seconds')).toBe('neutral');
    expect(toneOfField('charCount')).toBe('neutral');
  });

  it('每一遍都有「重錄」，按下去把是第幾遍交出去', async () => {
    const session = await loadSession({ now: NOW });
    await session.completeRound(spoken(ROUND1, 180));
    await session.completeRound(spoken(ROUND2, 130));
    const onRedoRound = vi.fn();
    const box = mount();
    renderToday(box, { session }, { onRedoRound });

    const buttons = box.querySelectorAll('[data-role="redo"]');
    expect(buttons).toHaveLength(2);
    buttons[1].click();
    expect(onRedoRound).toHaveBeenCalledWith(2);
  });

  it('重錄第 2 遍：回到開始第 2 遍，第 1 遍不動', async () => {
    const session = await loadSession({ now: NOW });
    await session.completeRound(spoken(ROUND1, 180));
    await session.completeRound(spoken(ROUND2, 130));
    await session.redoRound(2);

    const box = mount();
    renderToday(box, { session });
    expect(box.querySelectorAll('.round-card')).toHaveLength(1);
    expect(box.querySelector('.round-card textarea').value).toBe(ROUND1);
    expect(box.querySelector('#record-btn').textContent).toBe('開始第 2 遍');
    expect(box.querySelector('#round-progress').textContent).toBe('第 2 遍 / 共 3 遍');
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

  it('分析做過之後還能重新分析', async () => {
    const session = await loadSession({ now: NOW });
    await session.completeRound(spoken(ROUND1, 180));
    await session.completeRound(spoken(ROUND2, 130));
    await session.completeRound(spoken(ROUND3, 95));
    await session.finish('主題');
    await session.attachReview({
      rescue: [{ point: '舊的分析', reason: '理由' }],
      cut: [],
      newContent: [],
      conclusion: { isFirstSentence: true, note: '' },
    });

    const onReview = vi.fn();
    const box = mount();
    renderToday(box, { session }, { onReview });
    const btn = box.querySelector('#review-btn');
    expect(btn.textContent).toBe('重新分析');
    expect(box.textContent).toContain('舊的分析');
    btn.click();
    expect(onReview).toHaveBeenCalledTimes(1);
  });

  it('分析中按鈕停用並顯示分析中', async () => {
    const session = await loadSession({ now: NOW });
    await session.completeRound(spoken(ROUND1, 180));
    await session.completeRound(spoken(ROUND2, 130));
    await session.completeRound(spoken(ROUND3, 95));
    await session.finish('主題');
    const box = mount();
    renderToday(box, { session, reviewing: true });
    const btn = box.querySelector('#review-btn');
    expect(btn.textContent).toBe('分析中…');
    expect(btn.disabled).toBe(true);
  });

  it('存檔之後出現 AI 分析按鈕', async () => {
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

  it('AI 分析失敗時把原因顯示出來，資料還在', async () => {
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
