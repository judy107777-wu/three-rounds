import { describe, it, expect } from 'vitest';
import { FILLER_WORDS, countChars, countFillers, computeMetrics } from '../src/metrics.js';
import { ROUND3 } from './fixtures/transcripts.js';

describe('T03 數據計算', () => {
  it('贅詞清單就是架構文件列的那份', () => {
    expect(FILLER_WORDS).toEqual([
      '然後', '就是', '那麼', '呢', '我覺得',
      '這個', '那個', '其實', '基本上', '老實說', '對啊', '嗯', '啊',
      '之類的', '什麼的', '的話', '我跟你講', '你知道嗎',
    ]);
  });

  it('第 3 遍逐字稿 95 秒：字數約 350、贅詞數約 14、密度約 4.0', () => {
    const m = computeMetrics(ROUND3, 95);
    expect(m.charCount).toBeGreaterThanOrEqual(330);
    expect(m.charCount).toBeLessThanOrEqual(370);
    expect(m.fillerCount).toBeGreaterThanOrEqual(12);
    expect(m.fillerCount).toBeLessThanOrEqual(16);
    expect(m.fillerDensity).toBeGreaterThanOrEqual(3.4);
    expect(m.fillerDensity).toBeLessThanOrEqual(4.6);
  });

  it('語速＝字數除以秒數再乘六十', () => {
    const m = computeMetrics('一二三四五六七八九十', 30);
    expect(m.charCount).toBe(10);
    expect(m.speed).toBe(20);
  });

  it('空字串：全部為 0 且不報錯', () => {
    const m = computeMetrics('', 42);
    expect(m).toEqual({ seconds: 42, charCount: 0, speed: 0, fillerCount: 0, fillerDensity: 0 });
  });

  it('只有標點的字串：字數 0', () => {
    expect(countChars('，。！？、；：「」（）…—　 ,.!?')).toBe(0);
    const m = computeMetrics('，。！？、；：「」', 10);
    expect(m.charCount).toBe(0);
    expect(m.fillerDensity).toBe(0);
  });

  it('沒有給秒數或秒數為 0：語速為 0 且不報錯', () => {
    expect(computeMetrics('一二三', 0).speed).toBe(0);
    expect(computeMetrics('一二三').seconds).toBe(0);
  });

  it('null 或 undefined 逐字稿不會炸掉', () => {
    expect(computeMetrics(null, 10).charCount).toBe(0);
    expect(computeMetrics(undefined, 10).charCount).toBe(0);
  });

  it('中文字一個算一字，英數連在一起算一字', () => {
    expect(countChars('我today很好')).toBe(4); // 我 + today + 很 + 好
    expect(countChars('第 1 遍')).toBe(3);
  });

  it('贅詞不重複計算，長的優先比對', () => {
    // 「對啊」算一個「對啊」，不會又算一個「啊」
    expect(countFillers('對啊')).toBe(1);
    // 「之類的話」算一個「之類的」，剩下的「話」不是贅詞
    expect(countFillers('之類的話')).toBe(1);
    expect(countFillers('然後然後然後')).toBe(3);
  });

  it('贅詞比對忽略標點與空白', () => {
    expect(countFillers('然，後')).toBe(1);
    expect(countFillers('就 是')).toBe(1);
  });

  it('沒有贅詞時密度為 0', () => {
    const m = computeMetrics('今天天氣很好我出門散步', 60);
    expect(m.fillerCount).toBe(0);
    expect(m.fillerDensity).toBe(0);
  });
});
