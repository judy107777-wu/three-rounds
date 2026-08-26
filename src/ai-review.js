/**
 * AI 模組
 * 負責：組提示詞、呼叫 Gemini、解析回傳、錯誤處理
 * 不負責：計算數據、決定何時呼叫
 *
 * 這是整個 APP 唯一會連外的地方。
 */

export const GEMINI_MODEL = 'gemini-3.6-flash';
export const GEMINI_ENDPOINT =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

/** 回覆總字數上限 */
export const MAX_REPLY_CHARS = 500;

/**
 * 固定約束（CLAUDE.md「AI 提示詞的固定約束」）。
 * 缺一即為錯誤，所以獨立成常數，由測試逐一驗。
 */
export const PROMPT_CONSTRAINTS = [
  '逐字稿由語音辨識產生，有錯字且無標點。忽略錯字與標點，只評內容與結構。',
  '不給分數、不給等第、不給鼓勵性評語。',
  '不改寫、不代寫、不產生範例講稿。',
  '引用具體建議時，只能引用使用者自己在前幾遍說過的原話。',
  `回覆總字數上限 ${MAX_REPLY_CHARS} 字。`,
];

/** 四項輸出的固定順序與標題（不得增減） */
export const REVIEW_SECTIONS = [
  { key: 'rescue', title: '該救回的' },
  { key: 'cut', title: '該刪但還留著的' },
  { key: 'newContent', title: '第 2、3 遍才冒出的新內容' },
  { key: 'conclusion', title: '結論位置' },
];

/** 該救回的上限 2 項 */
export const MAX_RESCUE_ITEMS = 2;

const ERROR_MESSAGES = {
  'no-key': '還沒有設定 Gemini 金鑰。請先到設定頁貼上金鑰。',
  offline: '目前沒有網路。AI 檢查需要連網，等有網路再按一次。',
  network: '連不上 Gemini，稍後再試。這次練習的資料都還在。',
  apikey: '金鑰被拒絕了。請到設定頁檢查金鑰是否正確。',
  'rate-limit': '今天的免費額度用完了，稍後再試。這次練習的資料都還在。',
  'bad-response': 'AI 回傳的內容看不懂，稍後再試。這次練習的資料都還在。',
  failed: 'AI 檢查失敗，稍後再試。這次練習的資料都還在。',
};

export function reviewErrorMessage(code) {
  return ERROR_MESSAGES[code] || ERROR_MESSAGES.failed;
}

/** Gemini 回的錯誤訊息可能很長，截一段就夠看出原因 */
function trim(text, max = 200) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/**
 * 組一個失敗結果。
 * 把 HTTP 狀態與 Gemini 自己說的原因一起帶出來——
 * 只給一句「檢查失敗」等於什麼都沒說，查不下去。
 */
function failure(code, { status = null, detail = '' } = {}) {
  const extra = [];
  if (status) extra.push(`HTTP ${status}`);
  if (detail) extra.push(trim(detail));
  const message = extra.length
    ? `${reviewErrorMessage(code)}（${extra.join('｜')}）`
    : reviewErrorMessage(code);
  return { ok: false, code, status, detail: detail ? trim(detail) : null, message };
}

/** 從 Gemini 的錯誤主體挖出它自己寫的原因 */
async function readErrorDetail(response) {
  if (!response || typeof response.json !== 'function') return '';
  try {
    const body = await response.json();
    return (body && body.error && body.error.message) || '';
  } catch {
    return '';
  }
}

const OUTPUT_SPEC = `請只輸出以下四項，順序固定，不得增減：
1. 該救回的：第 1 或第 2 遍講過、但第 3 遍消失的重點。上限 ${MAX_RESCUE_ITEMS} 項，每項附一句理由。
2. 該刪但還留著的：第 3 遍中仍屬鋪陳、重複或空話的句子。
3. 第 2、3 遍才冒出的新內容：標出來讓使用者自行判斷是好東西還是離題，不要替他判斷。
4. 結論位置：第 3 遍的第一句是不是結論。不是的話，指出哪一句該提前。`;

const RESPONSE_SCHEMA = {
  // 型別名稱用大寫。Gemini 的 responseSchema 是 OpenAPI 子集，
  // 文件寫的就是 OBJECT／ARRAY／STRING，小寫有可能被退件。
  type: 'OBJECT',
  properties: {
    rescue: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { point: { type: 'STRING' }, reason: { type: 'STRING' } },
        required: ['point', 'reason'],
      },
    },
    cut: { type: 'ARRAY', items: { type: 'STRING' } },
    newContent: { type: 'ARRAY', items: { type: 'STRING' } },
    conclusion: {
      type: 'OBJECT',
      properties: {
        isFirstSentence: { type: 'BOOLEAN' },
        note: { type: 'STRING' },
      },
      required: ['isFirstSentence', 'note'],
    },
  },
  required: ['rescue', 'cut', 'newContent', 'conclusion'],
};

/**
 * 把三遍逐字稿整包組成提示詞。
 * 整包送：三遍加起來約一千餘字，資料量小，全部送最準，不需要挑段落。
 */
export function buildPrompt(rounds = []) {
  const transcripts = rounds
    .map((r, i) => `【第 ${r.index || i + 1} 遍｜${r.seconds || 0} 秒】\n${r.transcript || '（這一遍沒有逐字稿）'}`)
    .join('\n\n');

  return [
    '你在協助一個人練習「同一個主題連續講三遍、每一遍講得更精煉」。',
    '以下是他三遍的逐字稿，請做一次比對檢查。',
    '',
    '限制條件（全部都要遵守）：',
    ...PROMPT_CONSTRAINTS.map((c, i) => `${i + 1}. ${c}`),
    '',
    OUTPUT_SPEC,
    '',
    '三遍逐字稿如下：',
    '',
    transcripts,
  ].join('\n');
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === '') return [];
  return [value];
}

function textOf(item) {
  if (typeof item === 'string') return item.trim();
  if (item && typeof item === 'object') return String(item.text || item.point || '').trim();
  return '';
}

/** 把 Gemini 回傳的物件整理成畫面能直接用的四個區塊 */
export function normalizeReview(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const rescue = asArray(raw.rescue)
    .map((item) =>
      typeof item === 'string'
        ? { point: item.trim(), reason: '' }
        : { point: String(item.point || '').trim(), reason: String(item.reason || '').trim() },
    )
    .filter((item) => item.point)
    .slice(0, MAX_RESCUE_ITEMS);

  const conclusionRaw = raw.conclusion || {};
  return {
    rescue,
    cut: asArray(raw.cut).map(textOf).filter(Boolean),
    newContent: asArray(raw.newContent).map(textOf).filter(Boolean),
    conclusion: {
      isFirstSentence: !!conclusionRaw.isFirstSentence,
      note: String(conclusionRaw.note || '').trim(),
    },
  };
}

/** 從 Gemini 的回應主體挖出文字 */
function extractText(body) {
  const parts = body?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts.map((p) => p.text || '').join('');
}

/** 解析回傳文字。允許外面包著 ```json 之類的雜訊。 */
export function parseReviewText(text) {
  if (!text) return null;
  const trimmed = String(text).trim();
  const candidates = [trimmed];
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) candidates.push(fenced[1].trim());
  const braced = trimmed.match(/\{[\s\S]*\}/);
  if (braced) candidates.push(braced[0]);

  for (const c of candidates) {
    try {
      return normalizeReview(JSON.parse(c));
    } catch {
      // 換下一種寫法再試
    }
  }
  return null;
}

function statusToCode(status) {
  if (status === 400 || status === 401 || status === 403) return 'apikey';
  if (status === 429) return 'rate-limit';
  return 'failed';
}

/**
 * 送出 AI 檢查。
 * 任何失敗都只回傳錯誤碼與訊息，不丟例外、不動已存的資料。
 *
 * @param {{rounds:Array, apiKey:string, fetch?:Function, online?:boolean, signal?:AbortSignal}} options
 * @returns {Promise<{ok:boolean, review?:object, code?:string, message?:string}>}
 */
export async function requestReview(options = {}) {
  const { rounds = [], apiKey = '', signal } = options;
  const doFetch = options.fetch || globalThis.fetch;
  const online = options.online !== undefined ? options.online : globalThis.navigator?.onLine !== false;

  if (!apiKey.trim()) {
    return failure('no-key');
  }
  if (!online) {
    return failure('offline');
  }
  if (typeof doFetch !== 'function') {
    return failure('failed');
  }

  const prompt = buildPrompt(rounds);
  let response;
  try {
    response = await doFetch(GEMINI_ENDPOINT, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        // 金鑰放標頭，不放網址，避免留在紀錄或分享的連結裡
        'x-goog-api-key': apiKey.trim(),
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
    });
  } catch (err) {
    return failure('network', { detail: err && err.message });
  }

  if (!response || !response.ok) {
    const status = response ? response.status : 0;
    const detail = await readErrorDetail(response);
    // 把實際呼叫的模型印出來。手機上常常有舊分頁跑著舊程式，
    // 錯誤訊息裡有模型名稱，就不用猜這一頁到底是新版還是舊版。
    return failure(statusToCode(status), { status, detail: `模型 ${GEMINI_MODEL}｜${detail}` });
  }

  let body;
  try {
    body = await response.json();
  } catch {
    return failure('bad-response', { status: response.status });
  }

  const text = extractText(body);
  const review = parseReviewText(text);
  if (!review) {
    // 常見於被安全設定擋下或講到一半被截斷，把原因一起帶出來
    const finish = body?.candidates?.[0]?.finishReason;
    const blocked = body?.promptFeedback?.blockReason;
    const detail = [blocked && `blockReason=${blocked}`, finish && `finishReason=${finish}`, trim(text, 80)]
      .filter(Boolean)
      .join(' ');
    return failure('bad-response', { status: response.status, detail });
  }
  return { ok: true, review };
}

const MODELS_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * AI Studio 發的金鑰一律是 AIza 開頭。
 * 不硬性擋下來（格式以後可能會變），但可以在出錯時多講一句。
 */
export function looksLikeApiKey(key) {
  return /^AIza[0-9A-Za-z_-]{20,}$/.test(String(key || '').trim());
}

const KEY_FORMAT_HINT =
  ' 另外，這串不像 AI Studio 的金鑰——正常是 AIza 開頭的 39 個字。請到 aistudio.google.com/apikey 按 Create API key 重新拿一把。';

/**
 * 問 Gemini 這把金鑰現在能用哪些模型。
 * 模型會被下架（2.5 Flash 就是這樣沒的），失敗時直接把可用清單講出來，
 * 比讓人回頭查文件快得多。查不到就回空字串，不影響原本的錯誤訊息。
 */
async function listUsableModels(doFetch, apiKey, signal) {
  try {
    const response = await doFetch(MODELS_ENDPOINT, {
      method: 'GET',
      signal,
      headers: { 'x-goog-api-key': apiKey },
    });
    if (!response || !response.ok || typeof response.json !== 'function') return '';
    const body = await response.json();
    const names = (body.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => String(m.name || '').replace('models/', ''))
      .filter((n) => n.includes('flash'));
    return names.length ? names.slice(0, 6).join('、') : '';
  } catch {
    return '';
  }
}

/**
 * 只確認金鑰通不通，不做完整檢查。
 * 讓使用者在設定頁就能驗，不用先講完三遍才知道金鑰是壞的。
 */
export async function testApiKey(options = {}) {
  const { apiKey = '', signal } = options;
  const doFetch = options.fetch || globalThis.fetch;
  const online = options.online !== undefined ? options.online : globalThis.navigator?.onLine !== false;

  if (!apiKey.trim()) return failure('no-key');
  if (!online) return failure('offline');
  if (typeof doFetch !== 'function') return failure('failed');

  let response;
  try {
    response = await doFetch(GEMINI_ENDPOINT, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey.trim(),
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: '回覆「OK」兩個字就好。' }] }],
      }),
    });
  } catch (err) {
    return failure('network', { detail: err && err.message });
  }

  if (!response || !response.ok) {
    const status = response ? response.status : 0;
    const detail = await readErrorDetail(response);
    const usable = await listUsableModels(doFetch, apiKey.trim(), signal);
    const result = failure(statusToCode(status), { status, detail });
    if (usable) {
      result.usableModels = usable;
      result.message += ` 這把金鑰目前可用的模型：${usable}`;
    }
    if (!looksLikeApiKey(apiKey)) {
      result.badKeyFormat = true;
      result.message += KEY_FORMAT_HINT;
    }
    return result;
  }
  return { ok: true, message: `金鑰可以用（${GEMINI_MODEL}）` };
}
