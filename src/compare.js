/**
 * 數據模組（差距部分）
 * 負責：把這一遍與前一遍的數據相減，算出差距與方向
 * 不負責：判斷內容好壞、呼叫 AI
 */

// 每個項目的方向詞。中性項目只描述變化，不說好壞——
// 講得長或短本身沒有對錯，只有贅詞才有進步退步。
const FIELDS = {
  seconds: { up: 'longer', down: 'shorter' },
  charCount: { up: 'longer', down: 'shorter' },
  speed: { up: 'faster', down: 'slower' },
  fillerCount: { up: 'worse', down: 'better' },
  fillerDensity: { up: 'worse', down: 'better' },
};

const GOOD = new Set(['better']);
const BAD = new Set(['worse']);

/** 方向對應到色調：進步苔綠、退步淺褐、其餘不上色 */
export function toneOf(direction) {
  if (GOOD.has(direction)) return 'good';
  if (BAD.has(direction)) return 'bad';
  return 'neutral';
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function diffOne(cur, prev, words) {
  const delta = round1(cur - prev);
  const percent = prev === 0 ? null : Math.round(((cur - prev) / prev) * 100);
  let direction = 'same';
  if (delta > 0) direction = words.up;
  else if (delta < 0) direction = words.down;
  return { current: cur, previous: prev, delta, percent, direction };
}

/**
 * 比較兩遍的數據。
 * @param {object} current 這一遍的數據
 * @param {object|null} previous 前一遍的數據；沒有前一遍就傳 null
 * @returns {object|null} 沒有前一遍時回傳 null
 */
export function compareMetrics(current, previous) {
  if (!current || !previous) return null;
  const out = {};
  for (const [key, words] of Object.entries(FIELDS)) {
    out[key] = diffOne(Number(current[key]) || 0, Number(previous[key]) || 0, words);
  }
  return out;
}
