/**
 * AI 模組
 * 負責：組提示詞、呼叫 Gemini、解析回傳、錯誤處理
 * 不負責：計算數據、決定何時呼叫
 *
 * 這是整個 APP 唯一會連外的地方。
 */

export const GEMINI_MODEL = 'gemini-2.5-flash';
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

const OUTPUT_SPEC = `請只輸出以下四項，順序固定，不得增減：
1. 該救回的：第 1 或第 2 遍講過、但第 3 遍消失的重點。上限 ${MAX_RESCUE_ITEMS} 項，每項附一句理由。
2. 該刪但還留著的：第 3 遍中仍屬鋪陳、重複或空話的句子。
3. 第 2、3 遍才冒出的新內容：標出來讓使用者自行判斷是好東西還是離題，不要替他判斷。
4. 結論位置：第 3 遍的第一句是不是結論。不是的話，指出哪一句該提前。`;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    rescue: {
      type: 'array',
      items: {
        type: 'object',
        properties: { point: { type: 'string' }, reason: { type: 'string' } },
        required: ['point', 'reason'],
      },
    },
    cut: { type: 'array', items: { type: 'string' } },
    newContent: { type: 'array', items: { type: 'string' } },
    conclusion: {
      type: 'object',
      properties: {
        isFirstSentence: { type: 'boolean' },
        note: { type: 'string' },
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
    return { ok: false, code: 'no-key', message: reviewErrorMessage('no-key') };
  }
  if (!online) {
    return { ok: false, code: 'offline', message: reviewErrorMessage('offline') };
  }
  if (typeof doFetch !== 'function') {
    return { ok: false, code: 'failed', message: reviewErrorMessage('failed') };
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
  } catch {
    return { ok: false, code: 'network', message: reviewErrorMessage('network') };
  }

  if (!response || !response.ok) {
    const code = statusToCode(response ? response.status : 0);
    return { ok: false, code, message: reviewErrorMessage(code) };
  }

  let body;
  try {
    body = await response.json();
  } catch {
    return { ok: false, code: 'bad-response', message: reviewErrorMessage('bad-response') };
  }

  const review = parseReviewText(extractText(body));
  if (!review) {
    return { ok: false, code: 'bad-response', message: reviewErrorMessage('bad-response') };
  }
  return { ok: true, review };
}
