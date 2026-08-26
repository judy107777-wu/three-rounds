/**
 * 組裝層
 * 負責：把各模組接起來、切換畫面、處理瀏覽器端的副作用
 * 不負責：任何運算與資料規則（那些都在各自的模組裡）
 */

import { loadSession, createSession } from './session.js';
import { createRecognizer } from './speech.js';
import { renderToday } from './ui-today.js';
import { renderHistory, renderDetail } from './ui-history.js';
import { renderSettings, getApiKey } from './ui-settings.js';
import { renderReview } from './ui-review.js';
import { requestReview } from './ai-review.js';
import { exportRoundAudio } from './ui-transcript.js';
import { exportAll, ExportError } from './export.js';
import { showToast, formatSeconds } from './ui-common.js';
import {
  listPractices, searchPractices, getPractice, deletePractice, setPinned,
} from './storage.js';

const views = {
  today: document.getElementById('view-today'),
  history: document.getElementById('view-history'),
  settings: document.getElementById('view-settings'),
  detail: document.getElementById('view-detail'),
};

const navButtons = {
  today: document.getElementById('nav-today'),
  history: document.getElementById('nav-history'),
  settings: document.getElementById('nav-settings'),
};

const state = {
  view: 'today',
  session: null,
  recording: false,
  elapsed: 0,
  liveText: '',
  notice: '',
  reviewing: false,
  reviewError: '',
  keyword: '',
  detailId: null,
};

let recognizer = null;
let timerId = null;
let roundStartedAt = 0;

function showView(name) {
  state.view = name;
  for (const [key, node] of Object.entries(views)) {
    if (node) node.hidden = key !== name;
  }
  for (const [key, btn] of Object.entries(navButtons)) {
    if (!btn) continue;
    const active = key === name || (name === 'detail' && key === 'history');
    if (active) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  }
}

// ── 今日練習 ─────────────────────────────────

function drawToday() {
  renderToday(views.today, state, todayHandlers);
}

const todayHandlers = {
  // 第一版不錄音。Android 上麥克風只給一個來源用，
  // 同時開錄音會讓辨識完全收不到聲音（實測 onnomatch、逐字稿全空）。
  // 逐字稿是數據與 AI 檢查的根，所以優先讓給辨識。
  async onStart() {
    state.notice = '';
    state.liveText = '';
    recognizer = createRecognizer({
      onUpdate: (text) => {
        state.liveText = text;
        const live = document.getElementById('live-transcript');
        if (live) live.textContent = text;
      },
    });

    // 辨識起不來也讓這一遍照常進行，講完自己把內容打上去就好
    if (!recognizer.start()) {
      state.notice = recognizer.notice || '這一遍沒辦法辨識，講完可以自己把內容打上去。';
    }

    roundStartedAt = Date.now();
    state.recording = true;
    state.elapsed = 0;
    drawToday();

    timerId = setInterval(() => {
      state.elapsed = Math.floor((Date.now() - roundStartedAt) / 1000);
      const timer = document.getElementById('record-timer');
      if (timer) timer.textContent = formatSeconds(state.elapsed);
    }, 500);
  },

  async onStop() {
    clearInterval(timerId);
    timerId = null;
    const seconds = roundStartedAt ? Math.round((Date.now() - roundStartedAt) / 1000) : 0;
    roundStartedAt = 0;

    const speech = recognizer
      ? await recognizer.stop()
      : { transcript: '', needsManualEntry: true, reason: 'unsupported', notice: '' };

    recognizer = null;
    state.recording = false;
    state.elapsed = 0;
    state.liveText = '';
    state.notice = speech.notice || '';

    await state.session.completeRound({
      seconds,
      audio: null,
      audioType: null,
      transcript: speech.transcript,
      needsManualEntry: speech.needsManualEntry,
      reason: speech.reason,
    });
    drawToday();
  },

  async onEditTranscript(index, text) {
    await state.session.updateTranscript(index, text);
    drawToday();
  },

  async onFinish(title) {
    try {
      await state.session.finish(title);
      showToast('已存檔');
    } catch (err) {
      showToast(err.message);
      return;
    }
    drawToday();
  },

  async onReview() {
    state.reviewing = true;
    state.reviewError = '';
    drawToday();

    const result = await requestReview({
      rounds: state.session.rounds,
      apiKey: getApiKey(),
    });
    state.reviewing = false;

    if (!result.ok) {
      state.reviewError = result.message;
      drawToday();
      return;
    }
    await state.session.attachReview(result.review);
    drawToday();
  },

  onExportAudio(round) {
    exportRoundAudio(round, {
      date: state.session.practice.date,
      title: state.session.practice.title,
    });
  },

  async onNewPractice() {
    state.session = await loadSession();
    state.reviewError = '';
    drawToday();
  },
};

// ── 歷史紀錄 ─────────────────────────────────

async function drawHistory() {
  const practices = state.keyword
    ? await searchPractices(state.keyword)
    : await listPractices();
  renderHistory(views.history, { practices, keyword: state.keyword }, historyHandlers);
}

const historyHandlers = {
  async onSearch(keyword) {
    state.keyword = keyword;
    await drawHistory();
  },
  async onOpen(id) {
    state.detailId = id;
    await drawDetail();
    showView('detail');
  },
};

async function drawDetail() {
  const practice = await getPractice(state.detailId);
  renderDetail(views.detail, practice, detailHandlers);
}

const detailHandlers = {
  async onBack() {
    await drawHistory();
    showView('history');
  },
  async onEditTranscript(index, text) {
    const practice = await getPractice(state.detailId);
    if (!practice) return;
    const session = createSession(practice);
    await session.updateTranscript(index, text);
    if (state.session && state.session.practice.id === practice.id) {
      state.session = createSession(await getPractice(practice.id));
    }
    await drawDetail();
  },
  onExportAudio(round) {
    getPractice(state.detailId).then((practice) => {
      if (practice) exportRoundAudio(round, { date: practice.date, title: practice.title });
    });
  },
  async onTogglePin(id, pinned) {
    await setPinned(id, pinned);
    await drawDetail();
    showToast(pinned ? '已釘選，音檔會留著' : '已取消釘選');
  },
  async onDelete(id) {
    const ok = globalThis.confirm?.('刪除之後救不回來，確定要刪除這筆練習嗎？');
    if (!ok) return;
    await deletePractice(id);
    if (state.session && state.session.practice.id === id) {
      state.session = await loadSession();
    }
    await drawHistory();
    showView('history');
    showToast('已刪除');
  },
};

// ── 設定 ─────────────────────────────────────

function drawSettings() {
  renderSettings(views.settings, {
    onToast: (message) => showToast(message),
    async onExport() {
      try {
        await exportAll();
        showToast('已匯出');
      } catch (err) {
        showToast(err instanceof ExportError ? err.message : '匯出失敗，請再試一次。');
      }
    },
  });
}

// ── 啟動 ─────────────────────────────────────

function bindNav() {
  navButtons.today?.addEventListener('click', () => {
    drawToday();
    showView('today');
  });
  navButtons.history?.addEventListener('click', async () => {
    await drawHistory();
    showView('history');
  });
  navButtons.settings?.addEventListener('click', () => {
    drawSettings();
    showView('settings');
  });
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const register = () =>
    navigator.serviceWorker.register('sw.js').catch(() => {
      // 離線快取失敗不影響主要功能，不打擾使用者
    });
  // start() 是非同步的，跑到這裡時 load 可能早就發生過了
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}

export async function start() {
  bindNav();
  state.session = await loadSession();
  drawToday();
  showView('today');
  registerServiceWorker();
}

// 講到一半不小心關掉分頁時，把麥克風放掉
window.addEventListener('pagehide', () => {
  if (recognizer) recognizer.stop();
});

start();

export { renderReview };
