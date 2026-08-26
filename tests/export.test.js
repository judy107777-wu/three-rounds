import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildExport, exportAll, exportFilename, ExportError, EXPORT_VERSION } from '../src/export.js';
import { createPractice, savePractice, clearAll } from '../src/storage.js';
import { computeMetrics } from '../src/metrics.js';

const NOW = Date.UTC(2026, 7, 27, 12, 0, 0);

function practiceOf(id, title, transcript) {
  const p = createPractice({ now: NOW });
  p.id = id;
  p.title = title;
  p.status = 'done';
  p.rounds = [
    {
      index: 1,
      seconds: 90,
      transcript,
      needsManualEntry: false,
      audio: new TextEncoder().encode('audio').buffer,
      audioType: 'audio/webm',
      metrics: computeMetrics(transcript, 90),
    },
  ];
  return p;
}

beforeEach(async () => {
  await clearAll();
});

describe('T16 匯出', () => {
  it('有三筆紀錄時匯出：產生檔案且內含三筆', async () => {
    await savePractice(practiceOf('a', '第一個主題', '第一筆的逐字稿'));
    await savePractice(practiceOf('b', '第二個主題', '第二筆的逐字稿'));
    await savePractice(practiceOf('c', '第三個主題', '第三筆的逐字稿'));

    const download = vi.fn();
    const file = await exportAll({ now: NOW, download });

    expect(download).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(file.text);
    expect(parsed.count).toBe(3);
    expect(parsed.practices).toHaveLength(3);
    expect(parsed.practices.map((p) => p.title).sort()).toEqual(['第一個主題', '第三個主題', '第二個主題'].sort());
    expect(parsed.version).toBe(EXPORT_VERSION);
  });

  it('沒有紀錄時：提示無資料，不產生空檔', async () => {
    const download = vi.fn();
    await expect(exportAll({ now: NOW, download })).rejects.toBeInstanceOf(ExportError);
    expect(download).not.toHaveBeenCalled();

    await exportAll({ now: NOW, download }).catch((e) => {
      expect(e.code).toBe('empty');
      expect(e.message).toContain('沒有');
    });
  });

  it('匯出內容含逐字稿、數據與 AI 分析', async () => {
    const p = practiceOf('x', '主題', '逐字稿內容');
    p.review = { rescue: [], cut: [], newContent: [], conclusion: { isFirstSentence: true, note: '' } };
    const file = buildExport([p], { now: NOW });
    const round = file.data.practices[0].rounds[0];
    expect(round.transcript).toBe('逐字稿內容');
    expect(round.metrics.charCount).toBeGreaterThan(0);
    expect(file.data.practices[0].review).not.toBeNull();
  });

  it('匯出檔不含音檔本體，只記錄有沒有音檔', async () => {
    const file = buildExport([practiceOf('x', '主題', '內容')], { now: NOW });
    expect(file.text).not.toContain('audioType');
    expect(file.data.practices[0].rounds[0].hasAudio).toBe(true);
    expect(file.data.practices[0].rounds[0].audio).toBeUndefined();
  });

  it('檔名帶上日期', () => {
    expect(exportFilename(NOW)).toMatch(/^三遍練習-\d{8}\.json$/);
  });

  it('匯出的是可以再讀回來的 JSON', () => {
    const file = buildExport([practiceOf('x', '主題', '內容')], { now: NOW });
    expect(file.mimeType).toBe('application/json');
    expect(() => JSON.parse(file.text)).not.toThrow();
  });
});
