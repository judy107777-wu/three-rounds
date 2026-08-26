/**
 * AI 檢查結果畫面
 * 負責：把四項分析顯示出來
 * 不負責：呼叫 Gemini、決定何時呼叫、存檔
 *
 * 四項固定，不得增減。沒有分數、沒有等第、沒有鼓勵性評語。
 */

import { el } from './ui-common.js';
import { REVIEW_SECTIONS } from './ai-review.js';

const EMPTY_TEXT = {
  rescue: '沒有第 3 遍漏掉的重點。',
  cut: '第 3 遍沒有明顯該刪的句子。',
  newContent: '第 2、3 遍沒有冒出新內容。',
};

function listSection(key, title, items, renderItem) {
  const section = el('section', 'review-section');
  section.dataset.section = key;
  section.appendChild(el('h3', 'section-title', title));
  if (!items.length) {
    section.appendChild(el('p', 'empty', EMPTY_TEXT[key]));
    return section;
  }
  const list = el('ul', 'review-list');
  for (const item of items) list.appendChild(renderItem(item));
  section.appendChild(list);
  return section;
}

/**
 * 畫出四個區塊。
 * @param {object} review 已整理過的分析結果
 * @returns {HTMLElement}
 */
export function renderReview(review) {
  const wrap = el('div', 'review');
  if (!review) {
    wrap.appendChild(el('p', 'empty', '這次練習還沒做 AI 檢查。'));
    return wrap;
  }

  const titles = Object.fromEntries(REVIEW_SECTIONS.map((s) => [s.key, s.title]));

  wrap.appendChild(
    listSection('rescue', titles.rescue, review.rescue || [], (item) => {
      const li = el('li');
      li.appendChild(el('span', 'review-point', item.point));
      if (item.reason) li.appendChild(el('span', 'hint', `　${item.reason}`));
      return li;
    }),
  );

  wrap.appendChild(
    listSection('cut', titles.cut, review.cut || [], (text) => el('li', null, text)),
  );

  wrap.appendChild(
    listSection('newContent', titles.newContent, review.newContent || [], (text) => el('li', null, text)),
  );

  const conclusion = review.conclusion || { isFirstSentence: false, note: '' };
  const section = el('section', 'review-section');
  section.dataset.section = 'conclusion';
  section.appendChild(el('h3', 'section-title', titles.conclusion));
  section.appendChild(
    el('p', null, conclusion.isFirstSentence ? '第 3 遍的第一句就是結論。' : '第 3 遍的第一句不是結論。'),
  );
  if (conclusion.note) section.appendChild(el('p', 'hint', conclusion.note));
  wrap.appendChild(section);

  return wrap;
}
