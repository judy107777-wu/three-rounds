/**
 * 畫面共用的小工具
 * 負責：建立元素、格式化數字與差距、把檔案交給使用者
 * 不負責：任何運算與資料存取邏輯
 */

import { toneOf, compareMetrics } from './compare.js';

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** 秒數顯示成 1:35 這種樣子 */
export function formatSeconds(total) {
  const s = Math.max(0, Math.round(Number(total) || 0));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** 數據項目的顯示順序與單位 */
export const METRIC_FIELDS = [
  { key: 'seconds', label: '秒數', unit: '秒' },
  { key: 'charCount', label: '字數', unit: '字' },
  { key: 'speed', label: '語速', unit: '字/分' },
  { key: 'fillerCount', label: '贅詞', unit: '個' },
  { key: 'fillerDensity', label: '贅詞密度', unit: '%' },
];

function signed(n) {
  const rounded = Math.round(n * 10) / 10;
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

/** 差距的文字：+450 字（+136%） */
export function formatDelta(diff, unit) {
  if (!diff) return '';
  if (diff.direction === 'same') return '與前一遍相同';
  const percent = diff.percent === null ? '' : `（${signed(diff.percent)}%）`;
  return `${signed(diff.delta)}${unit}${percent}`;
}

/**
 * 一列數據，選擇性附上與前一遍的差距。
 * 數據放在逐字稿卡片下緣，小字灰褐，不搶注意力。
 */
export function renderMetrics(metrics, delta) {
  const row = el('div', 'metrics');
  if (!metrics) return row;
  for (const field of METRIC_FIELDS) {
    const item = el('div', 'metric');
    item.appendChild(el('span', 'metric-label', `${field.label} `));
    const value = field.key === 'seconds' ? formatSeconds(metrics.seconds) : String(metrics[field.key]);
    item.appendChild(el('span', 'metric-value', value));
    item.appendChild(el('span', 'metric-unit', field.key === 'seconds' ? '' : field.unit));
    const diff = delta && delta[field.key];
    if (diff) {
      const tone = toneOf(diff.direction);
      const deltaNode = el('span', `delta tone-${tone}`, ` ${formatDelta(diff, field.key === 'seconds' ? '秒' : field.unit)}`);
      deltaNode.dataset.tone = tone;
      deltaNode.dataset.field = field.key;
      item.appendChild(deltaNode);
    }
    row.appendChild(item);
  }
  return row;
}

/**
 * 三遍數據的對比表。
 * 放在第 3 遍與 AI 分析之間，不放在每一遍下方——
 * 三遍要能上下對齊比較，散在各張卡片下緣看不出變化。
 * @param {Array} rounds 已完成的幾遍
 */
export function renderMetricsTable(rounds = []) {
  const wrap = el('div', 'card metrics-table-card');
  wrap.dataset.role = 'metrics-table';
  if (!rounds.length) return wrap;

  wrap.appendChild(el('h3', 'card-title', '三遍對比'));

  const table = el('table', 'metrics-table');
  const thead = el('thead');
  const headRow = el('tr');
  headRow.appendChild(el('th', null, ''));
  for (const round of rounds) headRow.appendChild(el('th', null, `第 ${round.index} 遍`));
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = el('tbody');
  for (const field of METRIC_FIELDS) {
    const row = el('tr');
    row.dataset.field = field.key;
    row.appendChild(el('th', 'metrics-table-label', field.label));
    for (let i = 0; i < rounds.length; i += 1) {
      const metrics = rounds[i].metrics || {};
      const cell = el('td');
      const value =
        field.key === 'seconds' ? formatSeconds(metrics.seconds) : `${metrics[field.key] ?? 0}`;
      cell.appendChild(el('span', 'metric-value', value));
      if (field.key !== 'seconds') cell.appendChild(el('span', 'metric-unit', field.unit));

      // 與前一遍比。秒數與字數只描述變化，贅詞才分進步退步。
      const prev = rounds[i - 1];
      if (prev) {
        const diff = compareMetrics(metrics, prev.metrics)[field.key];
        const tone = toneOf(diff.direction);
        // 秒數那一列的值是 1:35 這種格式，差距要補上單位才看得懂是幾秒；
        // 其他列的單位就寫在數字旁邊，不用重複
        const deltaUnit = field.key === 'seconds' ? '秒' : '';
        const mark = el('span', `delta tone-${tone}`, formatDelta(diff, deltaUnit));
        mark.dataset.tone = tone;
        mark.dataset.field = field.key;
        cell.appendChild(mark);
      }
      row.appendChild(cell);
    }
    tbody.appendChild(row);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

/** 把資料交給使用者下載 */
export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** 顯示一句提示，幾秒後自己消失 */
export function showToast(message, { timeout = 3200, node } = {}) {
  const toast = node || document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toast.__timer);
  toast.__timer = setTimeout(() => {
    toast.hidden = true;
  }, timeout);
}
