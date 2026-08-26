import { describe, it, expect, beforeEach } from 'vitest';
import {
  createPractice, savePractice, getPractice, updatePractice, deletePractice,
  listPractices, searchPractices, getUnfinishedPractice, setPinned,
  clearAll, AUDIO_KEEP_DAYS,
} from '../src/storage.js';
import { computeMetrics } from '../src/metrics.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 27, 12, 0, 0);

function bufferOf(text) {
  return new TextEncoder().encode(text).buffer;
}

function roundOf(index, transcript, seconds) {
  return {
    index,
    seconds,
    transcript,
    needsManualEntry: false,
    audio: bufferOf(`audio-${index}`),
    audioType: 'audio/webm',
    metrics: computeMetrics(transcript, seconds),
  };
}

async function seed(overrides = {}) {
  const p = createPractice({ now: NOW, ...overrides });
  Object.assign(p, overrides);
  await savePractice(p);
  return p;
}

beforeEach(async () => {
  await clearAll();
});

describe('T05 儲存模組', () => {
  it('存入一筆再讀出，內容一致', async () => {
    const p = await seed({
      title: '專注力那篇文章',
      status: 'done',
      rounds: [roundOf(1, '然後我今天想講一篇文章', 180)],
    });
    const got = await getPractice(p.id);
    expect(got.id).toBe(p.id);
    expect(got.title).toBe('專注力那篇文章');
    expect(got.rounds[0].transcript).toBe('然後我今天想講一篇文章');
    expect(got.rounds[0].metrics.charCount).toBeGreaterThan(0);
    expect(new TextDecoder().decode(got.rounds[0].audio)).toBe('audio-1');
  });

  it('新建的一次練習：沒有標題、狀態未完成、沒有任何一遍', () => {
    const p = createPractice({ now: NOW });
    expect(p.title).toBe('');
    expect(p.status).toBe('unfinished');
    expect(p.rounds).toEqual([]);
    expect(p.review).toBeNull();
    expect(p.pinned).toBe(false);
    expect(p.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('更新只改指定欄位', async () => {
    const p = await seed({ rounds: [roundOf(1, '第一遍', 60)] });
    await updatePractice(p.id, { title: '補上的標題', status: 'done' });
    const got = await getPractice(p.id);
    expect(got.title).toBe('補上的標題');
    expect(got.status).toBe('done');
    expect(got.rounds).toHaveLength(1);
  });

  it('刪除之後讀不到', async () => {
    const p = await seed();
    await deletePractice(p.id);
    expect(await getPractice(p.id)).toBeNull();
  });

  it('讀不存在的編號回傳 null 不報錯', async () => {
    expect(await getPractice('沒有這筆')).toBeNull();
  });

  it('列表由新到舊', async () => {
    await seed({ id: 'a', createdAt: NOW - 2 * DAY });
    await seed({ id: 'b', createdAt: NOW });
    await seed({ id: 'c', createdAt: NOW - 1 * DAY });
    const list = await listPractices({ now: NOW });
    expect(list.map((p) => p.id)).toEqual(['b', 'c', 'a']);
  });

  it('用逐字稿中的詞搜尋找得到', async () => {
    await seed({ id: 'x', title: '無關標題', rounds: [roundOf(1, '他把手機放到另一個房間', 90)] });
    const found = await searchPractices('另一個房間', { now: NOW });
    expect(found.map((p) => p.id)).toEqual(['x']);
  });

  it('用標題搜尋找得到', async () => {
    await seed({ id: 'y', title: '專注力那篇文章', rounds: [] });
    const found = await searchPractices('專注力', { now: NOW });
    expect(found.map((p) => p.id)).toEqual(['y']);
  });

  it('用不存在的詞搜尋回傳空陣列不報錯', async () => {
    await seed({ id: 'z', title: '標題', rounds: [roundOf(1, '內容', 10)] });
    expect(await searchPractices('完全沒出現過的詞', { now: NOW })).toEqual([]);
  });

  it('空關鍵字視同不搜尋，回傳全部', async () => {
    await seed({ id: 'p1' });
    await seed({ id: 'p2' });
    expect(await searchPractices('  ', { now: NOW })).toHaveLength(2);
  });

  it('搜尋範圍不含 AI 分析內容', async () => {
    await seed({
      id: 'w',
      title: '標題',
      rounds: [roundOf(1, '逐字稿內容', 60)],
      review: {
        rescue: [{ point: '獨角獸關鍵詞', reason: '理由' }],
        cut: ['獨角獸關鍵詞'],
        newContent: [],
        conclusion: { isFirstSentence: true, note: '獨角獸關鍵詞' },
      },
    });
    expect(await searchPractices('獨角獸關鍵詞', { now: NOW })).toEqual([]);
    expect(await searchPractices('逐字稿內容', { now: NOW })).toHaveLength(1);
  });

  it('取得未完成的那一筆；沒有就回傳 null', async () => {
    expect(await getUnfinishedPractice({ now: NOW })).toBeNull();
    await seed({ id: 'done1', status: 'done', createdAt: NOW - DAY });
    await seed({ id: 'open1', status: 'unfinished', createdAt: NOW - 2 * DAY });
    const open = await getUnfinishedPractice({ now: NOW });
    expect(open.id).toBe('open1');
  });

  it('有多筆未完成時取最新的一筆', async () => {
    await seed({ id: 'old', status: 'unfinished', createdAt: NOW - 3 * DAY });
    await seed({ id: 'new', status: 'unfinished', createdAt: NOW - 1 * DAY });
    expect((await getUnfinishedPractice({ now: NOW })).id).toBe('new');
  });
});

describe('T06 音檔 7 天清除與釘選', () => {
  it('保留天數為 7 天', () => {
    expect(AUDIO_KEEP_DAYS).toBe(7);
  });

  it('8 天前未釘選：音檔為空，逐字稿與數據還在', async () => {
    const p = await seed({
      id: 'old',
      createdAt: NOW - 8 * DAY,
      rounds: [roundOf(1, '八天前講的內容', 90)],
    });
    const got = await getPractice(p.id, { now: NOW });
    expect(got.rounds[0].audio).toBeNull();
    expect(got.rounds[0].audioPurged).toBe(true);
    expect(got.rounds[0].transcript).toBe('八天前講的內容');
    expect(got.rounds[0].metrics.charCount).toBeGreaterThan(0);
  });

  it('清除會寫回資料庫，不是只在讀取時遮蔽', async () => {
    const p = await seed({ id: 'old2', createdAt: NOW - 8 * DAY, rounds: [roundOf(1, '內容', 90)] });
    await getPractice(p.id, { now: NOW });
    const again = await getPractice(p.id, { now: NOW + 1000 });
    expect(again.rounds[0].audio).toBeNull();
  });

  it('8 天前但已釘選：音檔還在', async () => {
    const p = await seed({
      id: 'pinned',
      createdAt: NOW - 8 * DAY,
      pinned: true,
      rounds: [roundOf(1, '釘選起來的內容', 90)],
    });
    const got = await getPractice(p.id, { now: NOW });
    expect(got.rounds[0].audio).not.toBeNull();
    expect(got.rounds[0].audioPurged).toBe(false);
  });

  it('剛存的紀錄音檔還在', async () => {
    const p = await seed({ id: 'fresh', createdAt: NOW, rounds: [roundOf(1, '今天講的', 90)] });
    const got = await getPractice(p.id, { now: NOW });
    expect(got.rounds[0].audio).not.toBeNull();
  });

  it('剛好第 7 天還在，超過才清', async () => {
    await seed({ id: 'day7', createdAt: NOW - 7 * DAY + 1000, rounds: [roundOf(1, '內容', 60)] });
    expect((await getPractice('day7', { now: NOW })).rounds[0].audio).not.toBeNull();
  });

  it('列表讀取時同樣會清除過期音檔', async () => {
    await seed({ id: 'l1', createdAt: NOW - 9 * DAY, rounds: [roundOf(1, '很久以前', 60)] });
    const list = await listPractices({ now: NOW });
    expect(list[0].rounds[0].audio).toBeNull();
  });

  it('釘選與取消釘選', async () => {
    const p = await seed({ id: 'pin', createdAt: NOW - 8 * DAY, rounds: [roundOf(1, '內容', 60)] });
    await setPinned(p.id, true);
    expect((await getPractice(p.id, { now: NOW })).rounds[0].audio).not.toBeNull();
    await setPinned(p.id, false);
    expect((await getPractice(p.id, { now: NOW })).rounds[0].audio).toBeNull();
  });
});
