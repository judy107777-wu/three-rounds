/**
 * 匯出
 * 負責：把全部練習紀錄組成一個檔案交給使用者
 * 不負責：上傳、同步（第一版所有資料只存在本機）
 *
 * 音檔不進匯出檔：檔案會大到沒辦法用，而且音檔本來就只留 7 天。
 */

import { listPractices } from './storage.js';

export const EXPORT_VERSION = 1;

export class ExportError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ExportError';
    this.code = code;
  }
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

export function exportFilename(now = Date.now()) {
  const d = new Date(now);
  return `三遍練習-${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}.json`;
}

function plainRound(round) {
  return {
    index: round.index,
    seconds: round.seconds,
    transcript: round.transcript,
    needsManualEntry: !!round.needsManualEntry,
    metrics: round.metrics || null,
    hasAudio: round.audio != null,
  };
}

function plainPractice(p) {
  return {
    id: p.id,
    date: p.date,
    createdAt: p.createdAt,
    title: p.title,
    status: p.status,
    pinned: !!p.pinned,
    rounds: (p.rounds || []).map(plainRound),
    review: p.review || null,
  };
}

/**
 * 把紀錄組成匯出檔的內容。
 * @throws {ExportError} 沒有紀錄時丟出 code 為 empty 的錯誤，不產生空檔
 */
export function buildExport(practices, { now = Date.now() } = {}) {
  if (!practices || practices.length === 0) {
    throw new ExportError('empty', '目前沒有任何練習紀錄，沒有東西可以匯出。');
  }
  const payload = {
    app: '三遍練習',
    version: EXPORT_VERSION,
    exportedAt: new Date(now).toISOString(),
    count: practices.length,
    practices: practices.map(plainPractice),
  };
  return {
    filename: exportFilename(now),
    mimeType: 'application/json',
    text: JSON.stringify(payload, null, 2),
    data: payload,
  };
}

/**
 * 讀出全部紀錄並交給 download 處理。
 * download 可以注入，方便測試；正式執行時用瀏覽器下載。
 */
export async function exportAll({ now = Date.now(), download = downloadFile } = {}) {
  const practices = await listPractices({ now });
  const file = buildExport(practices, { now });
  await download(file);
  return file;
}

/** 瀏覽器端實際觸發下載 */
export function downloadFile({ filename, text, mimeType }) {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
