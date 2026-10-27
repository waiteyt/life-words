// 圖片：優先用家長自己拍的照片，其次是家長挑選的圖，再來是維基百科條目的代表照片。
// 圖片在使用時才從維基媒體載入，不存放在 repo 裡。
import { getBlob, getWordPrefs, lsGet, lsSet } from './store.js';

const WIKI_API = 'https://en.wikipedia.org/w/api.php';
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const CACHE_KEY = 'wikiThumbs';
const THUMB = 640;

let cache = lsGet(CACHE_KEY, {});   // wiki 條目 → {u: 圖片網址, f: 檔名} 或 null（沒有圖）
const objectUrls = new Map();

function saveCache() { lsSet(CACHE_KEY, cache); }

export async function prefetchWiki(titles) {
  const need = [...new Set(titles.filter(t => t && !(t in cache)))];
  for (let i = 0; i < need.length; i += 40) {
    const batch = need.slice(i, i + 40);
    const params = new URLSearchParams({
      action: 'query', format: 'json', origin: '*', redirects: '1',
      prop: 'pageimages', piprop: 'thumbnail|name', pithumbsize: String(THUMB),
      titles: batch.join('|'),
    });
    try {
      const r = await fetch(`${WIKI_API}?${params}`);
      const j = await r.json();
      const q = j.query || {};
      // 原始標題 → 正規化 → 重新導向後的標題
      const map = {};
      for (const t of batch) map[t] = t;
      for (const n of q.normalized || []) for (const k in map) if (map[k] === n.from) map[k] = n.to;
      for (const n of q.redirects || []) for (const k in map) if (map[k] === n.from) map[k] = n.to;
      const pages = Object.values(q.pages || {});
      for (const t of batch) {
        const p = pages.find(p => p.title === map[t]);
        cache[t] = p && p.thumbnail ? { u: p.thumbnail.source, f: p.pageimage } : null;
      }
    } catch {
      // 離線時先不記錄，下次再試
    }
  }
  saveCache();
}

export async function imageFor(word) {
  const pref = getWordPrefs()[word.id] || {};
  const photo = await getBlob(`${word.id}:photo`);
  if (photo) {
    if (!objectUrls.has(word.id)) objectUrls.set(word.id, URL.createObjectURL(photo));
    return { src: objectUrls.get(word.id), kind: 'photo' };
  }
  if (pref.img) return { src: pref.img, kind: 'picked', file: pref.imgFile };
  if (word.wiki) {
    if (!(word.wiki in cache)) await prefetchWiki([word.wiki]);
    const c = cache[word.wiki];
    if (c) return { src: c.u, kind: 'wiki', file: c.f };
  }
  return { emoji: word.emoji || '❔', kind: 'emoji' };
}

export function forgetPhoto(wordId) {
  const u = objectUrls.get(wordId);
  if (u) { URL.revokeObjectURL(u); objectUrls.delete(wordId); }
}

// 家長換圖時，到維基共享資源搜尋其他照片
export async function searchCommons(query, limit = 12) {
  const params = new URLSearchParams({
    action: 'query', format: 'json', origin: '*',
    generator: 'search', gsrnamespace: '6', gsrlimit: String(limit),
    gsrsearch: `${query} filetype:bitmap`,
    prop: 'imageinfo', iiprop: 'url', iiurlwidth: String(THUMB),
  });
  const r = await fetch(`${COMMONS_API}?${params}`);
  const j = await r.json();
  return Object.values(j.query?.pages || {})
    .sort((a, b) => (a.index || 0) - (b.index || 0))
    .map(p => ({ src: p.imageinfo?.[0]?.thumburl, file: p.title.replace(/^File:/, '') }))
    .filter(x => x.src);
}

export function sourceLink(img) {
  if (!img || !img.file) return null;
  return 'https://commons.wikimedia.org/wiki/File:' + encodeURIComponent(img.file.replace(/ /g, '_'));
}

// 把圖片或 emoji 放進容器
export function renderImage(el, img, word) {
  el.textContent = '';
  if (img.src) {
    const im = new Image();
    im.alt = word ? word.zh : '';
    im.decoding = 'async';
    im.src = img.src;
    im.onerror = () => { el.textContent = ''; el.append(emojiNode(word && word.emoji)); };
    el.append(im);
  } else {
    el.append(emojiNode(img.emoji));
  }
}
function emojiNode(e) {
  const s = document.createElement('span');
  s.className = 'emoji';
  s.textContent = e || '❔';
  return s;
}
