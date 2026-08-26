import { describe, it, expect, vi } from 'vitest';
import { createRecognizer, fallbackNotice, RECOGNITION_LANG } from '../src/speech.js';

// 假的 SpeechRecognition：只做這個模組真正用到的部分
function makeFakeCtor(store) {
  return class FakeRecognition {
    constructor() {
      this.lang = '';
      this.continuous = false;
      this.interimResults = false;
      this.onresult = null;
      this.onerror = null;
      this.onend = null;
      store.instance = this;
    }
    start() {
      store.started = true;
    }
    stop() {
      store.started = false;
      if (this.onend) this.onend();
    }
    // 測試用：模擬辨識回傳一段文字
    emit(text, isFinal = true, resultIndex = 0) {
      this.onresult({
        resultIndex,
        results: [{ isFinal, 0: { transcript: text }, length: 1 }],
      });
    }
    emitError(code) {
      if (this.onerror) this.onerror({ error: code });
    }
  };
}

describe('T08 語音辨識模組', () => {
  it('辨識語言固定為台灣中文', () => {
    const store = {};
    const r = createRecognizer({ SpeechRecognition: makeFakeCtor(store) });
    r.start();
    expect(RECOGNITION_LANG).toBe('zh-TW');
    expect(store.instance.lang).toBe('zh-TW');
    expect(store.instance.continuous).toBe(true);
    expect(store.instance.interimResults).toBe(true);
  });

  it('三段文字串接成完整逐字稿', async () => {
    const store = {};
    const r = createRecognizer({ SpeechRecognition: makeFakeCtor(store) });
    r.start();
    store.instance.emit('我今天想講一篇文章');
    store.instance.emit('作者是一個工程師');
    store.instance.emit('他做了一個三十天的實驗');
    const result = await r.stop();
    expect(result.transcript).toBe('我今天想講一篇文章作者是一個工程師他做了一個三十天的實驗');
    expect(result.needsManualEntry).toBe(false);
    expect(result.reason).toBeNull();
  });

  it('講到一半的暫時結果會即時回報，但不會重複進入逐字稿', async () => {
    const store = {};
    const onUpdate = vi.fn();
    const r = createRecognizer({ SpeechRecognition: makeFakeCtor(store), onUpdate });
    r.start();
    store.instance.emit('我今天想', false);
    expect(r.currentText()).toBe('我今天想');
    store.instance.emit('我今天想講一篇文章', true);
    const result = await r.stop();
    expect(result.transcript).toBe('我今天想講一篇文章');
    expect(onUpdate).toHaveBeenCalled();
  });

  it('斷網：逐字稿為空且標記為待補字', async () => {
    const store = {};
    const r = createRecognizer({ SpeechRecognition: makeFakeCtor(store) });
    r.start();
    store.instance.emitError('network');
    const result = await r.stop();
    expect(result.transcript).toBe('');
    expect(result.needsManualEntry).toBe(true);
    expect(result.reason).toBe('network');
    expect(result.notice).toContain('補');
  });

  it('斷網但前面已經辨識到內容：保留內容，不標記待補字', async () => {
    const store = {};
    const r = createRecognizer({ SpeechRecognition: makeFakeCtor(store) });
    r.start();
    store.instance.emit('斷線之前講的這段');
    store.instance.emitError('network');
    const result = await r.stop();
    expect(result.transcript).toBe('斷線之前講的這段');
    expect(result.needsManualEntry).toBe(false);
  });

  it('瀏覽器不支援：顯示降級提示，不當掉', async () => {
    const r = createRecognizer({ SpeechRecognition: undefined });
    expect(r.supported).toBe(false);
    expect(r.notice).toContain('不支援語音辨識');
    expect(r.start()).toBe(false);
    const result = await r.stop();
    expect(result.transcript).toBe('');
    expect(result.needsManualEntry).toBe(true);
    expect(result.reason).toBe('unsupported');
  });

  it('沒有說話：標記待補字並說明原因', async () => {
    const store = {};
    const r = createRecognizer({ SpeechRecognition: makeFakeCtor(store) });
    r.start();
    store.instance.emitError('no-speech');
    const result = await r.stop();
    expect(result.reason).toBe('no-speech');
    expect(result.needsManualEntry).toBe(true);
  });

  it('沒有麥克風權限的提示與斷網不同', () => {
    expect(fallbackNotice('not-allowed')).toContain('權限');
    expect(fallbackNotice('network')).toContain('網路');
    expect(fallbackNotice('看不懂的代碼')).toBe(fallbackNotice('failed'));
  });

  it('沒有開始就停止不會報錯', async () => {
    const store = {};
    const r = createRecognizer({ SpeechRecognition: makeFakeCtor(store) });
    const result = await r.stop();
    expect(result.transcript).toBe('');
    expect(result.needsManualEntry).toBe(true);
  });

  it('每次開始都從乾淨的狀態算起', async () => {
    const store = {};
    const r = createRecognizer({ SpeechRecognition: makeFakeCtor(store) });
    r.start();
    store.instance.emit('第一遍的內容');
    await r.stop();
    r.start();
    store.instance.emit('第二遍的內容');
    const result = await r.stop();
    expect(result.transcript).toBe('第二遍的內容');
  });
});
