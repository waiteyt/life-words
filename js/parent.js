// 家長區：設定、詞庫管理、新增我們家的東西、進度與備份
import { state, esc, toast, renderHome, loadData } from './app.js';
import {
  getSettings, saveSettings, getProgress, getWordPrefs, setWordPref,
  saveCustomWord, deleteCustomWord, putBlob, deleteBlob, exportBackup, importBackup,
} from './store.js';
import { say, listVoices, tts, recordClip } from './speech.js';
import { imageFor, renderImage, searchCommons, prefetchWiki, forgetPhoto, sourceLink } from './images.js';

const app = document.getElementById('app');
let tab = 'settings';

export function openParent(which) {
  if (which) tab = which;
  window.scrollTo(0, 0);
  app.innerHTML = `
    <section class="parent">
      <header class="parent-top">
        <h1>家長區</h1>
        <button class="secondary" id="close">回到遊戲</button>
      </header>
      <nav class="tabs" role="tablist">
        ${[['settings', '設定'], ['words', '詞庫'], ['add', '新增我們家的東西'], ['progress', '進度與備份']]
          .map(([k, n]) => `<button role="tab" class="tab ${tab === k ? 'on' : ''}" data-tab="${k}" aria-selected="${tab === k}">${n}</button>`).join('')}
      </nav>
      <div class="panel" id="panel"></div>
    </section>`;
  document.getElementById('close').onclick = renderHome;
  app.querySelectorAll('.tab').forEach(b => b.onclick = () => openParent(b.dataset.tab));
  const panel = document.getElementById('panel');
  ({ settings: renderSettings, words: renderWords, add: renderAdd, progress: renderProgress })[tab](panel);
}

// ---------- 設定 ----------
function renderSettings(panel) {
  const s = getSettings();
  const zhVoices = listVoices('zh'), enVoices = listVoices('en');
  const check = (path, label) => {
    const [a, b] = path.split('.');
    return `<label class="check"><input type="checkbox" data-path="${path}" ${s[a][b] ? 'checked' : ''}> ${label}</label>`;
  };
  panel.innerHTML = `
    <div class="form">
      <fieldset><legend>要用哪些語言</legend>
        ${check('langs.zh', '中文')}${check('langs.tw', '台語')}${check('langs.en', '英文')}
        <p class="hint">「聽聽看」會輪流用勾選的語言出題。台語只會用有錄音的詞出題。</p>
      </fieldset>
      <fieldset><legend>答案要顯示哪些字</legend>
        ${check('showText.zhuyin', '注音')}${check('showText.tw', '台語拼音')}${check('showText.en', '英文')}
      </fieldset>
      <fieldset><legend>「聽聽看」每題幾張圖</legend>
        <select id="choices">
          ${[['auto', '自動（答對變多、答錯變少）'], ['2', '2 張'], ['3', '3 張'], ['4', '4 張']]
            .map(([v, n]) => `<option value="${v}" ${String(s.choices) === v ? 'selected' : ''}>${n}</option>`).join('')}
        </select>
      </fieldset>
      <fieldset><legend>每次玩幾題</legend>
        <select id="roundSize">${[5, 8, 10, 15, 20].map(n => `<option ${s.roundSize === n ? 'selected' : ''}>${n}</option>`).join('')}</select>
      </fieldset>
      <fieldset><legend>說話速度</legend>
        <input type="range" id="rate" min="0.6" max="1.1" step="0.05" value="${s.rate}">
      </fieldset>
      <fieldset><legend>中文語音</legend>
        <select id="zhVoice"><option value="">自動挑選</option>${zhVoices.map(v => `<option ${s.zhVoice === v.name ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select>
        <button class="secondary small" id="testZh">試聽</button>
        ${zhVoices.length ? '' : '<p class="hint warn">這台裝置沒有找到台灣中文語音，請到系統設定加裝「中文（台灣）」語音。</p>'}
      </fieldset>
      <fieldset><legend>英文語音</legend>
        <select id="enVoice"><option value="">自動挑選</option>${enVoices.map(v => `<option ${s.enVoice === v.name ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select>
        <button class="secondary small" id="testEn">試聽</button>
        ${enVoices.length ? '' : '<p class="hint warn">這台裝置沒有英文語音，所以不會用英文出題。Windows 可到「設定 → 時間與語言 → 語音」加裝「English (United States)」；手機和平板通常已內建。</p>'}
      </fieldset>
      <fieldset><legend>台語錄音</legend>
        <button class="secondary small" id="testTw">試聽「西瓜」</button>
        <p class="hint">台語錄音來自教育部《臺灣台語常用詞辭典》。聽不到的話，可以在「詞庫」裡自己錄。</p>
      </fieldset>
    </div>`;
  const save = () => saveSettings(s);
  panel.querySelectorAll('[data-path]').forEach(i => i.onchange = () => { const [a, b] = i.dataset.path.split('.'); s[a][b] = i.checked; save(); });
  panel.querySelector('#choices').onchange = e => { s.choices = e.target.value === 'auto' ? 'auto' : Number(e.target.value); save(); };
  panel.querySelector('#roundSize').onchange = e => { s.roundSize = Number(e.target.value); save(); };
  panel.querySelector('#rate').oninput = e => { s.rate = Number(e.target.value); save(); };
  panel.querySelector('#zhVoice').onchange = e => { s.zhVoice = e.target.value; save(); };
  panel.querySelector('#enVoice').onchange = e => { s.enVoice = e.target.value; save(); };
  panel.querySelector('#testZh').onclick = () => tts('這是軌跡球', 'zh');
  panel.querySelector('#testEn').onclick = () => tts('This is a trackball', 'en');
  panel.querySelector('#testTw').onclick = async () => {
    const w = state.words.find(x => x.zh === '西瓜');
    const ok = w && await say(w, 'tw');
    if (!ok) toast('台語錄音載入失敗，可能是網路問題');
  };
}

// ---------- 詞庫 ----------
let wordFilter = { q: '', cat: '' , page: 0 };
const PAGE = 40;

function renderWords(panel) {
  panel.innerHTML = `
    <div class="word-tools">
      <input type="search" id="q" placeholder="搜尋中文或英文" value="${esc(wordFilter.q)}">
      <select id="cat"><option value="">全部分類</option>${state.categories.map(c => `<option value="${esc(c.id)}" ${wordFilter.cat === c.id ? 'selected' : ''}>${esc(c.icon)} ${esc(c.name)}</option>`).join('')}</select>
    </div>
    <p class="hint">點圖片可以換圖；錄音會蓋過電腦語音，讓孩子聽到家人的聲音。</p>
    <div class="word-list" id="list"></div>
    <div class="pager" id="pager"></div>`;
  const q = panel.querySelector('#q'), cat = panel.querySelector('#cat');
  q.oninput = () => { wordFilter.q = q.value.trim(); wordFilter.page = 0; drawList(panel); };
  cat.onchange = () => { wordFilter.cat = cat.value; wordFilter.page = 0; drawList(panel); };
  drawList(panel);
}

function filteredWords() {
  const q = wordFilter.q.toLowerCase();
  return state.words.filter(w =>
    (!wordFilter.cat || w.cat === wordFilter.cat) &&
    (!q || w.zh.includes(q) || (w.en || '').toLowerCase().includes(q) || (w.tw && w.tw.han.includes(q))));
}

async function drawList(panel) {
  const list = panel.querySelector('#list'), pager = panel.querySelector('#pager');
  const all = filteredWords();
  const pages = Math.max(1, Math.ceil(all.length / PAGE));
  wordFilter.page = Math.min(wordFilter.page, pages - 1);
  const items = all.slice(wordFilter.page * PAGE, (wordFilter.page + 1) * PAGE);
  const prefs = getWordPrefs();
  list.innerHTML = items.map(w => {
    const p = prefs[w.id] || {};
    const has = l => state.recKeys.has(`${w.id}:rec:${l}`);
    return `
    <article class="word-row ${p.hidden ? 'is-hidden' : ''}" data-id="${esc(w.id)}">
      <button class="thumb sticker" data-act="img" aria-label="換圖"><figure></figure></button>
      <div class="word-info">
        <div class="wz">${esc(w.zh)} <small>${esc(w.zhuyin || '')}</small></div>
        <div class="we">${esc(w.en || '')}</div>
        <div class="wt">${w.tw ? `台：${esc(w.tw.han)} ${esc(w.tw.lo || '')}${w.tw.sid ? ' 🔈' : ''}${w.tw.src === 'auto' ? ' <span class="badge">辭典對照</span>' : ''}` : '<span class="muted">沒有台語</span>'}</div>
      </div>
      <div class="word-acts">
        <button class="small" data-act="play-zh">中</button>
        <button class="small" data-act="play-tw" ${w.tw ? '' : 'disabled'}>台</button>
        <button class="small" data-act="play-en">EN</button>
        <button class="small ${has('zh') ? 'has' : ''}" data-act="rec-zh">🎙中</button>
        <button class="small ${has('tw') ? 'has' : ''}" data-act="rec-tw">🎙台</button>
        <button class="small" data-act="edit-tw">改台語</button>
        <button class="small" data-act="hide">${p.hidden ? '顯示' : '隱藏'}</button>
      </div>
    </article>`;
  }).join('') || '<p class="empty">找不到符合的詞。可以到「新增我們家的東西」自己加。</p>';
  pager.innerHTML = pages > 1 ? `
    <button class="secondary small" id="prev" ${wordFilter.page ? '' : 'disabled'}>上一頁</button>
    <span>${wordFilter.page + 1} / ${pages}（共 ${all.length} 個）</span>
    <button class="secondary small" id="next" ${wordFilter.page < pages - 1 ? '' : 'disabled'}>下一頁</button>` : `<span>共 ${all.length} 個</span>`;
  pager.querySelector('#prev')?.addEventListener('click', () => { wordFilter.page--; drawList(panel); });
  pager.querySelector('#next')?.addEventListener('click', () => { wordFilter.page++; drawList(panel); });

  list.querySelectorAll('.word-row').forEach(row => {
    const w = state.byId.get(row.dataset.id);
    row.querySelectorAll('[data-act]').forEach(b => b.onclick = () => wordAction(w, b.dataset.act, panel));
  });
  await prefetchWiki(items.map(w => w.wiki).filter(Boolean));
  for (const row of list.querySelectorAll('.word-row')) {
    const w = state.byId.get(row.dataset.id);
    renderImage(row.querySelector('figure'), await imageFor(w), w);
  }
}

async function wordAction(w, act, panel) {
  if (act.startsWith('play-')) {
    const ok = await say(w, act.slice(5));
    if (!ok && act === 'play-tw') toast('這個詞沒有台語錄音，可以按「🎙台」自己錄');
    return;
  }
  if (act.startsWith('rec-')) return recordDialog(w, act.slice(4), () => drawList(panel));
  if (act === 'hide') {
    setWordPref(w.id, { hidden: getWordPrefs()[w.id]?.hidden ? null : true });
    return drawList(panel);
  }
  if (act === 'edit-tw') return editTaigi(w, () => drawList(panel));
  if (act === 'img') return imageDialog(w, () => drawList(panel));
}

function dialog(html) {
  const d = document.createElement('dialog');
  d.className = 'dlg';
  d.innerHTML = html;
  document.body.append(d);
  d.addEventListener('close', () => d.remove());
  d.showModal();
  return d;
}

function recordDialog(w, lang, after) {
  const name = { zh: '中文', tw: '台語', en: '英文' }[lang];
  const d = dialog(`
    <h2>錄${name}：${esc(w.zh)}</h2>
    <p class="hint">${lang === 'tw' && w.tw ? `台語：${esc(w.tw.han)} ${esc(w.tw.lo || '')}` : '用平常跟孩子說話的方式唸一次。'}</p>
    <div class="rec-ui">
      <button class="primary" id="recBtn">🎙 開始錄音</button>
      <button class="secondary" id="playBtn" ${state.recKeys.has(`${w.id}:rec:${lang}`) ? '' : 'disabled'}>▶ 播放</button>
      <button class="secondary" id="delBtn" ${state.recKeys.has(`${w.id}:rec:${lang}`) ? '' : 'disabled'}>刪除錄音</button>
    </div>
    <form method="dialog"><button class="secondary">完成</button></form>`);
  const key = `${w.id}:rec:${lang}`;
  let rec = null;
  d.querySelector('#recBtn').onclick = async e => {
    const b = e.currentTarget;
    if (rec) { rec.stop(); return; }
    try {
      rec = await recordClip(4000);
      b.textContent = '■ 停止（最多 4 秒）'; b.classList.add('recording');
      const blob = await rec.done;
      rec = null; b.textContent = '🎙 重錄'; b.classList.remove('recording');
      await putBlob(key, blob); state.recKeys.add(key);
      d.querySelector('#playBtn').disabled = false; d.querySelector('#delBtn').disabled = false;
      say(w, lang);
    } catch { rec = null; toast('無法使用麥克風，請允許瀏覽器使用麥克風'); }
  };
  d.querySelector('#playBtn').onclick = () => say(w, lang);
  d.querySelector('#delBtn').onclick = async () => {
    await deleteBlob(key); state.recKeys.delete(key);
    d.querySelector('#playBtn').disabled = true; d.querySelector('#delBtn').disabled = true;
  };
  d.addEventListener('close', after);
}

function editTaigi(w, after) {
  const d = dialog(`
    <h2>修改台語：${esc(w.zh)}</h2>
    <form method="dialog" class="form">
      <label>台語漢字 <input id="han" value="${esc(w.tw?.han || '')}" placeholder="例：跤踏車"></label>
      <label>台羅拼音 <input id="lo" value="${esc(w.tw?.lo || '')}" placeholder="例：kha-ta̍h-tshia"></label>
      ${w.tw?.alt?.length ? `<p class="hint">辭典裡的其他說法：${w.tw.alt.map(a => `<button type="button" class="chip alt" data-han="${esc(a.han)}" data-lo="${esc(a.lo)}" data-sid="${a.sid || ''}">${esc(a.han)} ${esc(a.lo)}</button>`).join(' ')}</p>` : ''}
      <p class="hint">自己改的台語沒有辭典錄音，記得按「🎙台」錄一次。清空就代表不用台語。</p>
      <div class="dlg-acts"><button class="primary" value="save">儲存</button><button class="secondary" value="cancel">取消</button></div>
    </form>`);
  let pickedId = null;
  d.querySelectorAll('.alt').forEach(b => b.onclick = () => {
    d.querySelector('#han').value = b.dataset.han; d.querySelector('#lo').value = b.dataset.lo; pickedId = Number(b.dataset.sid) || null;
  });
  d.addEventListener('close', () => {
    if (d.returnValue !== 'save') return;
    const han = d.querySelector('#han').value.trim(), lo = d.querySelector('#lo').value.trim();
    const keep = w.tw && w.tw.han === han ? w.tw.sid : null;
    const tw = han ? { han, lo, sid: pickedId || keep || null, src: 'parent' } : null;
    w.tw = tw;
    setWordPref(w.id, { tw });
    if (w.custom) saveCustomWord(stripRuntime(w));
    after();
  });
}

function imageDialog(w, after) {
  const d = dialog(`
    <h2>換圖：${esc(w.zh)}</h2>
    <div class="img-now"><figure class="sticker" id="now"></figure><p class="hint" id="src"></p></div>
    <div class="img-actions">
      <label class="primary file-btn">📷 拍照或選照片<input type="file" accept="image/*" capture="environment" id="file" hidden></label>
      <button class="secondary" id="reset">還原預設圖</button>
    </div>
    <form class="search-row" id="sform"><input id="sq" value="${esc(w.en || w.zh)}"><button class="secondary">搜尋其他照片</button></form>
    <div class="img-grid" id="grid"></div>
    <form method="dialog"><button class="secondary">完成</button></form>`);
  const showNow = async () => {
    const img = await imageFor(w);
    renderImage(d.querySelector('#now'), img, w);
    const link = sourceLink(img);
    d.querySelector('#src').innerHTML = img.kind === 'photo' ? '這是你拍的照片（只存在這台裝置）'
      : link ? `圖片來源：<a href="${link}" target="_blank" rel="noopener">維基共享資源</a>` : '目前顯示 emoji';
  };
  showNow();
  d.querySelector('#file').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    const blob = await shrinkImage(f);
    await putBlob(`${w.id}:photo`, blob); forgetPhoto(w.id);
    showNow();
  };
  d.querySelector('#reset').onclick = async () => {
    await deleteBlob(`${w.id}:photo`); forgetPhoto(w.id);
    setWordPref(w.id, { img: null, imgFile: null });
    showNow();
  };
  d.querySelector('#sform').onsubmit = async e => {
    e.preventDefault();
    const grid = d.querySelector('#grid');
    grid.innerHTML = '<p class="hint">搜尋中…</p>';
    try {
      const res = await searchCommons(d.querySelector('#sq').value.trim());
      grid.innerHTML = res.length ? '' : '<p class="hint">沒有找到照片，換個英文關鍵字試試。</p>';
      for (const r of res) {
        const b = document.createElement('button');
        b.className = 'img-pick'; b.type = 'button';
        b.innerHTML = `<img src="${esc(r.src)}" alt="">`;
        b.onclick = async () => {
          await deleteBlob(`${w.id}:photo`); forgetPhoto(w.id);
          setWordPref(w.id, { img: r.src, imgFile: r.file });
          showNow();
        };
        grid.append(b);
      }
    } catch { grid.innerHTML = '<p class="hint">搜尋失敗，請確認網路。</p>'; }
  };
  d.addEventListener('close', after);
}

// 照片縮小到最長邊 800px，省空間
async function shrinkImage(file) {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 800 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
  } catch { return file; }
}

function stripRuntime(w) {
  const { cat, level, custom, ...rest } = w;
  return rest;
}

// ---------- 新增我們家的東西 ----------
function renderAdd(panel) {
  const ours = state.words.filter(w => w.custom);
  panel.innerHTML = `
    <form class="form add-form" id="addForm">
      <p class="hint">家裡、車上、爸爸媽媽工作用的東西，拍下來就能變成題目。照片和錄音只存在這台裝置，不會上傳。</p>
      <div class="add-photo">
        <figure class="sticker" id="preview"><span class="emoji">📷</span></figure>
        <label class="primary file-btn">拍照或選照片<input type="file" accept="image/*" capture="environment" id="photo" hidden></label>
      </div>
      <label>中文名稱 <input id="zh" required placeholder="例：簡報筆"></label>
      <label>英文名稱 <input id="en" placeholder="例：presentation clicker"></label>
      <label>台語漢字 <input id="twhan" placeholder="可不填"></label>
      <label>台羅拼音 <input id="twlo" placeholder="可不填"></label>
      <p class="hint">存好之後，到「詞庫」選「我們家的」分類，就能幫它錄中文和台語。</p>
      <button class="primary" id="save">加進題目</button>
    </form>
    <h2 class="sub">我們家的東西（${ours.length}）</h2>
    <div class="word-list">
      ${ours.map(w => `<article class="word-row" data-id="${esc(w.id)}"><figure class="thumb sticker"></figure>
        <div class="word-info"><div class="wz">${esc(w.zh)}</div><div class="we">${esc(w.en || '')}</div></div>
        <div class="word-acts"><button class="small" data-del="${esc(w.id)}">刪除</button></div></article>`).join('') || '<p class="empty">還沒有加任何東西。先從孩子最常指著問的東西開始。</p>'}
    </div>`;
  let photo = null;
  panel.querySelector('#photo').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    photo = await shrinkImage(f);
    const pv = panel.querySelector('#preview');
    pv.innerHTML = `<img src="${URL.createObjectURL(photo)}" alt="">`;
  };
  panel.querySelector('#addForm').onsubmit = async e => {
    e.preventDefault();
    const zh = panel.querySelector('#zh').value.trim();
    if (!zh) return;
    if (!photo) { toast('先拍一張照片'); return; }
    const han = panel.querySelector('#twhan').value.trim();
    const w = {
      id: 'c' + Date.now().toString(36),
      zh, en: panel.querySelector('#en').value.trim(),
      tw: han ? { han, lo: panel.querySelector('#twlo').value.trim(), src: 'parent' } : null,
      emoji: '🏡', created: Date.now(),
    };
    await saveCustomWord(w);
    await putBlob(`${w.id}:photo`, photo);
    await loadData();
    toast(`已加入「${zh}」`);
    openParent('add');
  };
  panel.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    const w = state.byId.get(b.dataset.del);
    if (!confirm(`要刪除「${w.zh}」和它的照片、錄音嗎？`)) return;
    await deleteCustomWord(w.id); forgetPhoto(w.id);
    await loadData(); openParent('add');
  });
  panel.querySelectorAll('.word-row').forEach(async row => {
    const w = state.byId.get(row.dataset.id);
    if (w) renderImage(row.querySelector('figure'), await imageFor(w), w);
  });
}

// ---------- 進度與備份 ----------
function renderProgress(panel) {
  const prog = getProgress();
  const stat = mode => {
    const entries = Object.entries(prog).filter(([k]) => k.endsWith(':' + mode));
    return { seen: entries.length, known: entries.filter(([, p]) => p.box >= 3).length };
  };
  const sayS = stat('say'), tapS = stat('tap');
  const recent = Object.entries(prog).sort((a, b) => (b[1].last || 0) - (a[1].last || 0)).slice(0, 30);
  const hard = Object.entries(prog).filter(([, p]) => p.seen >= 2 && p.ok / p.seen < 0.5).slice(0, 30);
  const name = k => esc(state.byId.get(k.split(':')[0])?.zh || '已刪除');
  panel.innerHTML = `
    <div class="stats">
      <div class="stat"><b>${sayS.known}</b><span>會說（看圖說）</span><small>玩過 ${sayS.seen} 個</small></div>
      <div class="stat"><b>${tapS.known}</b><span>聽得懂（聽聽看）</span><small>玩過 ${tapS.seen} 個</small></div>
    </div>
    <p class="hint">同一個詞連續答對 3 次以上，才算「會說」或「聽得懂」。</p>
    ${hard.length ? `<h2 class="sub">還不熟的</h2><p class="word-chips">${hard.map(([k]) => `<span class="chip">${name(k)}</span>`).join('')}</p>` : ''}
    ${recent.length ? `<h2 class="sub">最近玩過</h2><p class="word-chips">${recent.map(([k, p]) => `<span class="chip ${p.box >= 3 ? 'on' : ''}">${name(k)}</span>`).join('')}</p>` : ''}
    <h2 class="sub">備份</h2>
    <p class="hint">進度、自己拍的照片和錄音都只存在這台裝置。換手機或平板前，先下載備份，再到新裝置還原。</p>
    <div class="dlg-acts">
      <button class="primary" id="exp">下載備份</button>
      <label class="secondary file-btn">還原備份<input type="file" accept="application/json,.json" id="imp" hidden></label>
    </div>
    <h2 class="sub">資料來源</h2>
    <p class="hint">注音：教育部《重編國語辭典修訂本》（萌典整理）。台語：教育部《臺灣台語常用詞辭典》（CC BY-ND 3.0 TW，ChhoeTaigi 整理）。照片：維基百科與維基共享資源，各圖授權見圖片來源頁。</p>`;
  panel.querySelector('#exp').onclick = async () => {
    const data = await exportBackup();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
    a.download = `生活認知卡備份-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };
  panel.querySelector('#imp').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { await importBackup(JSON.parse(await f.text())); await loadData(); toast('備份已還原'); openParent('progress'); }
    catch (err) { toast('還原失敗：' + err.message); }
  };
}
