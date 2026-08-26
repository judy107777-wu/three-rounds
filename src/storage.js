/**
 * 儲存模組
 * 負責：IndexedDB 讀寫、音檔 7 天清除、釘選、資料匯出用的整包讀取
 * 不負責：畫面呈現、資料內容的正確性
 *
 * 資料只存在這台裝置的瀏覽器裡，不上雲、不需要帳號。
 */

const DB_NAME = 'speak-three-times';
const DB_VERSION = 1;
const STORE = 'practices';

/** 音檔保留天數，超過且未釘選就清掉，逐字稿與數據永久保留 */
export const AUDIO_KEEP_DAYS = 7;
const KEEP_MS = AUDIO_KEEP_DAYS * 24 * 60 * 60 * 1000;

let dbPromise = null;

function openDatabase() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
        store.createIndex('status', 'status');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(mode, run) {
  return openDatabase().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const store = t.objectStore(STORE);
        let result;
        try {
          result = run(store);
        } catch (err) {
          reject(err);
          return;
        }
        t.oncomplete = () => resolve(result && result.__req ? result.__req.result : result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

function wrap(req) {
  return { __req: req };
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** 本地日期字串 YYYY-MM-DD。用本地時區，因為「今天」是使用者的今天。 */
export function dateKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function newId(now) {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${now.toString(36)}-${rand}`;
}

/**
 * 造一筆新的練習。此時還沒有標題——標題要等三遍講完才補。
 */
export function createPractice({ now = Date.now() } = {}) {
  return {
    id: newId(now),
    date: dateKey(now),
    createdAt: now,
    updatedAt: now,
    title: '',
    status: 'unfinished',
    pinned: false,
    rounds: [],
    review: null,
  };
}

/** 補齊一遍的預設欄位，讓後面的判斷不用到處防 undefined */
function normalizeRound(round) {
  return {
    audio: null,
    audioType: null,
    audioPurged: false,
    needsManualEntry: false,
    transcript: '',
    seconds: 0,
    ...round,
  };
}

function normalize(practice) {
  return {
    ...practice,
    rounds: (practice.rounds || []).map(normalizeRound),
  };
}

export async function savePractice(practice) {
  const record = { ...normalize(practice), updatedAt: practice.updatedAt ?? Date.now() };
  await tx('readwrite', (store) => store.put(record));
  return record;
}

/** 這一筆是否該清音檔了 */
function shouldPurge(practice, now) {
  return !practice.pinned && now - practice.createdAt > KEEP_MS;
}

function purgeAudio(practice) {
  let changed = false;
  const rounds = practice.rounds.map((r) => {
    if (r.audio == null && r.audioPurged) return r;
    changed = true;
    return { ...r, audio: null, audioType: null, audioPurged: true };
  });
  return changed ? { ...practice, rounds } : practice;
}

/**
 * 讀取時順手清掉過期音檔，並把結果寫回資料庫。
 * 清掉的只有音檔，逐字稿與數據一律保留。
 */
async function applyPurge(records, now) {
  const toWrite = [];
  const out = records.map((rec) => {
    if (!shouldPurge(rec, now)) return rec;
    const purged = purgeAudio(rec);
    if (purged !== rec) toWrite.push(purged);
    return purged;
  });
  if (toWrite.length) {
    await tx('readwrite', (store) => {
      for (const rec of toWrite) store.put(rec);
    });
  }
  return out;
}

export async function getPractice(id, { now = Date.now() } = {}) {
  const rec = await tx('readonly', (store) => wrap(store.get(id)));
  if (!rec) return null;
  const [out] = await applyPurge([rec], now);
  return out;
}

export async function updatePractice(id, patch, { now = Date.now() } = {}) {
  const rec = await tx('readonly', (store) => wrap(store.get(id)));
  if (!rec) return null;
  const next = normalize({ ...rec, ...patch, id: rec.id, updatedAt: now });
  await tx('readwrite', (store) => store.put(next));
  return next;
}

export async function deletePractice(id) {
  await tx('readwrite', (store) => store.delete(id));
}

/** 全部練習，由新到舊 */
export async function listPractices({ now = Date.now() } = {}) {
  const all = await tx('readonly', (store) => wrap(store.getAll()));
  const sorted = (all || []).sort((a, b) => b.createdAt - a.createdAt);
  return applyPurge(sorted, now);
}

function matches(practice, keyword) {
  // 搜尋範圍只有標題與逐字稿。AI 分析不進搜尋範圍——
  // 那是機器寫的字，搜到只會干擾找自己講過什麼。
  if (practice.title && practice.title.includes(keyword)) return true;
  return practice.rounds.some((r) => (r.transcript || '').includes(keyword));
}

export async function searchPractices(keyword, { now = Date.now() } = {}) {
  const list = await listPractices({ now });
  const k = (keyword || '').trim();
  if (!k) return list;
  return list.filter((p) => matches(p, k));
}

/** 未完成的練習取最新一筆，用來續接三遍流程 */
export async function getUnfinishedPractice({ now = Date.now() } = {}) {
  const list = await listPractices({ now });
  return list.find((p) => p.status === 'unfinished') || null;
}

export async function setPinned(id, pinned, { now = Date.now() } = {}) {
  return updatePractice(id, { pinned: !!pinned }, { now });
}

/** 測試與「清空資料」用 */
export async function clearAll() {
  await tx('readwrite', (store) => store.clear());
}
