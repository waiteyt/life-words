// 圖卡：每個詞準備 2～4 張不同的圖，幫孩子（和大人）認出是什麼。
// 來源順序：家長拍的照片 → 家長挑的圖 → 維基百科／維基共享資源的真實照片 → 程式畫的圖（顏色、形狀）→ 卡通（emoji）。
// 照片在使用時才從維基媒體載入，不存放在 repo 裡。
import { getBlob, getWordPrefs, lsGet, lsSet } from './store.js';

const WIKI_API = 'https://en.wikipedia.org/w/api.php';
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const CACHE_KEY = 'wikiThumbs';
const THUMB = 640;

let cache = lsGet(CACHE_KEY, {});   // 沒有預先整理的條目，執行時查到的代表圖
let gallery = null;                 // data/images.json：維基條目 → 檔名或網址陣列
const objectUrls = new Map();

export async function loadGallery() {
  if (gallery) return gallery;
  try { gallery = await (await fetch('data/images.json')).json(); }
  catch { gallery = {}; }
  return gallery;
}

function fileUrl(name, width = 480) {
  if (/^https?:/.test(name)) return name;
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(name)}?width=${width}`;
}

export async function prefetchWiki(titles) {
  await loadGallery();
  const need = [...new Set(titles.filter(t => t && !(gallery[t] && gallery[t].length) && !(t in cache)))];
  for (let i = 0; i < need.length; i += 40) {
    const batch = need.slice(i, i + 40);
    const params = new URLSearchParams({
      action: 'query', format: 'json', origin: '*', redirects: '1',
      prop: 'pageimages', piprop: 'thumbnail|name', pithumbsize: String(THUMB),
      titles: batch.join('|'),
    });
    try {
      const j = await (await fetch(`${WIKI_API}?${params}`)).json();
      const q = j.query || {};
      const map = {};
      for (const t of batch) map[t] = t;
      for (const n of q.normalized || []) for (const k in map) if (map[k] === n.from) map[k] = n.to;
      for (const n of q.redirects || []) for (const k in map) if (map[k] === n.from) map[k] = n.to;
      const pages = Object.values(q.pages || {});
      for (const t of batch) {
        const p = pages.find(p => p.title === map[t]);
        cache[t] = p && p.thumbnail ? { u: p.thumbnail.source, f: p.pageimage } : null;
      }
    } catch { /* 離線時下次再試 */ }
  }
  lsSet(CACHE_KEY, cache);
}

// ---------- 程式畫的圖 ----------
const COLORS = {
  紅色: ['#E53935', '🍎🍓🚒'], 橘色: ['#FB8C00', '🍊🥕🎃'], 黃色: ['#FDD835', '🍌🌻🐥'],
  綠色: ['#43A047', '🥦🐸🍀'], 藍色: ['#1E88E5', '🐳🫐💙'], 紫色: ['#8E24AA', '🍇🍆💜'],
  粉紅色: ['#F48FB1', '🌸🐷🎀'], 白色: ['#FFFFFF', '☁️🥛🐑'], 黑色: ['#212121', '🐈‍⬛🕶️🎱'],
  咖啡色: ['#795548', '🐻🍫🪵'], 灰色: ['#9E9E9E', '🐘🐭🪨'], 金色: ['#E8B923', '🥇🏆👑'], 銀色: ['#BFC5CC', '🥈🥄🔔'],
};
const SHAPES = {
  圓形: '<circle cx="100" cy="100" r="70"/>',
  正方形: '<rect x="35" y="35" width="130" height="130" rx="6"/>',
  三角形: '<polygon points="100,28 172,160 28,160"/>',
  長方形: '<rect x="20" y="55" width="160" height="90" rx="6"/>',
  星形: '<polygon points="100,22 121,78 180,80 133,116 150,174 100,140 50,174 67,116 20,80 79,78"/>',
  愛心: '<path d="M100 170 C 30 120, 20 70, 55 48 C 78 34, 95 48, 100 62 C 105 48, 122 34, 145 48 C 180 70, 170 120, 100 170 Z"/>',
  菱形: '<polygon points="100,22 170,100 100,178 30,100"/>',
  月亮形: '<path d="M125 30 A 72 72 0 1 0 125 170 A 56 56 0 1 1 125 30 Z"/>',
};
function svgUrl(inner) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" fill="#fff"/>${inner}</svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}
function drawnCards(word) {
  const out = [];
  const c = COLORS[word.zh];
  if (c) {
    const [hex, things] = c;
    // 整張塗滿顏色，避免跟「圓形」搞混
    out.push({ src: svgUrl(`<rect x="10" y="10" width="180" height="180" rx="18" fill="${hex}" stroke="#1F2A55" stroke-width="5"/>`), kind: 'drawn' });
    out.push({ emoji: things, kind: 'cartoon' });
  }
  const s = SHAPES[word.zh];
  if (s) {
    out.push({ src: svgUrl(`<g fill="#FFC83D" stroke="#1F2A55" stroke-width="7" stroke-linejoin="round">${s}</g>`), kind: 'drawn' });
    out.push({ src: svgUrl(`<g fill="none" stroke="#1E88E5" stroke-width="12" stroke-linejoin="round" transform="translate(100 100) scale(.8) translate(-100 -100)">${s}</g>`), kind: 'drawn' });
  }
  return out;
}

// emoji 只是色塊、形狀時，當不了卡通圖
const NOT_PICTURE = new Set(['🟣', '🔴', '⚪', '⬜', '🟫', '🟩', '🟥', '🟨', '⬛', '🔷', '🔺', '▬', '⭕', '🟠', '🟡', '🟢', '🔵', '⚫', '🟤', '🩷', '🩶', '🔲', '🔳', '❔', '〰️']);

// 一個詞的所有圖卡（第一張是主圖）
export async function imagesFor(word) {
  await loadGallery();
  const cards = [];
  const seen = new Set();
  const add = c => { const k = c.src || c.emoji; if (k && !seen.has(k)) { seen.add(k); cards.push(c); } };
  const pref = getWordPrefs()[word.id] || {};
  const photo = await getBlob(`${word.id}:photo`);
  if (photo) {
    if (!objectUrls.has(word.id)) objectUrls.set(word.id, URL.createObjectURL(photo));
    add({ src: objectUrls.get(word.id), kind: 'photo' });
  }
  if (pref.img) add({ src: pref.img, kind: 'picked', file: pref.imgFile });
  if (word.wiki && !pref.noWiki) {
    const g = gallery[word.wiki];
    if (g && g.length) {
      for (const name of g) if (!(pref.hideImgs || []).includes(name)) add({ src: fileUrl(name), kind: 'wiki', file: /^https?:/.test(name) ? null : name });
    } else {
      if (!(word.wiki in cache)) await prefetchWiki([word.wiki]);
      const c = cache[word.wiki];
      if (c) add({ src: c.u, kind: 'wiki', file: c.f });
    }
  }
  for (const d of drawnCards(word)) add(d);
  if (word.emoji && !NOT_PICTURE.has(word.emoji)) add({ emoji: word.emoji, kind: 'cartoon' });
  if (!cards.length) add({ emoji: word.emoji || '❔', kind: 'cartoon' });
  return cards;
}

export async function imageFor(word) { return (await imagesFor(word))[0]; }

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
  const j = await (await fetch(`${COMMONS_API}?${params}`)).json();
  return Object.values(j.query?.pages || {})
    .sort((a, b) => (a.index || 0) - (b.index || 0))
    .map(p => ({ src: p.imageinfo?.[0]?.thumburl, file: p.title.replace(/^File:/, '') }))
    .filter(x => x.src);
}

export function sourceLink(img) {
  if (!img || !img.file) return null;
  return 'https://commons.wikimedia.org/wiki/File:' + encodeURIComponent(img.file.replace(/ /g, '_'));
}

// 把一張圖卡放進容器
export function renderImage(el, img, word) {
  el.textContent = '';
  el.dataset.kind = img.kind || '';
  if (img.src) {
    const im = new Image();
    im.alt = word ? word.zh : '';
    im.decoding = 'async';
    im.src = img.src;
    im.onerror = () => { el.textContent = ''; el.append(emojiNode(word && !NOT_PICTURE.has(word.emoji) ? word.emoji : '🖼️')); };
    el.append(im);
  } else {
    el.append(emojiNode(img.emoji));
  }
}
function emojiNode(e) {
  const s = document.createElement('span');
  const n = [...new Intl.Segmenter('zh', { granularity: 'grapheme' }).segment(e || '')].length;
  s.className = 'emoji' + (n > 1 ? ' multi' : '');
  s.textContent = e || '❔';
  return s;
}
