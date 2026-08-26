import { describe, it, expect, beforeEach } from 'vitest';
import { loadSession, createSession, ROUNDS_PER_PRACTICE } from '../src/session.js';
import { clearAll, getPractice, listPractices } from '../src/storage.js';
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

beforeEach(async () => {
  await clearAll();
});

describe('T09 三遍流程控制', () => {
  it('一次練習就是三遍', () => {
    expect(ROUNDS_PER_PRACTICE).toBe(3);
  });

  it('新的一次練習從第 1 遍開始，而且沒有標題輸入', async () => {
    const s = await loadSession({ now: NOW });
    expect(s.currentRoundNumber).toBe(1);
    expect(s.completedRounds).toBe(0);
    expect(s.needsTitle).toBe(false);
    expect(s.practice.title).toBe('');
  });

  it('完成第 1 遍後離開再進入，回到第 2 遍待開始', async () => {
    const s1 = await loadSession({ now: NOW });
    await s1.completeRound(spoken(ROUND1, 180));

    // 模擬關掉 APP 再打開
    const s2 = await loadSession({ now: NOW + 60_000 });
    expect(s2.practice.id).toBe(s1.practice.id);
    expect(s2.completedRounds).toBe(1);
    expect(s2.currentRoundNumber).toBe(2);
    expect(s2.rounds[0].transcript).toBe(ROUND1);
  });

  it('隔天才回來，未完成的那筆仍然接得下去', async () => {
    const s1 = await loadSession({ now: NOW });
    await s1.completeRound(spoken(ROUND1, 180));
    const s2 = await loadSession({ now: NOW + 26 * 60 * 60 * 1000 });
    expect(s2.practice.id).toBe(s1.practice.id);
    expect(s2.currentRoundNumber).toBe(2);
  });

  it('三遍未完成時不出現標題輸入', async () => {
    const s = await loadSession({ now: NOW });
    await s.completeRound(spoken(ROUND1, 180));
    expect(s.needsTitle).toBe(false);
    await s.completeRound(spoken(ROUND2, 130));
    expect(s.needsTitle).toBe(false);
    expect(s.isComplete).toBe(false);
  });

  it('三遍完成後出現標題輸入且可存檔', async () => {
    const s = await loadSession({ now: NOW });
    await s.completeRound(spoken(ROUND1, 180));
    await s.completeRound(spoken(ROUND2, 130));
    await s.completeRound(spoken(ROUND3, 95));
    expect(s.isComplete).toBe(true);
    expect(s.needsTitle).toBe(true);
    expect(s.currentRoundNumber).toBeNull();

    await s.finish('專注力那篇文章');
    expect(s.isSaved).toBe(true);
    expect(s.needsTitle).toBe(false);

    const saved = await getPractice(s.practice.id, { now: NOW });
    expect(saved.title).toBe('專注力那篇文章');
    expect(saved.status).toBe('done');
    expect(saved.rounds).toHaveLength(3);
  });

  it('三遍沒講完就存檔會被擋下來', async () => {
    const s = await loadSession({ now: NOW });
    await s.completeRound(spoken(ROUND1, 180));
    await expect(s.finish('提早存檔')).rejects.toThrow('三遍還沒講完');
  });

  it('空白標題不能存檔', async () => {
    const s = await loadSession({ now: NOW });
    await s.completeRound(spoken(ROUND1, 180));
    await s.completeRound(spoken(ROUND2, 130));
    await s.completeRound(spoken(ROUND3, 95));
    await expect(s.finish('   ')).rejects.toThrow('主題');
  });

  it('存檔之後再開就是新的一次練習', async () => {
    const s = await loadSession({ now: NOW });
    await s.completeRound(spoken(ROUND1, 180));
    await s.completeRound(spoken(ROUND2, 130));
    await s.completeRound(spoken(ROUND3, 95));
    await s.finish('主題');

    const next = await loadSession({ now: NOW + 1000 });
    expect(next.practice.id).not.toBe(s.practice.id);
    expect(next.currentRoundNumber).toBe(1);
  });

  it('第四遍講不了，多按也不會多存一筆', async () => {
    const s = await loadSession({ now: NOW });
    await s.completeRound(spoken(ROUND1, 180));
    await s.completeRound(spoken(ROUND2, 130));
    await s.completeRound(spoken(ROUND3, 95));
    await s.completeRound(spoken('多出來的第四遍', 30));
    expect(s.rounds).toHaveLength(3);
  });

  it('每一遍都會算好數據', async () => {
    const s = await loadSession({ now: NOW });
    await s.completeRound(spoken(ROUND3, 95));
    const r = s.rounds[0];
    expect(r.index).toBe(1);
    expect(r.seconds).toBe(95);
    expect(r.metrics.charCount).toBeGreaterThan(300);
    expect(r.metrics.fillerCount).toBeGreaterThan(0);
    expect(r.metrics.speed).toBeGreaterThan(0);
  });

  it('第 1 遍沒有差距，第 2 遍起才有', async () => {
    const s = await loadSession({ now: NOW });
    await s.completeRound(spoken(ROUND1, 180));
    expect(s.deltaFor(1)).toBeNull();
    await s.completeRound(spoken(ROUND2, 130));
    const d = s.deltaFor(2);
    expect(d).not.toBeNull();
    expect(d.charCount.direction).toBe('longer');
  });

  it('編輯逐字稿之後數據自動重算', async () => {
    const s = await loadSession({ now: NOW });
    await s.completeRound(spoken('然後就是這個那個', 60));
    const before = s.rounds[0].metrics.fillerCount;
    await s.updateTranscript(1, '今天講的是專注力');
    expect(s.rounds[0].metrics.fillerCount).toBeLessThan(before);
    expect(s.rounds[0].metrics.charCount).toBe(8);

    const saved = await getPractice(s.practice.id, { now: NOW });
    expect(saved.rounds[0].transcript).toBe('今天講的是專注力');
  });

  it('斷網那遍逐字稿為空並標記待補字，補完字之後標記消失', async () => {
    const s = await loadSession({ now: NOW });
    await s.completeRound({ transcript: '', seconds: 120, needsManualEntry: true, reason: 'network' });
    expect(s.rounds[0].needsManualEntry).toBe(true);
    expect(s.rounds[0].metrics.charCount).toBe(0);

    await s.updateTranscript(1, '我自己補上的內容');
    expect(s.rounds[0].needsManualEntry).toBe(false);
    expect(s.rounds[0].metrics.charCount).toBe(8);
  });

  it('AI 分析跟著這次練習一起存', async () => {
    const s = await loadSession({ now: NOW });
    await s.completeRound(spoken(ROUND1, 180));
    const review = { rescue: [], cut: [], newContent: [], conclusion: { isFirstSentence: true, note: '' } };
    await s.attachReview(review);
    const saved = await getPractice(s.practice.id, { now: NOW });
    expect(saved.review).toEqual(review);
  });

  it('沒講完就離開不會留下空白紀錄', async () => {
    await loadSession({ now: NOW });
    expect(await listPractices({ now: NOW })).toHaveLength(0);
  });

  it('可以直接包住一筆既有的練習', async () => {
    const s = await loadSession({ now: NOW });
    await s.completeRound(spoken(ROUND1, 180));
    const reopened = createSession(await getPractice(s.practice.id, { now: NOW }));
    expect(reopened.currentRoundNumber).toBe(2);
  });
});
