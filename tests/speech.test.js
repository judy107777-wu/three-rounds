import { describe, it, expect, vi } from 'vitest';
import { createRecognizer, fallbackNotice, mergeTranscript, RECOGNITION_LANG } from '../src/speech.js';

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
      store.startCount = (store.startCount || 0) + 1;
      // 模擬 Android 太快重開時丟 InvalidStateError
      if (store.failNextStarts > 0) {
        store.failNextStarts -= 1;
        const err = new Error('recognition has already started');
        err.name = 'InvalidStateError';
        throw err;
      }
      this.started = true;
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
    emitInterim(text) {
      this.emit([{ text, isFinal: false }]);
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

describe('合併逐字稿：把重複的部分去掉', () => {
  it('整句重送而且變長，用新的蓋掉舊的', () => {
    expect(mergeTranscript('我今天', '我今天想講一篇文章')).toBe('我今天想講一篇文章');
  });

  it('已經含在裡面的整段不會再加一次', () => {
    expect(mergeTranscript('我今天想講一篇關於專注力的文章', '想講一篇關於專注力')).toBe('我今天想講一篇關於專注力的文章');
  });

  it('短的口頭禪重複出現不會被當成重複刪掉', () => {
    // 講話本來就會一直重複「然後」「就是」，刪掉的話贅詞數會少算
    expect(mergeTranscript('然後我就去了', '然後')).toBe('然後我就去了然後');
    expect(mergeTranscript('這個實驗', '這個')).toBe('這個實驗這個');
  });

  it('前後交界處重疊的字只留一份', () => {
    expect(mergeTranscript('他做了一個三十天的實驗', '三十天的實驗把手機放到另一個房間'))
      .toBe('他做了一個三十天的實驗把手機放到另一個房間');
  });

  it('完全不重疊就直接接上去', () => {
    expect(mergeTranscript('第一句', '第二句')).toBe('第一句第二句');
  });

  it('空值不會弄壞內容', () => {
    expect(mergeTranscript('已經有的', '')).toBe('已經有的');
    expect(mergeTranscript('', '新的')).toBe('新的');
    expect(mergeTranscript('', '')).toBe('');
    expect(mergeTranscript(null, undefined)).toBe('');
  });

  it('實機那段層層累積的內容會被收斂成一句', () => {
    // 使用者 2026-08-27 實機回報的形狀：每一段都是前一段再加上更多字
    const chunks = [
      '請你36位能夠讓兩個人',
      '請你36位能夠讓兩個人彼此',
      '請你36位能夠讓兩個人彼此從陌生到熟悉',
      '請你36位能夠讓兩個人彼此從陌生到熟悉再雙方的',
    ];
    const merged = chunks.reduce((acc, c) => mergeTranscript(acc, c), '');
    expect(merged).toBe('請你36位能夠讓兩個人彼此從陌生到熟悉再雙方的');
    // 「請你36位」只能出現一次
    expect(merged.split('請你36位').length - 1).toBe(1);
  });
});

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

  it('自動重啟之後把剛剛那段再送一次，不會變成重複的字', async () => {
    const store = {};
    const r = createRecognizer({ SpeechRecognition: makeFakeCtor(store) });
    r.start();
    store.instance.emitFinal('他做了一個三十天的實驗');
    store.instance.endByItself();
    // Android 重啟後常常把同一段話再送一次，而且接著往下講
    store.instance.emitFinal('他做了一個三十天的實驗把手機放到另一個房間');
    const result = await r.stop();
    expect(result.transcript).toBe('他做了一個三十天的實驗把手機放到另一個房間');
  });

  it('同一段辨識裡用新的編號層層累積，也不會重複', async () => {
    const store = {};
    const r = createRecognizer({ SpeechRecognition: makeFakeCtor(store) });
    r.start();
    store.instance.emit([
      { text: '請你36位能夠讓兩個人' },
      { text: '請你36位能夠讓兩個人彼此' },
      { text: '請你36位能夠讓兩個人彼此從陌生到熟悉' },
    ]);
    const result = await r.stop();
    expect(result.transcript).toBe('請你36位能夠讓兩個人彼此從陌生到熟悉');
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

  it('自己結束時還沒定案的那半句不會被丟掉', async () => {
    // 這是實機逐字稿少一半的主因：Android 講完一句就自己結束，
    // 結束當下正在辨識中的半句只存在暫時結果裡
    const store = {};
    const r = createRecognizer({ SpeechRecognition: makeFakeCtor(store), restartDelay: 0 });
    r.start();
    store.instance.emitFinal('這是已經定案的前半句');
    store.instance.emitInterim('這是還沒定案的後半句');
    store.instance.endByItself();

    store.instance.emitFinal('重啟之後繼續講的內容');
    const result = await r.stop();
    expect(result.transcript).toContain('這是已經定案的前半句');
    expect(result.transcript).toContain('這是還沒定案的後半句');
    expect(result.transcript).toContain('重啟之後繼續講的內容');
  });

  it('每次重啟都用新的辨識實例，不重用舊的', async () => {
    const store = {};
    const r = createRecognizer({ SpeechRecognition: makeFakeCtor(store), restartDelay: 0 });
    r.start();
    expect(store.instances).toHaveLength(1);
    store.instance.endByItself();
    expect(store.instances).toHaveLength(2);
    store.instance.endByItself();
    expect(store.instances).toHaveLength(3);
    await r.stop();
  });

  it('重啟失敗會稍後再試，不會就此停擺', async () => {
    // 這是實機第 2 遍只有 35 字/分的主因：
    // 重啟丟例外之後就再也不辨識，使用者照講但一個字都進不來
    const store = {};
    const r = createRecognizer({ SpeechRecognition: makeFakeCtor(store), restartDelay: 0 });
    r.start();
    store.instance.emitFinal('停擺之前講的');

    store.failNextStarts = 2; // 前兩次重啟都失敗
    store.instance.endByItself();
    expect(r.running).toBe(true); // 還在重試，不能當作結束

    await new Promise((resolve) => setTimeout(resolve, 5));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(r.running).toBe(true);

    store.instance.emitFinal('救回來之後繼續講的');
    const result = await r.stop();
    expect(result.transcript).toContain('停擺之前講的');
    expect(result.transcript).toContain('救回來之後繼續講的');
    expect(result.interrupted).toBe(false);
  });

  it('重試很多次都失敗才放棄，並且明講逐字稿不完整', async () => {
    const store = {};
    const r = createRecognizer({ SpeechRecognition: makeFakeCtor(store), restartDelay: 0 });
    r.start();
    store.instance.emitFinal('中斷之前講的內容');

    store.failNextStarts = 99;
    store.instance.endByItself();
    for (let i = 0; i < 15; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }

    const result = await r.stop();
    expect(result.interrupted).toBe(true);
    expect(result.transcript).toBe('中斷之前講的內容');
    // 有內容但不完整，不能默默少一半
    expect(result.needsManualEntry).toBe(false);
    expect(result.notice).toContain('不完整');
    expect(result.notice).toContain('重錄');
  });

  it('辨識已經死掉時按停止不會卡住', async () => {
    const store = {};
    const r = createRecognizer({ SpeechRecognition: makeFakeCtor(store), restartDelay: 0 });
    r.start();
    store.instance.emitFinal('講到一半');
    // 讓 stop() 呼叫 onend 的路斷掉
    store.instance.onend = null;
    store.instance.stop = () => {};
    const result = await Promise.race([
      r.stop(),
      new Promise((resolve) => setTimeout(() => resolve('卡住了'), 2500)),
    ]);
    expect(result).not.toBe('卡住了');
    expect(result.transcript).toBe('講到一半');
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
