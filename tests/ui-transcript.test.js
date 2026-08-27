// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderRoundCard, exportRoundAudio, audioFilename } from '../src/ui-transcript.js';
import { loadSession } from '../src/session.js';
import { clearAll, getPractice } from '../src/storage.js';
import { computeMetrics } from '../src/metrics.js';

const NOW = Date.UTC(2026, 7, 27, 21, 0, 0);

function roundOf(overrides = {}) {
  const transcript = overrides.transcript ?? '然後就是這個那個';
  return {
    index: 1,
    seconds: 60,
    transcript,
    needsManualEntry: false,
    audio: new TextEncoder().encode('audio-bytes').buffer,
    audioType: 'audio/webm',
    audioPurged: false,
    metrics: computeMetrics(transcript, 60),
    ...overrides,
  };
}

function mount(node) {
  document.body.appendChild(node);
  return node;
}

beforeEach(async () => {
  await clearAll();
  document.body.replaceChildren();
});

describe('T11 逐字稿編輯與補字', () => {
  it('逐字稿可編輯，改完會把新內容交出去', () => {
    const onEdit = vi.fn();
    const card = mount(renderRoundCard(roundOf(), { onEdit }));
    const box = card.querySelector('textarea');
    expect(box.readOnly).toBe(false);
    box.value = '改過的內容';
    box.dispatchEvent(new Event('change'));
    expect(onEdit).toHaveBeenCalledWith(1, '改過的內容');
  });

  it('編輯逐字稿後數據自動重算', async () => {
    const session = await loadSession({ now: NOW });
    await session.completeRound({ transcript: '然後就是這個那個', seconds: 60 });
    const before = session.rounds[0].metrics;
    expect(before.fillerCount).toBe(4);

    const card = mount(
      renderRoundCard(session.rounds[0], { onEdit: (i, text) => session.updateTranscript(i, text) }),
    );
    const box = card.querySelector('textarea');
    box.value = '今天講的是專注力這件事';
    box.dispatchEvent(new Event('change'));
    await Promise.resolve();

    expect(session.rounds[0].metrics.fillerCount).toBe(0);
    expect(session.rounds[0].metrics.charCount).toBe(11);
    const saved = await getPractice(session.practice.id, { now: NOW });
    expect(saved.rounds[0].transcript).toBe('今天講的是專注力這件事');
  });

  it('辨識中途停掉時明講逐字稿不完整，但內容照留', () => {
    const card = mount(renderRoundCard(roundOf({
      transcript: '中斷之前講的內容',
      needsManualEntry: false,
      interrupted: true,
      recognitionNotice: '辨識中途停了，這一遍的逐字稿可能不完整。可以按「重錄」重講一次。',
    })));
    const notice = card.querySelector('[data-role="interrupted-notice"]');
    expect(notice).not.toBeNull();
    expect(notice.textContent).toContain('不完整');
    expect(card.querySelector('textarea').value).toBe('中斷之前講的內容');
  });

  it('沒有中斷就不出現那行提示', () => {
    const card = mount(renderRoundCard(roundOf()));
    expect(card.querySelector('[data-role="interrupted-notice"]')).toBeNull();
  });

  it('斷網那遍出現補字說明與貼上欄位', () => {
    const card = mount(renderRoundCard(roundOf({ transcript: '', needsManualEntry: true })));
    expect(card.querySelector('[data-role="manual-entry-notice"]')).not.toBeNull();
    const box = card.querySelector('textarea');
    expect(box.value).toBe('');
    expect(box.placeholder).toContain('打上來');
  });

  it('補字之後待補字標記消失', async () => {
    const session = await loadSession({ now: NOW });
    await session.completeRound({ transcript: '', seconds: 120, needsManualEntry: true, reason: 'network' });

    let card = mount(renderRoundCard(session.rounds[0], {}));
    expect(card.querySelector('[data-role="manual-entry-notice"]')).not.toBeNull();

    await session.updateTranscript(1, '我自己補上的內容');
    document.body.replaceChildren();
    card = mount(renderRoundCard(session.rounds[0], {}));
    expect(card.querySelector('[data-role="manual-entry-notice"]')).toBeNull();
    expect(card.querySelector('textarea').value).toBe('我自己補上的內容');
  });

  it('點取出音檔會產生可下載的檔案', () => {
    const save = vi.fn();
    const round = roundOf();
    const filename = exportRoundAudio(round, { date: '2026-08-27', title: '專注力那篇文章' }, save);
    expect(save).toHaveBeenCalledTimes(1);
    const [blob, name] = save.mock.calls[0];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
    expect(name).toBe(filename);
    expect(name).toBe('專注力那篇文章-第1遍.webm');
  });

  it('卡片上的取出音檔按鈕會被呼叫', () => {
    const onExportAudio = vi.fn();
    const card = mount(renderRoundCard(roundOf(), { onExportAudio }));
    card.querySelector('[data-role="export-audio"]').click();
    expect(onExportAudio).toHaveBeenCalledTimes(1);
  });

  it('沒有標題時用日期當檔名', () => {
    expect(audioFilename(roundOf({ index: 2 }), { date: '2026-08-27' })).toBe('2026-08-27-第2遍.webm');
  });

  it('音檔已被清除時：不給下載按鈕，改說明原因', () => {
    const card = mount(renderRoundCard(roundOf({ audio: null, audioType: null, audioPurged: true })));
    expect(card.querySelector('[data-role="export-audio"]')).toBeNull();
    expect(card.querySelector('[data-role="audio-purged"]').textContent).toContain('7 天');
  });

  it('沒有音檔也沒有被清除時，兩個都不出現', () => {
    const card = mount(renderRoundCard(roundOf({ audio: null, audioType: null, audioPurged: false })));
    expect(card.querySelector('[data-role="export-audio"]')).toBeNull();
    expect(card.querySelector('[data-role="audio-purged"]')).toBeNull();
  });

  it('唯讀模式下逐字稿不能改', () => {
    const card = mount(renderRoundCard(roundOf(), { editable: false }));
    expect(card.querySelector('textarea').readOnly).toBe(true);
  });

  it('數據不放在逐字稿卡片裡，統一收到三遍對比表', () => {
    const card = mount(renderRoundCard(roundOf()));
    expect(card.querySelector('.metrics')).toBeNull();
    expect(card.querySelector('textarea')).not.toBeNull();
  });

  it('卡片上有「重錄」，按下去把是第幾遍交出去', () => {
    const onRedo = vi.fn();
    const card = mount(renderRoundCard(roundOf({ index: 2 }), { onRedo }));
    const btn = card.querySelector('[data-role="redo"]');
    expect(btn.textContent).toBe('重錄');
    btn.click();
    expect(onRedo).toHaveBeenCalledWith(2);
  });

  it('沒有給重錄的處理函式就不出現那顆按鈕', () => {
    const card = mount(renderRoundCard(roundOf()));
    expect(card.querySelector('[data-role="redo"]')).toBeNull();
  });
});
