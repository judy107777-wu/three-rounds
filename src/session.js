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

function buildRound(index, result) {
  const seconds = Math.max(0, Math.round(Number(result.seconds) || 0));
  const transcript = (result.transcript || '').trim();
  return {
    index,
    seconds,
    transcript,
    needsManualEntry: transcript === '' ? true : !!result.needsManualEntry,
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
    /** 現在該講第幾遍；三遍都講完時回傳 null */
    get currentRoundNumber() {
      const n = current.rounds.length + 1;
      return n > ROUNDS_PER_PRACTICE ? null : n;
    },
    /** 三遍是否都講完了 */
    get isComplete() {
      return current.rounds.length >= ROUNDS_PER_PRACTICE;
    },
    /** 是否該出現標題輸入：三遍講完、而且還沒存檔 */
    get needsTitle() {
      return api.isComplete && current.status !== 'done';
    },
    get isSaved() {
      return current.status === 'done';
    },

    /** 記下這一遍的結果 */
    async completeRound(result) {
      if (api.isComplete) return current;
      const index = current.rounds.length + 1;
      const rounds = [...current.rounds, buildRound(index, result)];
      return persist({ rounds });
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

    /** AI 檢查結果跟著這次練習一起存 */
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
