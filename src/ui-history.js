/**
 * 歷史紀錄與搜尋
 * 負責：依日期列出過往練習、關鍵字搜尋、三遍逐字稿上下堆疊比對
 * 不負責：搜尋邏輯本身（在儲存模組）、任何運算
 */

import { el, formatSeconds, renderMetricsTable } from './ui-common.js';
import { renderRoundCard } from './ui-transcript.js';
import { renderReview } from './ui-review.js';

function summaryOf(practice) {
  const rounds = practice.rounds || [];
  const last = rounds[rounds.length - 1];
  if (!last) return '還沒有講任何一遍';
  const seconds = rounds.reduce((sum, r) => sum + (r.seconds || 0), 0);
  return `${rounds.length} 遍・共 ${formatSeconds(seconds)}`;
}

function itemOf(practice, handlers) {
  const btn = el('button', 'history-item');
  btn.type = 'button';
  btn.dataset.id = practice.id;

  const line = el('div');
  line.appendChild(el('span', null, practice.title || '（未完成，還沒補標題）'));
  btn.appendChild(line);

  const meta = el('div', 'history-date');
  meta.textContent = `${practice.date}　${summaryOf(practice)}`;
  if (practice.pinned) meta.textContent += '　已釘選';
  if (practice.status !== 'done') meta.textContent += '　未完成';
  btn.appendChild(meta);

  btn.addEventListener('click', () => handlers.onOpen?.(practice.id));
  return btn;
}

/**
 * 畫出歷史清單。
 * 已經有搜尋框時只換清單，不重畫搜尋框，避免打字打到一半失焦。
 */
export function renderHistory(container, { practices = [], keyword = '' } = {}, handlers = {}) {
  let input = container.querySelector('#history-search');
  let list = container.querySelector('#history-list');

  if (!input) {
    container.replaceChildren();
    const label = el('label', 'field');
    label.appendChild(el('span', 'field-label', '搜尋標題與逐字稿'));
    input = el('input', 'input');
    input.type = 'search';
    input.id = 'history-search';
    input.placeholder = '輸入關鍵字';
    input.value = keyword;
    input.addEventListener('input', () => handlers.onSearch?.(input.value));
    label.appendChild(input);
    container.appendChild(label);

    list = el('div');
    list.id = 'history-list';
    container.appendChild(list);
  }

  if (input.value !== keyword && document.activeElement !== input) input.value = keyword;

  list.replaceChildren();
  if (!practices.length) {
    list.appendChild(el('p', 'empty', keyword ? '沒有找到符合的練習。' : '還沒有任何練習紀錄。'));
    return container;
  }
  for (const practice of practices) list.appendChild(itemOf(practice, handlers));
  return container;
}

/**
 * 某一筆練習的完整內容：三遍逐字稿上下堆疊、數據對比表、AI 分析。
 * @param {object} state {reviewing, reviewError} 分析進行中的狀態
 */
export function renderDetail(container, practice, handlers = {}, state = {}) {
  container.replaceChildren();
  if (!practice) {
    container.appendChild(el('p', 'empty', '找不到這筆練習。'));
    return container;
  }

  const back = el('button', 'btn-text', '← 回到歷史紀錄');
  back.type = 'button';
  back.id = 'detail-back';
  back.addEventListener('click', () => handlers.onBack?.());
  container.appendChild(back);

  const head = el('div', 'card-head');
  head.appendChild(el('h2', 'section-title', practice.title || '（未完成，還沒補標題）'));
  head.appendChild(el('span', 'history-date', practice.date));
  container.appendChild(head);

  const stack = el('div', 'round-stack');
  stack.id = 'detail-rounds';
  const rounds = practice.rounds || [];
  for (let i = 0; i < rounds.length; i += 1) {
    stack.appendChild(
      renderRoundCard(rounds[i], {
        context: { date: practice.date, title: practice.title },
        onEdit: handlers.onEditTranscript,
        onExportAudio: handlers.onExportAudio,
      }),
    );
  }
  container.appendChild(stack);
  container.appendChild(renderMetricsTable(rounds));

  const reviewCard = el('section', 'card');
  reviewCard.id = 'detail-review';
  reviewCard.appendChild(el('h3', 'card-title', 'AI 分析'));
  reviewCard.appendChild(renderReview(practice.review));

  // 當下沒分析就離開的話，之後從這裡補做；做過的也能重跑
  if (handlers.onReview) {
    const done = !!practice.review;
    const label = state.reviewing ? '分析中…' : done ? '重新分析' : '做 AI 分析';
    const btn = el('button', 'btn', label);
    btn.type = 'button';
    btn.id = 'detail-review-btn';
    btn.disabled = !!state.reviewing;
    btn.addEventListener('click', () => handlers.onReview(practice.id));
    reviewCard.appendChild(btn);
  }
  if (state.reviewError) {
    const err = el('p', 'notice', state.reviewError);
    err.id = 'detail-review-error';
    reviewCard.appendChild(err);
  }
  container.appendChild(reviewCard);

  const tools = el('div', 'card');

  // 釘選的唯一作用是不讓音檔被 7 天清除。
  // 這一版不錄音，沒有音檔的紀錄就不該出現一顆按了沒作用的按鈕。
  const hasAudio = rounds.some((r) => r.audio || r.audioPurged);
  if (hasAudio) {
    const pin = el('button', 'btn-text', practice.pinned ? '取消釘選（音檔將於 7 天後清除）' : '釘選這筆（保留音檔）');
    pin.type = 'button';
    pin.id = 'detail-pin';
    pin.addEventListener('click', () => handlers.onTogglePin?.(practice.id, !practice.pinned));
    tools.appendChild(pin);
  }

  const del = el('button', 'btn-text', '刪除這筆');
  del.type = 'button';
  del.id = 'detail-delete';
  del.addEventListener('click', () => handlers.onDelete?.(practice.id));
  tools.appendChild(del);
  container.appendChild(tools);

  return container;
}
