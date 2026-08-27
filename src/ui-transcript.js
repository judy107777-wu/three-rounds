/**
 * 逐字稿卡片
 * 負責：逐字稿呈現與編輯、斷網那遍的補字欄位、取出這一遍的錄音
 * 不負責：重算數據（交給流程控制）、儲存
 */

import { el, saveBlob, formatSeconds } from './ui-common.js';

const EXT_BY_TYPE = {
  'audio/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
};

export function audioFilename(round, { date = '', title = '' } = {}) {
  const ext = EXT_BY_TYPE[round.audioType] || 'webm';
  const name = (title || date || '練習').replace(/[\\/:*?"<>|]/g, '');
  return `${name}-第${round.index}遍.${ext}`;
}

/** 取出這一遍的錄音檔給使用者 */
export function exportRoundAudio(round, context = {}, save = saveBlob) {
  if (!round.audio) return null;
  const blob = new Blob([round.audio], { type: round.audioType || 'audio/webm' });
  const filename = audioFilename(round, context);
  save(blob, filename);
  return filename;
}

/**
 * 畫一張逐字稿卡片。
 * @param {object} round 這一遍的資料
 * @param {object} options
 *   options.delta 與前一遍的差距，沒有就不顯示
 *   options.editable 是否可編輯
 *   options.context {date, title} 取出音檔時用來組檔名
 *   options.onEdit(index, text) 逐字稿改完之後呼叫
 *   options.onExportAudio(round) 自己接手取出音檔；不給就用預設下載
 */
export function renderRoundCard(round, options = {}) {
  const { editable = true, context = {}, onEdit, onExportAudio, onRedo } = options;

  const card = el('article', 'card round-card');
  card.dataset.round = String(round.index);

  const head = el('div', 'card-head');
  head.appendChild(el('h3', 'card-title', `第 ${round.index} 遍`));

  const right = el('div', 'card-head-right');
  right.appendChild(el('span', 'history-date', formatSeconds(round.seconds)));
  // 講到一半腦袋卡住是這種練習的常態，重錄要伸手就按得到
  if (onRedo) {
    const redo = el('button', 'btn-text btn-redo', '重錄');
    redo.type = 'button';
    redo.dataset.role = 'redo';
    redo.dataset.round = String(round.index);
    redo.addEventListener('click', () => onRedo(round.index));
    right.appendChild(redo);
  }
  head.appendChild(right);
  card.appendChild(head);

  // 斷網那遍逐字稿是空的，這是預期行為，由使用者事後補字
  if (round.needsManualEntry) {
    const notice = el('p', 'notice', round.recognitionNotice || '這一遍沒有取得逐字稿，可以自己把內容補上。');
    notice.dataset.role = 'manual-entry-notice';
    card.appendChild(notice);
  } else if (round.interrupted) {
    // 有內容但辨識中途停過，逐字稿一定缺一段，不能默默少一半
    const notice = el(
      'p',
      'notice',
      round.recognitionNotice || '辨識中途停了，這一遍的逐字稿可能不完整。',
    );
    notice.dataset.role = 'interrupted-notice';
    card.appendChild(notice);
  }

  const box = el('textarea', 'transcript');
  box.value = round.transcript || '';
  box.dataset.role = 'transcript';
  box.dataset.round = String(round.index);
  box.rows = round.needsManualEntry ? 6 : 4;
  box.placeholder = round.needsManualEntry ? '把這一遍講的內容打上來' : '';
  box.readOnly = !editable;
  if (editable && onEdit) {
    box.addEventListener('change', () => onEdit(round.index, box.value));
    box.addEventListener('blur', () => onEdit(round.index, box.value));
  }
  card.appendChild(box);

  // 數據不放在這裡。三遍要能上下對齊比較，統一收進第 3 遍後面的對比表。

  if (round.audio) {
    const btn = el('button', 'btn-text', '取出這一遍的錄音');
    btn.type = 'button';
    btn.dataset.role = 'export-audio';
    btn.addEventListener('click', () => {
      if (onExportAudio) onExportAudio(round);
      else exportRoundAudio(round, context);
    });
    card.appendChild(btn);
  } else if (round.audioPurged) {
    const hint = el('p', 'hint', '音檔已超過 7 天自動清除，逐字稿與數據都還在。');
    hint.dataset.role = 'audio-purged';
    card.appendChild(hint);
  }

  return card;
}

/** 三遍上下堆疊，不左右並排 */
export function renderRoundStack(rounds, options = {}) {
  const stack = el('div', 'round-stack');
  for (const round of rounds) {
    stack.appendChild(
      renderRoundCard(round, { ...options, delta: options.deltaFor ? options.deltaFor(round.index) : null }),
    );
  }
  return stack;
}
