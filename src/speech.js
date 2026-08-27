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

/** 判定重疊時至少要這麼多字才算數，太短會把正常的重複用字誤刪 */
const MIN_OVERLAP = 4;

/**
 * 短於這個長度就不當成「已經講過」而丟掉。
 * 講話本來就會重複「然後」「就是」「這個」，
 * 把它們當重複刪掉的話，贅詞數會少算，內容也會缺角。
 */
const MIN_CONTAINED = 5;

/**
 * 把新的一段文字併進已經有的內容，自動去掉重疊的部分。
 *
 * Android Chrome 產生重複的方式有三種，這一個函式全部擋掉：
 * 1. 同一句用新的編號重複送，而且每次更長（「我今天」→「我今天想講」）
 * 2. 自動重啟之後，把剛剛那段話再送一次
 * 3. 前後兩段在交界處重疊幾個字
 *
 * 靠編號判斷擋不住第 1、2 種，所以改成直接比對文字。
 */
export function mergeTranscript(base, addition) {
  const a = base || '';
  const b = (addition || '').trim();
  if (!b) return a;
  if (!a) return b;
  if (b.length >= MIN_CONTAINED && a.includes(b)) return a; // 這一整段已經在裡面了
  if (b.startsWith(a)) return b; // 整句重送而且變長，用新的蓋掉舊的

  // a 的結尾和 b 的開頭有多長的重疊，就從 b 砍掉多長
  const max = Math.min(a.length, b.length);
  for (let len = max; len >= MIN_OVERLAP; len -= 1) {
    if (a.endsWith(b.slice(0, len))) return a + b.slice(len);
  }
  return a + b;
}

/** 出這些錯就不要再自動重啟，重啟只會變成無窮迴圈 */
const FATAL_ERRORS = new Set([
  'not-allowed',
  'service-not-allowed',
  'audio-capture',
  'language-not-supported',
]);

/** 自動重啟的上限。一次練習講幾分鐘也用不到這麼多次 */
const MAX_RESTARTS = 200;

/** 重啟失敗最多再試幾次才放棄。放棄等於這一遍剩下的話全部聽不到，所以給足次數 */
const MAX_RESTART_FAILURES = 8;

/** 重啟失敗後等多久再試（毫秒）。Android 有時候還沒真的把麥克風放掉 */
const RESTART_DELAY = 250;

/** 按下停止之後最多等多久 onend。辨識已經死掉時它不會來 */
const STOP_TIMEOUT = 1500;

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
  let restartFailures = 0;
  let restartTimer = null;
  let interrupted = false;
  let endResolvers = [];
  const restartDelay = options.restartDelay ?? RESTART_DELAY;

  function settleEnd() {
    clearTimeout(restartTimer);
    restartTimer = null;
    running = false;
    const list = endResolvers;
    endResolvers = [];
    for (const fn of list) fn();
  }

  function segmentText() {
    // 用合併而不是直接串接，Android 會把整句用新的編號重複送
    return finals.reduce((acc, text) => mergeTranscript(acc, text), '');
  }

  function currentText() {
    return mergeTranscript(mergeTranscript(committed, segmentText()), interim).trim();
  }

  /**
   * 把這一段的結果收進 committed，準備開下一段。
   *
   * 一定要連 interim 一起收。Android 講完一句就自己結束，
   * 結束當下還在辨識中的那半句只存在 interim 裡，
   * 不收就等於每次重啟都丟掉一個句尾。
   */
  function flushSegment() {
    // 自動重啟之後常常會把剛剛那段再送一次，所以這裡也要合併
    committed = mergeTranscript(mergeTranscript(committed, segmentText()), interim);
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

  /**
   * 開一個新的辨識實例。
   * 每次都用新的，不重用舊的——Android 上太快在同一個實例再呼叫 start()
   * 會丟 InvalidStateError。
   */
  function launch() {
    recognition = attach(new Ctor());
    recognition.start();
  }

  function handleEnd() {
    // Android Chrome 不理會 continuous，講完一句就自己結束。
    // 使用者還沒按停止的話，收好這一段再接著聽下去。
    const fatal = FATAL_ERRORS.has(reason);
    if (stopping || fatal || restarts >= MAX_RESTARTS) {
      settleEnd();
      return;
    }

    flushSegment();
    restarts += 1;
    try {
      launch();
      restartFailures = 0;
      return;
    } catch {
      // 起不來通常是還沒真的釋放，等一下再試。
      // 這裡如果直接放棄，接下來使用者講的每一個字都會消失。
      restartFailures += 1;
      if (restartFailures <= MAX_RESTART_FAILURES) {
        restartTimer = setTimeout(() => {
          if (stopping) return;
          try {
            launch();
            restartFailures = 0;
          } catch {
            handleEnd();
          }
        }, restartDelay);
        return; // 還在重試，這一遍還沒結束
      }
      interrupted = true;
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
    restartFailures = 0;
    interrupted = false;
    try {
      launch();
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
    clearTimeout(restartTimer);
    restartTimer = null;
    if (running && recognition) {
      await new Promise((resolve) => {
        endResolvers.push(resolve);
        // 辨識已經死掉時 onend 不會來，不能無限等下去
        const guard = setTimeout(() => settleEnd(), STOP_TIMEOUT);
        endResolvers.push(() => clearTimeout(guard));
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

    // 有內容但中途died過，逐字稿一定是不完整的，要講出來
    let notice = needsManualEntry ? fallbackNotice(finalReason) : null;
    if (!needsManualEntry && interrupted) {
      notice = '辨識中途停了，這一遍的逐字稿可能不完整。可以自己把漏掉的補上，或按「重錄」重講一次。';
    }

    return {
      transcript,
      needsManualEntry,
      interrupted,
      reason: finalReason,
      notice,
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
    /** 辨識中途死掉、重試也救不回來。這一遍的後半段等於沒錄到 */
    get interrupted() {
      return interrupted;
    },
    get notice() {
      return supported ? null : fallbackNotice('unsupported');
    },
    start,
    stop,
    currentText,
  };
}
