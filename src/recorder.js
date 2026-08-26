/**
 * 錄音模組
 * 負責：開始／停止錄音、正數計時、產生音檔
 * 不負責：語音轉文字、資料保存
 */

export class RecorderError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RecorderError';
    this.code = code;
  }
}

const MESSAGES = {
  'mic-denied': '沒有麥克風權限。請到瀏覽器設定允許這個網站使用麥克風。',
  'mic-missing': '找不到麥克風。請確認裝置有可用的收音裝置。',
  unsupported: '這個瀏覽器不支援錄音。請改用 Chrome。',
  failed: '錄音失敗，請再試一次。',
};

function mapMediaError(err) {
  const name = err && err.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'mic-denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'mic-missing';
  return 'failed';
}

function pickMimeType(MR) {
  const candidates = ['audio/webm', 'audio/mp4', 'audio/ogg'];
  if (!MR || typeof MR.isTypeSupported !== 'function') return undefined;
  return candidates.find((t) => MR.isTypeSupported(t));
}

/**
 * 建立一個錄音器。
 * 相依項目都可以從外面塞進來，方便測試；正式執行時預設用瀏覽器原生的。
 */
export function createRecorder(options = {}) {
  const now = options.now || (() => Date.now());
  const getMedia =
    'getUserMedia' in options
      ? options.getUserMedia
      : (c) => navigator.mediaDevices.getUserMedia(c);
  const MR = 'MediaRecorder' in options ? options.MediaRecorder : globalThis.MediaRecorder;

  let state = 'idle';
  let startedAt = 0;
  let stream = null;
  let recorder = null;
  let chunks = [];

  function releaseStream() {
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      stream = null;
    }
  }

  async function start() {
    if (state === 'recording') return;
    if (!getMedia || !MR) {
      throw new RecorderError('unsupported', MESSAGES.unsupported);
    }
    try {
      stream = await getMedia({ audio: true });
    } catch (err) {
      const code = mapMediaError(err);
      throw new RecorderError(code, MESSAGES[code]);
    }
    try {
      const mimeType = pickMimeType(MR);
      recorder = new MR(stream, mimeType ? { mimeType } : {});
      chunks = [];
      recorder.ondataavailable = (e) => {
        if (e.data && (e.data.size === undefined || e.data.size > 0)) chunks.push(e.data);
      };
      recorder.start();
    } catch (err) {
      releaseStream();
      throw new RecorderError('failed', MESSAGES.failed);
    }
    startedAt = now();
    state = 'recording';
  }

  /** 正數計時：從開始錄音到現在過了幾秒 */
  function elapsedSeconds() {
    if (state !== 'recording') return 0;
    return Math.floor((now() - startedAt) / 1000);
  }

  async function stop() {
    if (state !== 'recording') {
      return { seconds: 0, audio: null, audioType: null };
    }
    const seconds = Math.round((now() - startedAt) / 1000);
    const type = (recorder && recorder.mimeType) || 'audio/webm';
    await new Promise((resolve) => {
      recorder.onstop = () => resolve();
      try {
        recorder.stop();
      } catch {
        resolve();
      }
    });
    releaseStream();
    state = 'idle';
    let audio = null;
    if (chunks.length) {
      const blob = new Blob(chunks, { type });
      audio = await blob.arrayBuffer();
    }
    recorder = null;
    chunks = [];
    return { seconds, audio, audioType: audio ? type : null };
  }

  return {
    get state() {
      return state;
    },
    start,
    stop,
    elapsedSeconds,
  };
}
