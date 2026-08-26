/**
 * 辨識模組
 * 負責：即時語音轉文字、斷網偵測與標記
 * 不負責：錄音、修正錯字、計算數據
 *
 * 已知限制（不是 bug）：斷網時逐字稿會是空的，由使用者事後手動補字。
 *
 * Android Chrome 的兩個實測行為，這個模組必須自己扛：
 * 1. continuous 沒有作用。講完一句就自己 onend，所以要自動接著再開。
 * 2. 同一個結果會重複回傳、而且每次變長。所以依 index 覆寫，不能往後接。
 */

export const RECOGNITION_LANG = 'zh-TW';

/** 出這些錯就不要再自動重啟，重啟只會變成無窮迴圈 */
const FATAL_ERRORS = new Set([
  'not-allowed',
  'service-not-allowed',
  'audio-capture',
  'language-not-supported',
]);

/** 自動重啟的上限。一次練習講幾分鐘也用不到這麼多次 */
const MAX_RESTARTS = 200;

const NOTICES = {
  unsupported: '這個瀏覽器不支援語音辨識，這一遍只會留下錄音。停止後可以自己把內容打上去。',
  network: '辨識過程沒有連上網路，這一遍的逐字稿是空的。停止後可以自己把內容補上。',
  'not-allowed': '沒有麥克風權限，這一遍無法辨識。停止後可以自己把內容補上。',
  'service-not-allowed': '瀏覽器擋掉了語音辨識服務，這一遍的逐字稿是空的。停止後可以自己把內容補上。',
  'audio-capture': '辨識抓不到麥克風，可能是被錄音佔住了。這一遍的逐字稿是空的，可以自己把內容補上。',
  'language-not-supported': '這台裝置沒有中文辨識，這一遍的逐字稿是空的。停止後可以自己把內容補上。',
  aborted: '辨識被中斷了，這一遍的逐字稿是空的。可以自己把內容補上。',
  'no-speech': '沒有聽到聲音，這一遍的逐字稿是空的。停止後可以自己把內容補上。',
  failed: '辨識中斷，這一遍的逐字稿可能不完整。可以自己把內容補上。',
};

/**
 * 給畫面用的降級提示文字。
 * 後面附上原始代碼——第一版還在抓問題，出事時看得到代碼才查得下去。
 */
export function fallbackNotice(reason) {
  const text = NOTICES[reason] || NOTICES.failed;
  return reason && reason !== 'unsupported' ? `${text}（代碼：${reason}）` : text;
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
  // committed：先前幾段（自動重啟之前）已經定案的文字
  // finals：這一段裡依 index 放的定案文字，同一個 index 再來就覆寫
  let committed = '';
  let finals = [];
  let interim = '';
  let reason = null;
  let running = false;
  let stopping = false;
  let restarts = 0;
  let endResolvers = [];

  function settleEnd() {
    running = false;
    const list = endResolvers;
    endResolvers = [];
    for (const fn of list) fn();
  }

  function segmentText() {
    return finals.join('');
  }

  function currentText() {
    return (committed + segmentText() + interim).trim();
  }

  /** 把這一段的結果收進 committed，準備開下一段 */
  function flushSegment() {
    committed += segmentText();
    finals = [];
    interim = '';
  }

  function handleResult(event) {
    // 每次都從頭重建這一段的內容。
    // Android 會把整句重複送成「確定」而且愈送愈長，往後接就會變成重複的字。
    interim = '';
    const next = [];
    for (let i = 0; i < event.results.length; i += 1) {
      const result = event.results[i];
      const text = result[0] ? result[0].transcript : '';
      if (result.isFinal) {
        // 有內容才覆寫。Android 會夾雜空的確定結果，照單全收會把已經聽到的洗掉。
        next[i] = text || finals[i] || '';
      } else {
        interim += text;
      }
    }
    // 這一次沒提到的 index 保留原值
    for (let i = 0; i < finals.length; i += 1) {
      if (next[i] === undefined) next[i] = finals[i];
    }
    finals = next.map((t) => t || '');
    onUpdate(currentText(), interim === '');
  }

  function attach(instance) {
    instance.lang = options.lang || RECOGNITION_LANG;
    instance.continuous = true;
    instance.interimResults = true;
    instance.onresult = handleResult;
    instance.onerror = (e) => {
      // no-speech 只是這一段沒聽到聲音，之後可能還有；不要蓋掉更嚴重的原因
      const code = (e && e.error) || 'failed';
      if (!reason || reason === 'no-speech') reason = code;
    };
    instance.onend = handleEnd;
    return instance;
  }

  function handleEnd() {
    // Android Chrome 不理會 continuous，講完一句就自己結束。
    // 使用者還沒按停止的話，收好這一段再接著聽下去。
    const fatal = FATAL_ERRORS.has(reason);
    if (!stopping && !fatal && restarts < MAX_RESTARTS) {
      flushSegment();
      restarts += 1;
      try {
        recognition.start();
        return;
      } catch {
        // 起不來就往下收尾
      }
    }
    settleEnd();
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
    committed = '';
    finals = [];
    interim = '';
    reason = null;
    stopping = false;
    restarts = 0;
    recognition = attach(new Ctor());
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
    stopping = true;
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
    get restarts() {
      return restarts;
    },
    get notice() {
      return supported ? null : fallbackNotice('unsupported');
    },
    start,
    stop,
    currentText,
  };
}
