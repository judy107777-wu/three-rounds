import { describe, it, expect, vi } from 'vitest';
import { createRecognizer, fallbackNotice, RECOGNITION_LANG } from '../src/speech.js';

/**
 * 假的 SpeechRecognition。
 * 行為刻意做成 Android Chrome 實測的樣子：
 * 同一個 index 會重複回傳「確定」結果而且愈來愈長，講完一句就自己 onend。
 */
function makeFakeCtor(store) {
  store.instances = [];
  return class FakeRecognition {
    constructor() {
      this.lang = '';
      this.continuous = false;
      this.interimResults = false;
      this.onresult = null;
      this.onerror = null;
      this.onend = null;
      this.started = false;
      store.instance = this;
      store.instances.push(this);
    }
    start() {
      this.started = true;
      store.startCount = (store.startCount || 0) + 1;
    }
    stop() {
      this.started = false;
      if (this.onend) this.onend();
    }
    /** 送出一批結果。results 是 [{text, isFinal}] */
    emit(results) {
      this.onresult({
        resultIndex: 0,
        results: results.map((r) => ({
          isFinal: r.isFinal !== false,
          0: { transcript: r.text },
          length: 1,
        })),
      });
    }
    /** 只送一句確定結果（最常見的情況） */
    emitFinal(text) {
      this.emit([{ text, isFinal: true }]);
    }
    emitError(code) {
      if (this.onerror) this.onerror({ error: code });
    }
    /** 模擬 Android 講完一句就自己結束 */
    endByItself() {
      this.started = false;
      if (this.onend) this.onend();
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
    store.instance.emit([
      { text: '我今天想講一篇文章' },
      { text: '作者是一個工程師' },
      { text: '他做了一個三十天的實驗' },
    ]);
    const result = await r.stop();
    expect(result.transcript).toBe('我今天想講一篇文章作者是一個工程師他做了一個三十天的實驗');
    expect(result.needsManualEntry).toBe(false);
    expect(result.reason).toBeNull();
  });

  it('同一句重複回傳且愈來愈長時，不會累加成重複的字', async () => {
    // 這就是 Android Chrome 實際的行為
    const store = {};
    const r = createRecognizer({ SpeechRecognition: makeFakeCtor(store) });
    r.start();
    store.instance.emitFinal('今天天氣');
    store.instance.emitFinal('今天天氣很好');
    store.instance.emitFinal('今天天氣很好我出門');
    store.instance.emitFinal('今天天氣很好我出門散步');
    const result = await r.stop();
    expect(result.transcript).toBe('今天天氣很好我出門散步');
  });

  it('中間夾雜空的確定結果，不會把已經聽到的內容洗掉', async () => {
    const store = {};
    const r = createRecognizer({ SpeechRecognition: makeFakeCtor(store) });
    r.start();
    store.instance.emitFinal('');
    store.instance.emitFinal('今天天氣');
    store.instance.emitFinal('');
    store.instance.emitFinal('今天天氣很好');
    store.instance.emitFinal('');
    const result = await r.stop();
    expect(result.transcript).toBe('今天天氣很好');
  });

  it('講完一句自己結束後會自動接著聽，前後兩段接得起來', async () => {
    const store = {};
    const r = createRecognizer({ SpeechRecognition: makeFakeCtor(store) });
    r.start();
    store.instance.emitFinal('我今天想講一篇文章');
    store.instance.endByItself(); // Android 講完一句就自己停

    expect(r.running).toBe(true);
    expect(r.restarts).toBe(1);
    expect(store.startCount).toBe(2);

    store.instance.emitFinal('作者是一個工程師');
    const result = await r.stop();
    expect(result.transcript).toBe('我今天想講一篇文章作者是一個工程師');
  });

  it('連續自己結束多次，內容一路累積不掉字', async () => {
    const store = {};
    const r = createRecognizer({ SpeechRecognition: makeFakeCtor(store) });
    r.start();
    for (const line of ['第一句', '第二句', '第三句', '第四句']) {
      store.instance.emitFinal(line);
      store.instance.endByItself();
    }
    const result = await r.stop();
    expect(result.transcript).toBe('第一句第二句第三句第四句');
    expect(r.restarts).toBe(4);
  });

  it('使用者按停止之後就不再自動重啟', async () => {
    const store = {};
    const r = createRecognizer({ SpeechRecognition: makeFakeCtor(store) });
    r.start();
    store.instance.emitFinal('講完了');
    const before = store.startCount;
    await r.stop();
    expect(store.startCount).toBe(before);
    expect(r.running).toBe(false);
  });

  it('沒有權限這種致命錯誤不重啟，避免無窮迴圈', async () => {
    const store = {};
    const r = createRecognizer({ SpeechRecognition: makeFakeCtor(store) });
    r.start();
    const before = store.startCount;
    store.instance.emitError('not-allowed');
    store.instance.endByItself();
    expect(store.startCount).toBe(before);
    const result = await r.stop();
    expect(result.reason).toBe('not-allowed');
  });

  it('辨識抓不到麥克風也不重啟', async () => {
    const store = {};
    const r = createRecognizer({ SpeechRecognition: makeFakeCtor(store) });
    r.start();
    const before = store.startCount;
    store.instance.emitError('audio-capture');
    store.instance.endByItself();
    expect(store.startCount).toBe(before);
  });

  it('沒聽到聲音只是暫時的，還是要繼續聽下去', async () => {
    const store = {};
    const r = createRecognizer({ SpeechRecognition: makeFakeCtor(store) });
    r.start();
    store.instance.emitError('no-speech');
    store.instance.endByItself();
    expect(r.restarts).toBe(1);
    store.instance.emitFinal('停頓之後又開始講');
    const result = await r.stop();
    expect(result.transcript).toBe('停頓之後又開始講');
    expect(result.needsManualEntry).toBe(false);
  });

  it('講到一半的暫時結果會即時回報，但不會重複進入逐字稿', async () => {
    const store = {};
    const onUpdate = vi.fn();
    const r = createRecognizer({ SpeechRecognition: makeFakeCtor(store), onUpdate });
    r.start();
    store.instance.emit([{ text: '我今天想', isFinal: false }]);
    expect(r.currentText()).toBe('我今天想');
    store.instance.emit([{ text: '我今天想講一篇文章', isFinal: true }]);
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
    store.instance.emitFinal('斷線之前講的這段');
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
  });

  it('麥克風被錄音佔住有專屬提示', () => {
    expect(fallbackNotice('audio-capture')).toContain('抓不到麥克風');
    expect(fallbackNotice('service-not-allowed')).toContain('語音辨識服務');
    expect(fallbackNotice('language-not-supported')).toContain('中文辨識');
    expect(fallbackNotice('aborted')).toContain('中斷');
  });

  it('提示後面附上原始代碼，出事時查得下去', () => {
    expect(fallbackNotice('audio-capture')).toContain('（代碼：audio-capture）');
    expect(fallbackNotice('network')).toContain('（代碼：network）');
    expect(fallbackNotice('unsupported')).not.toContain('代碼');
  });

  it('沒看過的代碼用通用訊息，但代碼還是要印出來', () => {
    const notice = fallbackNotice('看不懂的代碼');
    expect(notice).toContain('辨識中斷');
    expect(notice).toContain('（代碼：看不懂的代碼）');
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
    store.instance.emitFinal('第一遍的內容');
    store.instance.endByItself();
    await r.stop();
    r.start();
    store.instance.emitFinal('第二遍的內容');
    const result = await r.stop();
    expect(result.transcript).toBe('第二遍的內容');
    expect(r.restarts).toBe(0);
  });
});
