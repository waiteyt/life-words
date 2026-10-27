// 在教育部《臺灣台語常用詞辭典》網站（https://sutian.moe.edu.tw/）的開發者主控台執行，
// 找出 words.json 裡每個台語漢字對應的詞目編號與錄音，結果存成 data/sutian-ids.json。
// 用法：打開辭典任一頁 → F12 主控台 → 貼上本檔內容 → 完成後會自動下載 sutian-ids.json。
(async () => {
  const WORDS_URL = 'https://waiteyt.github.io/life-words/data/words.json';
  const d = await (await fetch(WORDS_URL)).json();
  const hans = new Set();
  for (const w of d.words) {
    if (!w.tw) continue;
    hans.add(w.tw.han);
    for (const a of w.tw.alt || []) hans.add(a.han);
  }
  const out = {};
  const pageCache = {};
  async function page(id) {
    if (pageCache[id]) return pageCache[id];
    const doc = new DOMParser().parseFromString(await (await fetch('/zh-hant/su/' + id + '/')).text(), 'text/html');
    const btn = doc.querySelector('button[data-src*="/imtong/subak/"]');
    const lo = btn ? (btn.querySelector('.visually-hidden')?.textContent || '').replace('播放主音讀', '').trim() : '';
    return (pageCache[id] = { id: Number(id), lo, audio: btn ? btn.getAttribute('data-src') : null });
  }
  async function one(han) {
    const html = await (await fetch('/zh-hant/tshiau/?lui=tai_su&tsha=' + encodeURIComponent(han))).text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const ids = [...new Set([...doc.querySelectorAll('a[href*="/su/"]')]
      .filter(a => /\/su\/\d+/.test(a.getAttribute('href')) &&
        a.textContent.replace(/\s+/g, ' ').trim().replace(/^(白|文|替|俗)\s*/, '').split(' ')[0] === han)
      .map(a => a.getAttribute('href').match(/\/su\/(\d+)/)[1]))].slice(0, 4);
    const cands = [];
    for (const id of ids) cands.push(await page(id));
    out[han] = cands;
  }
  const queue = [...hans];
  let done = 0;
  async function worker() {
    while (queue.length) {
      const h = queue.shift();
      try { await one(h); } catch (e) { console.warn(h, e); }
      if (++done % 50 === 0) console.log(done, '/', hans.size);
      await new Promise(r => setTimeout(r, 120));   // 放慢速度，避免造成辭典網站負擔
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(out)], { type: 'application/json' }));
  a.download = 'sutian-ids.json';
  a.click();
})();
