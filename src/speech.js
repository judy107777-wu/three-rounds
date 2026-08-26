/**
 * 辨識模組
 * 負責：即時語音轉文字、斷網偵測與標記
 * 不負責：錄音、修正錯字、計算數據
 *
 * 已知限制（不是 bug）：斷網時逐字稿會是空的，由使用者事後手動補字。
 */

export const RECOGNITION_LANG = 'zh-TW';

const NOTICES = {
  unsupported: '這個瀏覽器不支援語音辨識，這一遍只會留下錄音。停止後可以自己把內容打上去。',
  network: '辨識過程沒有連上網路，這一遍的逐字稿是空的。停止後可以自己把內容補上。',
  'not-allowed': '沒有麥克風權限，這一遍無法辨識。停止後可以自己把內容補上。',
  'no-speech': '沒有聽到聲音，這一遍的逐字稿是空的。停止後可以自己把內容補上。',
  failed: '辨識中斷，這一遍的逐字稿可能不完整。可以自己把內容補上。',
};

/** 給畫面用的降級提示文字 */
export function fallbackNotice(reason) {
  return NOTICES[reason] || NOTICES.failed;
}

function resolveConstructor(options) {
  if ('SpeechRecognition' in options) return options.SpeechRecognition;
  return globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition || null;
}

/**
 * 建立一個辨識器。
 * @param {object} options
 *   options.SpeechRecognition 可注入，測試用；不給就用瀏覽器原生的
 *   options.onUpdate(text, isFinal) 每次有新結果就呼叫，給畫面即時顯示
 */
export function createRecognizer(options = {}) {
  const Ctor = resolveConstructor(options);
  const onUpdate = options.onUpdate || (() => {});
  const supported = typeof Ctor === 'function';

  let recognition = null;
  let finals = [];
  let interim = '';
  let reason = null;
  let running = false;
  let endResolvers = [];

  function settleEnd() {
    running = false;
    const list = endResolvers;
    endResolvers = [];
    for (const fn of list) fn();
  }

  function handleResult(event) {
    // event.results 是累積的清單，從 resultIndex 開始才是這次新增的
    interim = '';
    const from = typeof event.resultIndex === 'number' ? event.resultIndex : 0;
    for (let i = from; i < event.results.length; i += 1) {
      const result = event.results[i];
      const text = result[0] ? result[0].transcript : '';
      if (result.isFinal) {
        finals.push(text);
      } else {
        interim += text;
      }
    }
    onUpdate(currentText(), interim === '');
  }

  function currentText() {
    return (finals.join('') + interim).trim();
  }

  /**
   * 開始辨識。不支援時回傳 false，不丟例外——
   * 錄音還是要能繼續，逐字稿之後手動補。
   */
  function start() {
    if (!supported) {
      reason = 'unsupported';
      return false;
    }
    if (running) return true;
    finals = [];
    interim = '';
    reason = null;
    recognition = new Ctor();
    recognition.lang = options.lang || RECOGNITION_LANG;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = handleResult;
    recognition.onerror = (e) => {
      // no-speech 只是這一段沒聽到聲音，之後可能還有；不要覆蓋掉更嚴重的原因
      const code = (e && e.error) || 'failed';
      if (!reason || reason === 'no-speech') reason = code;
    };
    recognition.onend = () => settleEnd();
    try {
      recognition.start();
    } catch {
      reason = 'failed';
      running = false;
      return false;
    }
    running = true;
    return true;
  }

  /**
   * 停止並取回結果。
   * @returns {Promise<{transcript:string, needsManualEntry:boolean, reason:string|null, notice:string|null}>}
   */
  async function stop() {
    if (running && recognition) {
      await new Promise((resolve) => {
        endResolvers.push(resolve);
        try {
          recognition.stop();
        } catch {
          settleEnd();
        }
      });
    }
    running = false;
    const transcript = currentText();
    // 逐字稿是空的就標記待補字，不管是斷網、沒權限還是沒說話
    const needsManualEntry = transcript === '';
    const finalReason = needsManualEntry ? reason || 'no-speech' : null;
    recognition = null;
    return {
      transcript,
      needsManualEntry,
      reason: finalReason,
      notice: needsManualEntry ? fallbackNotice(finalReason) : null,
    };
  }

  return {
    supported,
    get running() {
      return running;
    },
    get notice() {
      return supported ? null : fallbackNotice('unsupported');
    },
    start,
    stop,
    currentText,
  };
}
