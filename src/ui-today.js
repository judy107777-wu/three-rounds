/**
 * 今日練習畫面
 * 負責：三遍流程引導、錄音按鈕、逐字稿與數據呈現
 * 不負責：任何運算與資料存取邏輯
 *
 * 首屏只放一件事：今天的練習，以及一顆大的錄音按鈕。
 * 開始練習前不要求輸入任何文字。
 */

import { el, formatSeconds, showToast } from './ui-common.js';
import { renderRoundCard } from './ui-transcript.js';
import { ROUNDS_PER_PRACTICE } from './session.js';
import { renderReview } from './ui-review.js';

function roundStack(session, handlers, context) {
  const stack = el('div', 'round-stack');
  for (const round of session.rounds) {
    stack.appendChild(
      renderRoundCard(round, {
        delta: session.deltaFor(round.index),
        context,
        onEdit: handlers.onEditTranscript,
        onExportAudio: handlers.onExportAudio,
      }),
    );
  }
  return stack;
}

function recordArea(session, state, handlers) {
  const area = el('div', 'record-area');
  const n = session.currentRoundNumber;

  const timer = el('div', `timer${state.recording ? ' is-recording' : ''}`, formatSeconds(state.elapsed || 0));
  timer.id = 'record-timer';
  area.appendChild(timer);

  const btn = el(
    'button',
    `btn-record${state.recording ? ' is-recording' : ''}`,
    state.recording ? '停止' : `開始第 ${n} 遍`,
  );
  btn.type = 'button';
  btn.id = 'record-btn';
  btn.addEventListener('click', () => (state.recording ? handlers.onStop?.() : handlers.onStart?.()));
  area.appendChild(btn);

  if (state.recording && state.liveText) {
    const live = el('p', 'hint', state.liveText);
    live.id = 'live-transcript';
    area.appendChild(live);
  }

  if (state.notice) {
    const notice = el('p', 'notice', state.notice);
    notice.id = 'record-notice';
    area.appendChild(notice);
  }

  return area;
}

function titleForm(session, handlers) {
  const card = el('section', 'card');
  card.id = 'title-form';
  card.appendChild(el('h2', 'card-title', '三遍講完了，補上這次的主題'));

  const label = el('label', 'field');
  label.appendChild(el('span', 'field-label', '主題'));
  const input = el('input', 'input');
  input.type = 'text';
  input.id = 'title-input';
  input.value = session.practice.title || '';
  input.placeholder = '這次講的是什麼';
  label.appendChild(input);
  card.appendChild(label);

  const save = el('button', 'btn btn-primary', '存檔');
  save.type = 'button';
  save.id = 'save-btn';
  save.addEventListener('click', () => handlers.onFinish?.(input.value));
  card.appendChild(save);

  return card;
}

function reviewArea(session, state, handlers) {
  const card = el('section', 'card');
  card.id = 'review-area';

  if (session.practice.review) {
    card.appendChild(el('h2', 'card-title', 'AI 檢查'));
    card.appendChild(renderReview(session.practice.review));
    return card;
  }

  card.appendChild(el('h2', 'card-title', 'AI 檢查'));
  card.appendChild(el('p', 'hint', '把三遍逐字稿送給 AI，看看有沒有刪掉不該刪的。'));
  const btn = el('button', 'btn', state.reviewing ? '檢查中…' : '做 AI 檢查');
  btn.type = 'button';
  btn.id = 'review-btn';
  btn.disabled = !!state.reviewing;
  btn.addEventListener('click', () => handlers.onReview?.());
  card.appendChild(btn);

  if (state.reviewError) {
    const err = el('p', 'notice', state.reviewError);
    err.id = 'review-error';
    card.appendChild(err);
  }
  return card;
}

/**
 * 畫出今日練習畫面。
 * @param {HTMLElement} container
 * @param {{session:object, recording?:boolean, elapsed?:number, liveText?:string,
 *          notice?:string, reviewing?:boolean, reviewError?:string}} state
 * @param {object} handlers
 */
export function renderToday(container, state, handlers = {}) {
  const { session } = state;
  container.replaceChildren();

  const context = { date: session.practice.date, title: session.practice.title };

  const head = el('div', 'card-head');
  head.appendChild(el('span', 'history-date', session.practice.date));
  const progress = session.isComplete
    ? '三遍完成'
    : `第 ${session.currentRoundNumber} 遍 / 共 ${ROUNDS_PER_PRACTICE} 遍`;
  const progressNode = el('span', 'hint', progress);
  progressNode.id = 'round-progress';
  head.appendChild(progressNode);
  container.appendChild(head);

  if (session.practice.title) {
    container.appendChild(el('h2', 'section-title', session.practice.title));
  }

  if (session.rounds.length) {
    container.appendChild(roundStack(session, handlers, context));
  }

  if (!session.isComplete) {
    container.appendChild(recordArea(session, state, handlers));
    return container;
  }

  // 三遍講完才要求補標題
  if (session.needsTitle) {
    container.appendChild(titleForm(session, handlers));
    return container;
  }

  container.appendChild(reviewArea(session, state, handlers));

  const again = el('button', 'btn-text', '開始新的一次練習');
  again.type = 'button';
  again.id = 'new-practice-btn';
  again.addEventListener('click', () => handlers.onNewPractice?.());
  container.appendChild(again);

  return container;
}

export { showToast };
