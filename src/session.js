/**
 * 三遍流程控制
 * 負責：管理目前在第幾遍、可中斷續接、三遍完成後才要求補標題
 * 不負責：錄音、辨識、畫面
 *
 * 「一次練習」＝同一個主題連續講三遍所構成的一筆完整紀錄。
 * 主題是三遍全部講完之後才補上的，開始前不輸入任何文字。
 */

import { computeMetrics } from './metrics.js';
import { compareMetrics } from './compare.js';
import {
  createPractice, savePractice, getUnfinishedPractice, updatePractice,
} from './storage.js';

export const ROUNDS_PER_PRACTICE = 3;

/** 依第幾遍排序，讓重錄之後順序不會亂掉 */
function sortRounds(rounds) {
  return [...rounds].sort((a, b) => a.index - b.index);
}

/** 還沒講的最小編號。全部講完回傳 null */
function nextMissingIndex(rounds) {
  for (let i = 1; i <= ROUNDS_PER_PRACTICE; i += 1) {
    if (!rounds.some((r) => r.index === i)) return i;
  }
  return null;
}

function buildRound(index, result) {
  const seconds = Math.max(0, Math.round(Number(result.seconds) || 0));
  const transcript = (result.transcript || '').trim();
  return {
    index,
    seconds,
    transcript,
    needsManualEntry: transcript === '' ? true : !!result.needsManualEntry,
    // 辨識中途死掉：有內容但一定不完整，要讓使用者看得到
    interrupted: !!result.interrupted,
    recognitionNotice: result.notice || null,
    recognitionReason: result.reason || null,
    audio: result.audio || null,
    audioType: result.audioType || null,
    audioPurged: false,
    metrics: computeMetrics(transcript, seconds),
  };
}

/**
 * 包住一筆練習，提供三遍流程需要的操作。
 * 每次改動都會寫回資料庫，關掉再開資料還在。
 */
export function createSession(practice) {
  let current = practice;

  async function persist(patch) {
    current = { ...current, ...patch };
    const saved = await savePractice(current);
    current = saved;
    return current;
  }

  const api = {
    get practice() {
      return current;
    },
    get rounds() {
      return current.rounds;
    },
    /** 已完成幾遍 */
    get completedRounds() {
      return current.rounds.length;
    },
    /**
     * 現在該講第幾遍；三遍都講完時回傳 null。
     * 用「還缺哪一遍」而不是「已經有幾遍」，重錄中間某一遍時才回得去。
     */
    get currentRoundNumber() {
      return nextMissingIndex(current.rounds);
    },
    /** 三遍是否都講完了 */
    get isComplete() {
      return nextMissingIndex(current.rounds) === null;
    },
    /** 是否該出現標題輸入：三遍講完、而且還沒存檔 */
    get needsTitle() {
      return api.isComplete && current.status !== 'done';
    },
    get isSaved() {
      return current.status === 'done';
    },

    /** 記下這一遍的結果。補的是目前還缺的那一遍 */
    async completeRound(result) {
      const index = nextMissingIndex(current.rounds);
      if (index === null) return current;
      const rounds = sortRounds([...current.rounds, buildRound(index, result)]);
      return persist({ rounds });
    },

    /**
     * 重錄某一遍：把那一遍丟掉，回到待錄狀態。
     * 其他遍不動，差距會自動重算（差距是即時從數據算出來的，沒有存下來）。
     *
     * 已經存檔的練習重錄後回到未完成，這樣中途離開還接得回來；
     * 標題保留，不用重打。
     */
    async redoRound(index) {
      if (!current.rounds.some((r) => r.index === index)) return current;
      const rounds = current.rounds.filter((r) => r.index !== index);
      return persist({ rounds, status: 'unfinished' });
    },

    /** 逐字稿被編輯或補字之後，數據要跟著重算 */
    async updateTranscript(index, text) {
      const rounds = current.rounds.map((r) => {
        if (r.index !== index) return r;
        const transcript = (text || '').trim();
        return {
          ...r,
          transcript,
          needsManualEntry: transcript === '',
          metrics: computeMetrics(transcript, r.seconds),
        };
      });
      return persist({ rounds });
    },

    /** 這一遍與前一遍的差距；第 1 遍沒有前一遍，回傳 null */
    deltaFor(index) {
      const cur = current.rounds.find((r) => r.index === index);
      const prev = current.rounds.find((r) => r.index === index - 1);
      if (!cur || !prev) return null;
      return compareMetrics(cur.metrics, prev.metrics);
    },

    /** 三遍講完之後補上主題並存檔 */
    async finish(title) {
      if (!api.isComplete) {
        throw new Error('三遍還沒講完，還不能存檔。');
      }
      const clean = (title || '').trim();
      if (!clean) {
        throw new Error('請先補上這次練習的主題。');
      }
      return persist({ title: clean, status: 'done' });
    },

    /** AI 分析結果跟著這次練習一起存 */
    async attachReview(review) {
      return persist({ review });
    },

    async setPinned(pinned) {
      const saved = await updatePractice(current.id, { pinned: !!pinned });
      if (saved) current = saved;
      return current;
    },
  };

  return api;
}

/**
 * 開啟今天的練習：有未完成的就接著講，沒有就開一筆新的。
 * 新的那筆先不寫進資料庫，等第一遍講完才存，避免留下一堆空紀錄。
 */
export async function loadSession({ now = Date.now() } = {}) {
  const unfinished = await getUnfinishedPractice({ now });
  if (unfinished) return createSession(unfinished);
  return createSession(createPractice({ now }));
}
