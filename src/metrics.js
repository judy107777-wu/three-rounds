/**
 * 數據模組
 * 負責：算秒數、字數、語速、贅詞數、贅詞密度
 * 不負責：判斷內容好壞、呼叫 AI、存取資料
 */

/**
 * 贅詞預設清單（架構文件 3.3）。第一版不提供自訂。
 * 前五個是使用者三遍練習中實際出現的，其餘為一般常見口頭禪。
 */
export const FILLER_WORDS = [
  '然後', '就是', '那麼', '呢', '我覺得',
  '這個', '那個', '其實', '基本上', '老實說', '對啊', '嗯', '啊',
  '之類的', '什麼的', '的話', '我跟你講', '你知道嗎',
];

// 長的排前面，比對時長的優先，避免「對啊」被拆成「對」＋「啊」重複計算。
const FILLERS_BY_LENGTH = [...FILLER_WORDS].sort((a, b) => b.length - a.length);

const MAX_FILLER_LENGTH = FILLERS_BY_LENGTH[0].length;

// 標點、空白、各種括號引號。比對與計數前一律先拿掉。
const NOISE = /[\s\p{P}\p{S}]/gu;

function clean(text) {
  if (typeof text !== 'string') return '';
  return text.replace(NOISE, '');
}

/**
 * 字數：中文一個字算一字，連在一起的英文或數字算一字。
 * 標點與空白不算。
 */
export function countChars(text) {
  const s = clean(text);
  if (!s) return 0;
  // 先把英數連續段換成單一佔位字元，再數字元數
  const collapsed = s.replace(/[0-9A-Za-z]+/g, '\u0001');
  return [...collapsed].length;
}

/**
 * 贅詞數：由左往右掃描，每個位置優先比對最長的贅詞，
 * 命中就前進該贅詞的長度，確保同一段文字不被重複計算。
 */
export function countFillers(text) {
  const s = clean(text);
  if (!s) return 0;
  let count = 0;
  let i = 0;
  while (i < s.length) {
    let hit = 0;
    const window = s.slice(i, i + MAX_FILLER_LENGTH);
    for (const filler of FILLERS_BY_LENGTH) {
      if (window.startsWith(filler)) {
        hit = filler.length;
        break;
      }
    }
    if (hit) {
      count += 1;
      i += hit;
    } else {
      i += 1;
    }
  }
  return count;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

/**
 * 一遍的完整數據。
 * @param {string} text 逐字稿
 * @param {number} seconds 這一遍講了幾秒
 * @returns {{seconds:number, charCount:number, speed:number, fillerCount:number, fillerDensity:number}}
 *   speed 為每分鐘字數（整數），fillerDensity 為贅詞佔字數的百分比（一位小數）
 */
export function computeMetrics(text, seconds = 0) {
  const sec = Number.isFinite(Number(seconds)) ? Math.max(0, Number(seconds)) : 0;
  const charCount = countChars(text);
  const fillerCount = charCount === 0 ? 0 : countFillers(text);
  const speed = sec > 0 ? Math.round((charCount / sec) * 60) : 0;
  const fillerDensity = charCount > 0 ? round1((fillerCount / charCount) * 100) : 0;
  return { seconds: sec, charCount, speed, fillerCount, fillerDensity };
}
