import { describe, it, expect } from 'vitest';
import { compareMetrics, toneOf } from '../src/compare.js';
import { computeMetrics } from '../src/metrics.js';

const base = { seconds: 0, charCount: 0, speed: 0, fillerCount: 0, fillerDensity: 0 };

describe('T04 兩遍之間的差距', () => {
  it('第 1 遍 330 字、第 2 遍 780 字 → 字數 +136%，方向為變長', () => {
    const prev = { ...base, charCount: 330 };
    const cur = { ...base, charCount: 780 };
    const d = compareMetrics(cur, prev);
    expect(d.charCount.delta).toBe(450);
    expect(d.charCount.percent).toBe(136);
    expect(d.charCount.direction).toBe('longer');
  });

  it('贅詞密度 3.0 → 4.3 標記為退步', () => {
    const d = compareMetrics({ ...base, fillerDensity: 4.3 }, { ...base, fillerDensity: 3.0 });
    expect(d.fillerDensity.direction).toBe('worse');
    expect(toneOf(d.fillerDensity.direction)).toBe('bad');
  });

  it('贅詞密度變低標記為進步', () => {
    const d = compareMetrics({ ...base, fillerDensity: 2.1 }, { ...base, fillerDensity: 4.3 });
    expect(d.fillerDensity.direction).toBe('better');
    expect(toneOf(d.fillerDensity.direction)).toBe('good');
  });

  it('沒有前一遍 → 回傳空值不報錯', () => {
    expect(compareMetrics({ ...base, charCount: 100 }, null)).toBeNull();
    expect(compareMetrics({ ...base, charCount: 100 }, undefined)).toBeNull();
    expect(compareMetrics(null, null)).toBeNull();
  });

  it('秒數與字數的方向是中性描述，不判斷好壞', () => {
    const d = compareMetrics({ ...base, seconds: 95, charCount: 300 }, { ...base, seconds: 130, charCount: 400 });
    expect(d.seconds.direction).toBe('shorter');
    expect(d.charCount.direction).toBe('shorter');
    expect(toneOf(d.seconds.direction)).toBe('neutral');
    expect(toneOf(d.charCount.direction)).toBe('neutral');
  });

  it('語速方向為變快變慢，同樣是中性', () => {
    const d = compareMetrics({ ...base, speed: 215 }, { ...base, speed: 105 });
    expect(d.speed.direction).toBe('faster');
    expect(toneOf(d.speed.direction)).toBe('neutral');
  });

  it('贅詞數變少是進步，變多是退步', () => {
    expect(compareMetrics({ ...base, fillerCount: 8 }, { ...base, fillerCount: 14 }).fillerCount.direction).toBe('better');
    expect(compareMetrics({ ...base, fillerCount: 20 }, { ...base, fillerCount: 14 }).fillerCount.direction).toBe('worse');
  });

  it('完全一樣時方向為 same，色調中性', () => {
    const m = computeMetrics('然後我今天講一件事', 60);
    const d = compareMetrics(m, m);
    for (const key of ['seconds', 'charCount', 'speed', 'fillerCount', 'fillerDensity']) {
      expect(d[key].delta, key).toBe(0);
      expect(d[key].direction, key).toBe('same');
      expect(toneOf(d[key].direction), key).toBe('neutral');
    }
  });

  it('前一遍為 0 時不做除法，百分比回傳 null 而不是 Infinity', () => {
    const d = compareMetrics({ ...base, charCount: 120 }, { ...base, charCount: 0 });
    expect(d.charCount.delta).toBe(120);
    expect(d.charCount.percent).toBeNull();
    expect(d.charCount.direction).toBe('longer');
  });
});
