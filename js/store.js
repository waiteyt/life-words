// 本機儲存：設定與學習進度放 localStorage，照片與錄音放 IndexedDB。
// 所有資料只存在這台裝置，不會上傳。

const LS_PREFIX = 'lw:';

export function lsGet(key, fallback) {
  try {
    const v = localStorage.getItem(LS_PREFIX + key);
    return v == null ? fallback : JSON.parse(v);
  } catch { return fallback; }
}
export function lsSet(key, value) {
  try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(value)); } catch { /* 私密模式等情況，忽略 */ }
}

export const DEFAULT_SETTINGS = {
  langs: { zh: true, en: true, tw: true },   // 會出題、會唸的語言
  showText: { zhuyin: true, en: true, tw: true },
  levels: [1],                                 // 1=第一期，2=第二期
  cats: [],                                    // 空陣列 = 全部分類
  choices: 'auto',                             // 'auto' | 2 | 3 | 4
  roundSize: 10,
  zhVoice: '', enVoice: '',
  rate: 0.85,
};

export function getSettings() {
  const s = lsGet('settings', {});
  return {
    ...DEFAULT_SETTINGS, ...s,
    langs: { ...DEFAULT_SETTINGS.langs, ...(s.langs || {}) },
    showText: { ...DEFAULT_SETTINGS.showText, ...(s.showText || {}) },
  };
}
export function saveSettings(s) { lsSet('settings', s); }

// ---- 學習進度（Leitner 盒子）----
// box 0~5，答對往上一盒，答錯回到第 0 盒；每盒的間隔天數如下
const BOX_DAYS = [0, 1, 2, 4, 8, 16];
export function getProgress() { return lsGet('progress', {}); }
export function recordAnswer(wordId, mode, ok) {
  const all = getProgress();
  const key = wordId + ':' + mode;
  const p = all[key] || { box: 0, seen: 0, ok: 0, due: 0 };
  p.seen += 1;
  if (ok) { p.ok += 1; p.box = Math.min(5, p.box + 1); }
  else { p.box = 0; }
  p.due = Date.now() + BOX_DAYS[p.box] * 86400000 - 3600000;
  p.last = Date.now();
  all[key] = p;
  lsSet('progress', all);
  return p;
}

// 每個詞的家長調整：隱藏、指定圖片、台語修正
export function getWordPrefs() { return lsGet('wordPrefs', {}); }
export function setWordPref(id, patch) {
  const all = getWordPrefs();
  all[id] = { ...(all[id] || {}), ...patch };
  for (const k of Object.keys(all[id])) if (all[id][k] == null) delete all[id][k];
  if (!Object.keys(all[id]).length) delete all[id];
  lsSet('wordPrefs', all);
}

// ---- IndexedDB ----
let dbPromise;
function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('這個瀏覽器不支援本機資料庫'));
      const req = indexedDB.open('life-words', 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        d.createObjectStore('customWords', { keyPath: 'id' });
        d.createObjectStore('blobs');          // key: `${wordId}:photo` / `${wordId}:rec:zh` / `${wordId}:rec:tw`
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}
function tx(store, mode, fn) {
  return db().then(d => new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req ? req.result : undefined);
    t.onerror = () => reject(t.error);
  }));
}

export async function listCustomWords() {
  try { return await tx('customWords', 'readonly', s => s.getAll()) || []; }
  catch { return []; }
}
export function saveCustomWord(w) { return tx('customWords', 'readwrite', s => s.put(w)); }
export async function deleteCustomWord(id) {
  await tx('customWords', 'readwrite', s => s.delete(id));
  for (const k of ['photo', 'rec:zh', 'rec:tw', 'rec:en']) await deleteBlob(`${id}:${k}`);
}
export async function getBlob(key) {
  try { return await tx('blobs', 'readonly', s => s.get(key)); } catch { return undefined; }
}
export function putBlob(key, blob) { return tx('blobs', 'readwrite', s => s.put(blob, key)); }
export function deleteBlob(key) { return tx('blobs', 'readwrite', s => s.delete(key)).catch(() => {}); }
export async function listBlobKeys() {
  try { return await tx('blobs', 'readonly', s => s.getAllKeys()) || []; } catch { return []; }
}

// ---- 備份與還原 ----
function blobToDataURL(b) {
  return new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); });
}
export async function exportBackup() {
  const keys = await listBlobKeys();
  const blobs = {};
  for (const k of keys) { const b = await getBlob(k); if (b) blobs[k] = await blobToDataURL(b); }
  return {
    app: 'life-words', version: 1, exportedAt: new Date().toISOString(),
    settings: getSettings(), progress: getProgress(), wordPrefs: getWordPrefs(),
    customWords: await listCustomWords(), blobs,
  };
}
export async function importBackup(data) {
  if (!data || data.app !== 'life-words') throw new Error('這不是生活認知卡的備份檔');
  if (data.settings) saveSettings(data.settings);
  if (data.progress) lsSet('progress', data.progress);
  if (data.wordPrefs) lsSet('wordPrefs', data.wordPrefs);
  for (const w of data.customWords || []) await saveCustomWord(w);
  for (const [k, url] of Object.entries(data.blobs || {})) {
    const b = await (await fetch(url)).blob();
    await putBlob(k, b);
  }
}
