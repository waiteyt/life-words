import { getSettings, saveSettings, getProgress, recordAnswer, getWordPrefs, listCustomWords, listBlobKeys } from './store.js';
import { say, stopAll, canSay, listenForVoice, releaseMic } from './speech.js';
import { prefetchWiki, imageFor, imagesFor, renderImage, loadGallery } from './images.js';
import { openParent } from './parent.js';
import { chime, buzz } from './sfx.js';

export const state = {
  categories: [],
  words: [],          // 內建詞條 + 我們家的詞條
  byId: new Map(),
  recKeys: new Set(), // 已錄音的 key
};

const app = document.getElementById('app');
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const LANG_NAME = { zh: '中文', tw: '台語', en: '英文' };
const LANG_SHORT = { zh: '中', tw: '台', en: 'EN' };

export async function loadData() {
  const r = await fetch('data/words.json');
  const d = await r.json();
  state.categories = d.categories;
  const custom = await listCustomWords();
  if (custom.length) state.categories.unshift({ id: 'ours', name: '我們家的', icon: '🏡', count: custom.length });
  state.words = [...custom.map(w => ({ ...w, cat: 'ours', level: 0, custom: true })), ...d.words];
  state.byId = new Map(state.words.map(w => [w.id, w]));
  state.recKeys = new Set((await listBlobKeys()).filter(k => k.includes(':rec:')));
  // 套用家長修改的台語
  const prefs = getWordPrefs();
  for (const w of state.words) {
    const p = prefs[w.id];
    if (p && p.tw !== undefined) w.tw = p.tw;
  }
}

export function activePool(settings = getSettings()) {
  const prefs = getWordPrefs();
  const cats = settings.cats.length ? new Set(settings.cats) : null;
  return state.words.filter(w => {
    if (prefs[w.id]?.hidden) return false;
    if (cats && !cats.has(w.cat)) return false;
    if (w.custom) return true;
    return settings.levels.includes(w.level);
  });
}

function pickRound(mode, settings) {
  const pool = activePool(settings);
  const prog = getProgress();
  const now = Date.now();
  const due = [], fresh = [], later = [];
  for (const w of pool) {
    const p = prog[w.id + ':' + mode];
    if (!p) fresh.push(w);
    else if (p.due <= now) due.push([w, p]);
    else later.push([w, p]);
  }
  due.sort((a, b) => a[1].due - b[1].due);
  later.sort((a, b) => a[1].due - b[1].due);
  const n = Math.min(settings.roundSize, pool.length);
  const out = due.slice(0, Math.ceil(n * 0.7)).map(x => x[0]);
  // 新詞：先拿我們家的，其他隨機挑，每次玩到不同分類
  const freshPick = [...shuffle(fresh.filter(w => w.custom)), ...shuffle(fresh.filter(w => !w.custom))];
  for (const w of freshPick) { if (out.length >= n) break; out.push(w); }
  for (const [w] of due.slice(out.length)) { if (out.length >= n) break; if (!out.includes(w)) out.push(w); }
  for (const [w] of later) { if (out.length >= n) break; out.push(w); }
  return shuffle(out);
}

// ---------- 首頁 ----------
export function renderHome() {
  stopAll(); releaseMic();
  window.scrollTo(0, 0);
  const s = getSettings();
  const pool = activePool(s);
  const catSel = new Set(s.cats);
  app.innerHTML = `
    <section class="home">
      <header class="home-top">
        <h1 class="logo"><span class="logo-mark" aria-hidden="true">🔎</span>這是什麼？</h1>
        <button class="parent-btn" id="parentBtn" aria-label="家長設定（長按）"><span class="ring"></span>⚙︎<small>按住</small></button>
      </header>
      <div class="modes">
        <button class="mode mode-say" data-mode="say">
          <span class="mode-pic" aria-hidden="true">🖼️💬</span>
          <span class="mode-name">看圖說說看</span>
          <span class="mode-desc">看到東西，說出名字</span>
        </button>
        <button class="mode mode-tap" data-mode="tap">
          <span class="mode-pic" aria-hidden="true">👂👆</span>
          <span class="mode-name">聽聽看，點點看</span>
          <span class="mode-desc">聽到名字，點對的圖</span>
        </button>
      </div>
      <div class="pick">
        <div class="pick-head">
          <h2>今天玩哪些？</h2>
          <div class="levels" role="group" aria-label="詞彙範圍">
            <button class="chip ${s.levels.includes(1) && !s.levels.includes(2) ? 'on' : ''}" data-level="1">常見的</button>
            <button class="chip ${s.levels.includes(2) ? 'on' : ''}" data-level="all">全部</button>
          </div>
        </div>
        <p class="pool-count">${catSel.size ? '選了 ' + catSel.size + ' 類，' : '全部分類，'}共 ${pool.length} 樣東西</p>
        <div class="cats">
          <button class="cat ${catSel.size ? '' : 'on'}" data-cat="">
            <span class="cat-ico">🌈</span><span>全部</span>
          </button>
          ${state.categories.map(c => `
            <button class="cat ${catSel.has(c.id) ? 'on' : ''}" data-cat="${esc(c.id)}">
              <span class="cat-ico">${esc(c.icon)}</span><span>${esc(c.name)}</span>
            </button>`).join('')}
        </div>
      </div>
    </section>`;

  app.querySelectorAll('.mode').forEach(b => b.onclick = () => {
    if (!activePool().length) { toast('選到的分類裡沒有東西，換個分類吧'); return; }
    startGame(b.dataset.mode);
  });
  app.querySelectorAll('[data-level]').forEach(b => b.onclick = () => {
    const st = getSettings();
    st.levels = b.dataset.level === 'all' ? [1, 2] : [1];
    saveSettings(st); renderHome();
  });
  app.querySelectorAll('.cat').forEach(b => b.onclick = () => {
    const st = getSettings();
    const id = b.dataset.cat;
    if (!id) st.cats = [];
    else {
      const set = new Set(st.cats);
      set.has(id) ? set.delete(id) : set.add(id);
      st.cats = [...set];
    }
    saveSettings(st); renderHome();
  });
  setupHold(document.getElementById('parentBtn'), () => openParent());
}

// 長按 1.5 秒才進家長區，避免孩子誤觸
function setupHold(el, fn) {
  let t = null;
  const start = e => { e.preventDefault(); el.classList.add('holding'); t = setTimeout(() => { el.classList.remove('holding'); fn(); }, 1500); };
  const cancel = () => { clearTimeout(t); el.classList.remove('holding'); };
  el.addEventListener('pointerdown', start);
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointerleave', cancel);
  el.addEventListener('contextmenu', e => e.preventDefault());
  el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') fn(); });
}

export function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), 2600);
}

// ---------- 遊戲共用 ----------
let game = null;

async function startGame(mode) {
  const settings = getSettings();
  const round = pickRound(mode, settings);
  prefetchWiki(round.map(w => w.wiki).filter(Boolean));
  game = { mode, settings, round, i: 0, results: [], streak: 0, choices: settings.choices === 'auto' ? 2 : settings.choices };
  if (mode === 'tap') {
    // 先把可能的干擾圖也一起預先載入
    const extra = activePool(settings).slice(0, 80).map(w => w.wiki).filter(Boolean);
    prefetchWiki(extra);
  }
  nextQuestion();
}

function gameShell(inner) {
  const g = game;
  window.scrollTo(0, 0);
  const dots = g.round.map((_, k) => `<i class="${k < g.i ? 'done' : k === g.i ? 'now' : ''}"></i>`).join('');
  app.innerHTML = `
    <section class="game game-${g.mode}">
      <header class="game-top">
        <button class="back" id="back" aria-label="回首頁">✕</button>
        <div class="dots" aria-label="第 ${g.i + 1} 題，共 ${g.round.length} 題">${dots}</div>
      </header>
      ${inner}
    </section>`;
  document.getElementById('back').onclick = renderHome;
}

function nextQuestion() {
  if (game.i >= game.round.length) return renderDone();
  if (game.mode === 'say') renderSay(); else renderTap();
}

function langsFor(word) {
  const s = game.settings;
  return ['zh', 'tw', 'en'].filter(l => s.langs[l] && canSay(word, l, state.recKeys));
}

export function wordText(w, show = getSettings().showText) {
  const zy = (w.zhuyin || '').split(' ');
  const chars = [...w.zh];
  const hanCount = chars.filter(c => /\p{Script=Han}/u.test(c)).length;
  let zhHtml;
  if (show.zhuyin && zy.length && zy.length === hanCount) {
    let k = 0;
    zhHtml = chars.map(c => /\p{Script=Han}/u.test(c) ? `<ruby>${esc(c)}<rt>${esc(zy[k++])}</rt></ruby>` : esc(c)).join('');
  } else zhHtml = esc(w.zh);
  return `
    <div class="name-zh">${zhHtml}</div>
    ${show.tw && w.tw ? `<div class="name-tw"><span class="tag">台</span>${esc(w.tw.han)} <span class="lo">${esc(w.tw.lo || '')}</span></div>` : ''}
    ${show.en && w.en ? `<div class="name-en"><span class="tag">EN</span>${esc(w.en)}</div>` : ''}`;
}

// ---------- 玩法一：看圖說說看 ----------
async function renderSay() {
  const w = game.round[game.i];
  const langs = langsFor(w);
  gameShell(`
    <div class="stage">
      <figure class="sticker big" id="pic"></figure>
      <div class="hints" id="hints" aria-label="其他圖卡"></div>
      <div class="answer" id="answer" hidden>${wordText(w)}</div>
      <div class="hear-row" id="hearRow" hidden>
        ${langs.map(l => `<button class="hear" data-lang="${l}">🔊 ${LANG_NAME[l]}</button>`).join('')}
      </div>
    </div>
    <div class="say-controls" id="ctrl">
      <button class="mic" id="mic"><span class="mic-meter" id="meter"></span><span class="mic-ico">🎤</span><span>說說看</span></button>
      <button class="peek" id="peek">👂 聽答案</button>
    </div>
    <div class="judge" id="judge" hidden>
      <span class="judge-label">家長判斷</span>
      <button class="ok" id="ok">✓ 說出來了</button>
      <button class="again" id="again">↻ 還要練習</button>
    </div>`);
  const cards = await imagesFor(w);
  const pic = document.getElementById('pic'), hints = document.getElementById('hints');
  renderImage(pic, cards[0], w);
  // 其他圖卡：點一下放大
  if (cards.length > 1) {
    cards.slice(0, 4).forEach((c, k) => {
      const b = document.createElement('button');
      b.className = 'hint sticker' + (k === 0 ? ' on' : '');
      b.setAttribute('aria-label', `第 ${k + 1} 張圖`);
      const f = document.createElement('figure');
      b.append(f);
      renderImage(f, c, w);
      b.onclick = () => {
        hints.querySelectorAll('.hint').forEach(x => x.classList.toggle('on', x === b));
        renderImage(pic, c, w);
      };
      hints.append(b);
    });
  }

  const reveal = async (heard) => {
    document.getElementById('answer').hidden = false;
    document.getElementById('hearRow').hidden = false;
    document.getElementById('ctrl').hidden = true;
    document.getElementById('judge').hidden = false;
    if (heard) { document.getElementById('pic').classList.add('pop'); chime(); await sleep(500); }
    for (const l of langs.slice(0, 1)) await say(w, l);
  };
  app.querySelectorAll('.hear').forEach(b => b.onclick = () => say(w, b.dataset.lang));
  document.getElementById('peek').onclick = () => reveal(false);
  document.getElementById('mic').onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.classList.add('listening');
    const meter = document.getElementById('meter');
    try {
      const heard = await listenForVoice({ timeoutMs: 6000, onLevel: v => meter.style.transform = `scale(${1 + v * 0.8})` });
      btn.classList.remove('listening');
      if (heard) reveal(true);
      else { btn.disabled = false; toast('沒聽到聲音，大聲一點再試一次，或按「聽答案」'); }
    } catch {
      btn.classList.remove('listening'); btn.disabled = false;
      toast('沒有麥克風權限，請孩子說出來後按「聽答案」');
    }
  };
  const finish = ok => { recordAnswer(w.id, 'say', ok); game.results.push({ w, ok }); game.i++; nextQuestion(); };
  document.getElementById('ok').onclick = () => finish(true);
  document.getElementById('again').onclick = () => finish(false);
}

// ---------- 玩法二：聽聽看，點點看 ----------
function pickDistractors(w, n) {
  const pool = activePool(game.settings).filter(x => x.id !== w.id && x.zh !== w.zh && x.emoji !== w.emoji && (!x.wiki || x.wiki !== w.wiki));
  // 選項少時挑不同類（比較容易分辨），選項多時混入同類（比較難）
  const same = shuffle(pool.filter(x => x.cat === w.cat));
  const other = shuffle(pool.filter(x => x.cat !== w.cat));
  const sameN = n >= 3 ? 1 : 0;
  const out = [...same.slice(0, sameN), ...other.slice(0, n - sameN)];
  for (const x of [...same, ...other]) { if (out.length >= n) break; if (!out.includes(x)) out.push(x); }
  return out.slice(0, n);
}

async function renderTap() {
  const w = game.round[game.i];
  const langs = langsFor(w);
  // 題目語言輪流換
  const lang = langs.length ? langs[game.i % langs.length] : 'zh';
  const n = game.settings.choices === 'auto' ? game.choices : Number(game.settings.choices);
  const opts = shuffle([w, ...pickDistractors(w, n - 1)]);
  gameShell(`
    <div class="prompt">
      <button class="speaker" id="speaker" aria-label="再聽一次"><span class="speaker-ico">🔊</span><span class="speaker-lang">${LANG_NAME[lang]}</span></button>
    </div>
    <div class="options n${opts.length}">
      ${opts.map(o => `<button class="option sticker" data-id="${esc(o.id)}" aria-label="選項"><figure class="main"></figure><span class="minis"></span></button>`).join('')}
    </div>
    <div class="answer tap-answer" id="answer" hidden>${wordText(w)}</div>`);
  const optEls = [...app.querySelectorAll('.option')];
  await Promise.all(optEls.map(async el => {
    const o = state.byId.get(el.dataset.id);
    const cs = await imagesFor(o);
    renderImage(el.querySelector('figure.main'), cs[0], o);
    // 主圖下面再放兩張小圖卡當提示
    const minis = el.querySelector('.minis');
    for (const c of cs.slice(1, 3)) {
      const f = document.createElement('figure');
      minis.append(f);
      renderImage(f, c, o);
    }
    if (!minis.children.length) minis.remove();
  }));
  const play = () => say(w, lang);
  document.getElementById('speaker').onclick = play;
  await sleep(250);
  play();

  let firstTry = true, locked = false;
  optEls.forEach(el => el.onclick = async () => {
    if (locked) return;
    const o = state.byId.get(el.dataset.id);
    if (o.id === w.id) {
      locked = true;
      el.classList.add('right'); chime();
      optEls.forEach(x => x !== el && x.classList.add('fade'));
      document.getElementById('answer').hidden = false;
      recordAnswer(w.id, 'tap', firstTry);
      game.results.push({ w, ok: firstTry });
      if (firstTry) { game.streak++; if (game.streak % 3 === 0) game.choices = Math.min(4, game.choices + 1); }
      else { game.streak = 0; }
      await say(w, lang);
      await sleep(900);
      game.i++; nextQuestion();
    } else {
      firstTry = false;
      if (game.settings.choices === 'auto') game.choices = Math.max(2, game.choices - 1);
      el.classList.remove('wrong'); void el.offsetWidth; el.classList.add('wrong');
      buzz();
      locked = true;
      // 告訴她點到的是什麼，再重聽一次題目
      await say(o, canSay(o, lang, state.recKeys) ? lang : 'zh');
      await sleep(300);
      locked = false;
      play();
    }
  });
}

// ---------- 結束 ----------
async function renderDone() {
  stopAll(); releaseMic();
  window.scrollTo(0, 0);
  const ok = game.results.filter(r => r.ok).length;
  app.innerHTML = `
    <section class="done">
      <div class="stars" aria-label="答對 ${ok} 題">${'⭐'.repeat(Math.max(1, Math.round(ok / Math.max(1, game.results.length) * 5)))}</div>
      <h1>玩完了！</h1>
      <p>今天認識了這些東西，點一下可以再聽一次</p>
      <div class="review">
        ${game.results.map(r => `<button class="review-item sticker ${r.ok ? '' : 'retry'}" data-id="${esc(r.w.id)}"><figure></figure><span>${esc(r.w.zh)}</span></button>`).join('')}
      </div>
      <div class="done-actions">
        <button class="primary" id="again">再玩一次</button>
        <button class="secondary" id="home">回首頁</button>
      </div>
    </section>`;
  const mode = game.mode;
  document.getElementById('again').onclick = () => startGame(mode);
  document.getElementById('home').onclick = renderHome;
  for (const el of app.querySelectorAll('.review-item')) {
    const w = state.byId.get(el.dataset.id);
    el.onclick = () => say(w, 'zh');
    renderImage(el.querySelector('figure'), await imageFor(w), w);
  }
}

// ---------- 啟動 ----------
async function boot() {
  try {
    await Promise.all([loadData(), loadGallery()]);
    renderHome();
  } catch (e) {
    app.innerHTML = `<section class="home"><p class="error">詞庫載入失敗：${esc(e.message)}。請確認網路後重新整理。</p></section>`;
  }
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
boot();
