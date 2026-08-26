import { describe, it, expect, vi } from 'vitest';
import {
  buildPrompt, parseReviewText, requestReview, testApiKey, reviewErrorMessage,
  PROMPT_CONSTRAINTS, REVIEW_SECTIONS, MAX_RESCUE_ITEMS, MAX_REPLY_CHARS,
  GEMINI_MODEL, GEMINI_ENDPOINT,
} from '../src/ai-review.js';
import { ROUND1, ROUND2, ROUND3 } from './fixtures/transcripts.js';

const ROUNDS = [
  { index: 1, seconds: 180, transcript: ROUND1 },
  { index: 2, seconds: 130, transcript: ROUND2 },
  { index: 3, seconds: 95, transcript: ROUND3 },
];

const GOOD_REVIEW = {
  rescue: [
    { point: '第 1 遍講的手機放另一個房間的細節', reason: '第 3 遍只剩結論，少了做法' },
    { point: '前五天最痛苦這段', reason: '這是唯一能讓人有共鳴的過程' },
  ],
  cut: ['我今天要講的重點是'],
  newContent: ['備課時間從兩個小時掉到一個小時十五分'],
  conclusion: { isFirstSentence: true, note: '第一句已經是結論' },
};

function jsonResponse(obj, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: () =>
      Promise.resolve({
        candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }],
      }),
  };
}

describe('T13 AI 檢查模組：提示詞', () => {
  it('用 Gemini 2.5 Flash', () => {
    expect(GEMINI_MODEL).toBe('gemini-2.5-flash');
    expect(GEMINI_ENDPOINT).toContain('gemini-2.5-flash');
  });

  it('固定約束剛好五項', () => {
    expect(PROMPT_CONSTRAINTS).toHaveLength(5);
  });

  it('提示詞包含全部五項固定約束，逐一驗', () => {
    const prompt = buildPrompt(ROUNDS);
    for (const constraint of PROMPT_CONSTRAINTS) {
      expect(prompt, constraint).toContain(constraint);
    }
  });

  it('約束一：說明逐字稿有錯字無標點，只評內容與結構', () => {
    const prompt = buildPrompt(ROUNDS);
    expect(prompt).toContain('語音辨識');
    expect(prompt).toContain('忽略錯字與標點');
    expect(prompt).toContain('只評內容與結構');
  });

  it('約束二：不給分數、等第、鼓勵性評語', () => {
    const prompt = buildPrompt(ROUNDS);
    expect(prompt).toContain('不給分數');
    expect(prompt).toContain('不給等第');
    expect(prompt).toContain('不給鼓勵性評語');
  });

  it('約束三：不改寫、不代寫、不產生範例講稿', () => {
    const prompt = buildPrompt(ROUNDS);
    expect(prompt).toContain('不改寫');
    expect(prompt).toContain('不代寫');
    expect(prompt).toContain('不產生範例講稿');
  });

  it('約束四：只能引用使用者自己說過的原話', () => {
    expect(buildPrompt(ROUNDS)).toContain('只能引用使用者自己在前幾遍說過的原話');
  });

  it('約束五：回覆總字數上限 500 字', () => {
    expect(MAX_REPLY_CHARS).toBe(500);
    expect(buildPrompt(ROUNDS)).toContain('回覆總字數上限 500 字');
  });

  it('提示詞要求四項輸出，順序固定不得增減', () => {
    const prompt = buildPrompt(ROUNDS);
    expect(REVIEW_SECTIONS.map((s) => s.key)).toEqual(['rescue', 'cut', 'newContent', 'conclusion']);
    expect(prompt).toContain('該救回的');
    expect(prompt).toContain('該刪但還留著的');
    expect(prompt).toContain('新內容');
    expect(prompt).toContain('結論位置');
    expect(prompt).toContain('不得增減');
  });

  it('該救回的上限 2 項，並要求附理由', () => {
    expect(MAX_RESCUE_ITEMS).toBe(2);
    expect(buildPrompt(ROUNDS)).toContain('上限 2 項');
    expect(buildPrompt(ROUNDS)).toContain('附一句理由');
  });

  it('三遍逐字稿整包送出，一段都不漏', () => {
    const prompt = buildPrompt(ROUNDS);
    expect(prompt).toContain(ROUND1);
    expect(prompt).toContain(ROUND2);
    expect(prompt).toContain(ROUND3);
    expect(prompt).toContain('第 1 遍');
    expect(prompt).toContain('第 3 遍');
  });

  it('某一遍沒有逐字稿時也組得出提示詞', () => {
    const prompt = buildPrompt([{ index: 1, seconds: 100, transcript: '' }]);
    expect(prompt).toContain('沒有逐字稿');
  });
});

describe('T13 AI 檢查模組：解析回傳', () => {
  it('正確解析成四個區塊', () => {
    const review = parseReviewText(JSON.stringify(GOOD_REVIEW));
    expect(Object.keys(review).sort()).toEqual(['conclusion', 'cut', 'newContent', 'rescue']);
    expect(review.rescue).toHaveLength(2);
    expect(review.rescue[0].reason).toContain('第 3 遍');
    expect(review.cut).toEqual(['我今天要講的重點是']);
    expect(review.newContent).toHaveLength(1);
    expect(review.conclusion.isFirstSentence).toBe(true);
  });

  it('回傳被 ```json 包起來也解析得出來', () => {
    const review = parseReviewText('```json\n' + JSON.stringify(GOOD_REVIEW) + '\n```');
    expect(review.rescue).toHaveLength(2);
  });

  it('該救回的超過 2 項時只留前 2 項', () => {
    const review = parseReviewText(
      JSON.stringify({ ...GOOD_REVIEW, rescue: [...GOOD_REVIEW.rescue, { point: '第三項', reason: '理由' }] }),
    );
    expect(review.rescue).toHaveLength(2);
  });

  it('四個區塊都空的也是合法回傳', () => {
    const review = parseReviewText(
      JSON.stringify({ rescue: [], cut: [], newContent: [], conclusion: { isFirstSentence: false, note: '' } }),
    );
    expect(review.rescue).toEqual([]);
    expect(review.conclusion.isFirstSentence).toBe(false);
  });

  it('看不懂的回傳解析為 null，不丟例外', () => {
    expect(parseReviewText('這不是 JSON')).toBeNull();
    expect(parseReviewText('')).toBeNull();
    expect(parseReviewText(null)).toBeNull();
  });
});

describe('T13 AI 檢查模組：呼叫與錯誤處理', () => {
  it('成功時回傳四個區塊', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(GOOD_REVIEW)));
    const result = await requestReview({ rounds: ROUNDS, apiKey: 'KEY', fetch: fetchMock, online: true });
    expect(result.ok).toBe(true);
    expect(result.review.rescue).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('金鑰放在標頭，不放在網址', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(GOOD_REVIEW)));
    await requestReview({ rounds: ROUNDS, apiKey: 'SECRET-KEY', fetch: fetchMock, online: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).not.toContain('SECRET-KEY');
    expect(init.headers['x-goog-api-key']).toBe('SECRET-KEY');
  });

  it('沒有金鑰時提示先去設定，而且完全不呼叫外部服務', async () => {
    const fetchMock = vi.fn();
    const result = await requestReview({ rounds: ROUNDS, apiKey: '', fetch: fetchMock, online: true });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('no-key');
    expect(result.message).toContain('設定');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('離線時提示需連網，而且不呼叫外部服務', async () => {
    const fetchMock = vi.fn();
    const result = await requestReview({ rounds: ROUNDS, apiKey: 'KEY', fetch: fetchMock, online: false });
    expect(result.code).toBe('offline');
    expect(result.message).toContain('網路');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('斷網：顯示稍後再試，不丟例外', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    const result = await requestReview({ rounds: ROUNDS, apiKey: 'KEY', fetch: fetchMock, online: true });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('network');
    expect(result.message).toContain('稍後再試');
  });

  it('金鑰錯誤：提示去設定頁檢查', async () => {
    for (const status of [400, 401, 403]) {
      const fetchMock = vi.fn(() => Promise.resolve({ ok: false, status }));
      const result = await requestReview({ rounds: ROUNDS, apiKey: 'BAD', fetch: fetchMock, online: true });
      expect(result.code, String(status)).toBe('apikey');
      expect(result.message).toContain('設定頁');
    }
  });

  it('額度用完：有專屬提示', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: false, status: 429 }));
    const result = await requestReview({ rounds: ROUNDS, apiKey: 'KEY', fetch: fetchMock, online: true });
    expect(result.code).toBe('rate-limit');
  });

  it('回傳看不懂：提示稍後再試，資料不受影響', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ candidates: [{ content: { parts: [{ text: '亂七八糟' }] } }] }),
      }),
    );
    const result = await requestReview({ rounds: ROUNDS, apiKey: 'KEY', fetch: fetchMock, online: true });
    expect(result.code).toBe('bad-response');
  });

  it('回傳格式的型別名稱用大寫，符合 Gemini 的 responseSchema', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(GOOD_REVIEW)));
    await requestReview({ rounds: ROUNDS, apiKey: 'KEY', fetch: fetchMock, online: true });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const schema = body.generationConfig.responseSchema;
    expect(schema.type).toBe('OBJECT');
    expect(schema.properties.cut.type).toBe('ARRAY');
    expect(schema.properties.cut.items.type).toBe('STRING');
    expect(schema.properties.conclusion.properties.isFirstSentence.type).toBe('BOOLEAN');
  });

  it('失敗時把 HTTP 狀態與 Gemini 自己說的原因一起帶出來', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: { code: 404, message: 'models/gemini-2.5-flash is not found' } }),
      }),
    );
    const result = await requestReview({ rounds: ROUNDS, apiKey: 'KEY', fetch: fetchMock, online: true });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
    expect(result.detail).toContain('not found');
    expect(result.message).toContain('HTTP 404');
    expect(result.message).toContain('not found');
  });

  it('錯誤主體讀不出來也不會炸掉，至少留下狀態碼', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: false, status: 503 }));
    const result = await requestReview({ rounds: ROUNDS, apiKey: 'KEY', fetch: fetchMock, online: true });
    expect(result.code).toBe('failed');
    expect(result.message).toContain('HTTP 503');
  });

  it('被安全設定擋下時，把 blockReason 帶出來', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ promptFeedback: { blockReason: 'SAFETY' }, candidates: [] }),
      }),
    );
    const result = await requestReview({ rounds: ROUNDS, apiKey: 'KEY', fetch: fetchMock, online: true });
    expect(result.code).toBe('bad-response');
    expect(result.message).toContain('SAFETY');
  });

  it('每個錯誤碼都有給使用者看的話', () => {
    for (const code of ['no-key', 'offline', 'network', 'apikey', 'rate-limit', 'bad-response', 'failed']) {
      expect(reviewErrorMessage(code), code).toBeTruthy();
    }
    expect(reviewErrorMessage('沒看過的碼')).toBe(reviewErrorMessage('failed'));
  });
});

describe('T13 AI 檢查模組：測試金鑰', () => {
  it('金鑰可用時回報成功，而且不需要先講完三遍', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }),
    );
    const result = await testApiKey({ apiKey: 'KEY', fetch: fetchMock, online: true });
    expect(result.ok).toBe(true);
    expect(result.message).toContain('可以用');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('測試金鑰同樣把金鑰放標頭，不放網址', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }),
    );
    await testApiKey({ apiKey: 'SECRET-KEY', fetch: fetchMock, online: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).not.toContain('SECRET-KEY');
    expect(init.headers['x-goog-api-key']).toBe('SECRET-KEY');
  });

  it('金鑰壞掉時把 Gemini 說的原因原封不動帶出來', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: { message: 'API key not valid. Please pass a valid API key.' } }),
      }),
    );
    const result = await testApiKey({ apiKey: 'BAD', fetch: fetchMock, online: true });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('API key not valid');
    expect(result.message).toContain('HTTP 400');
  });

  it('沒有金鑰就不連外', async () => {
    const fetchMock = vi.fn();
    const result = await testApiKey({ apiKey: '', fetch: fetchMock, online: true });
    expect(result.code).toBe('no-key');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('測試金鑰不會送出任何逐字稿', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }),
    );
    await testApiKey({ apiKey: 'KEY', fetch: fetchMock, online: true });
    const body = fetchMock.mock.calls[0][1].body;
    expect(body).not.toContain(ROUND1.slice(0, 20));
    expect(body).not.toContain(ROUND3.slice(0, 20));
  });
});
