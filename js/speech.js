// 發音：中文、英文用裝置內建語音；台語用家長錄音或教育部台語辭典錄音。
import { getBlob, getSettings } from './store.js';

const ZH_PREFER = [/國語.*臺灣|國語.*台灣|Taiwan/i, /HsiaoChen|Hsiao-?Yu|Yating|Zhiwei|HanHan/i, /Mei-?Jia|美佳/i];
const EN_PREFER = [/Google US English/i, /Aria|Jenny|Ava|Andrew|Emma/i, /Samantha|Alex/i];

let voices = [];
function loadVoices() { voices = window.speechSynthesis ? speechSynthesis.getVoices() : []; }
if (window.speechSynthesis) {
  loadVoices();
  speechSynthesis.addEventListener?.('voiceschanged', loadVoices);
}

export function listVoices(lang) {
  loadVoices();
  const re = lang === 'zh' ? /^zh[-_](TW|Hant)/i : /^en[-_]US/i;
  let list = voices.filter(v => re.test(v.lang));
  if (!list.length) list = voices.filter(v => v.lang.toLowerCase().startsWith(lang));
  return list;
}

function pickVoice(lang) {
  const s = getSettings();
  const wanted = lang === 'zh' ? s.zhVoice : s.enVoice;
  const list = listVoices(lang);
  if (wanted) { const v = list.find(v => v.name === wanted); if (v) return v; }
  for (const re of (lang === 'zh' ? ZH_PREFER : EN_PREFER)) {
    const v = list.find(v => re.test(v.name)); if (v) return v;
  }
  return list[0] || null;
}

let current = null;
export function stopAll() {
  try { window.speechSynthesis && speechSynthesis.cancel(); } catch {}
  if (current) { try { current.pause(); } catch {} current = null; }
}

export function tts(text, lang) {
  return new Promise(resolve => {
    if (!window.speechSynthesis) return resolve(false);
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice(lang);
    if (v) u.voice = v;
    u.lang = lang === 'zh' ? 'zh-TW' : 'en-US';
    u.rate = getSettings().rate || 0.85;
    u.pitch = 1.05;
    let done = false;
    const finish = ok => { if (!done) { done = true; resolve(ok); } };
    u.onend = () => finish(true);
    u.onerror = () => finish(false);
    // 有些瀏覽器不會觸發 onend，設個上限
    setTimeout(() => finish(true), 1500 + text.length * 450);
    speechSynthesis.speak(u);
  });
}

function playUrl(url) {
  return new Promise(resolve => {
    const a = new Audio(url);
    current = a;
    a.onended = () => resolve(true);
    a.onerror = () => resolve(false);
    a.play().catch(() => resolve(false));
  });
}

// 教育部台語辭典錄音（萌典使用的同一份音檔）
const TW_AUDIO_HOST = 'https://1763c5ee9859e0316ed6-db85b55a6a3fbe33f09b9245992383bd.ssl.cf1.rackcdn.com/';
export function taigiAudioUrls(id) {
  if (!id || (id > 20000 && id < 50000)) return [];
  const base = String(100000 + Number(id)).slice(1);
  return [TW_AUDIO_HOST + base + '.mp3', TW_AUDIO_HOST + base + '.ogg'];
}

// 能不能唸出某個詞的某種語言
export function canSay(word, lang, recKeys) {
  if (recKeys && recKeys.has(`${word.id}:rec:${lang}`)) return true;
  if (lang === 'zh') return !!word.zh;
  if (lang === 'en') return !!word.en;
  if (lang === 'tw') return !!(word.tw && taigiAudioUrls(word.tw.id).length);
  return false;
}

export async function say(word, lang) {
  stopAll();
  const rec = await getBlob(`${word.id}:rec:${lang}`);
  if (rec) {
    const url = URL.createObjectURL(rec);
    const ok = await playUrl(url);
    URL.revokeObjectURL(url);
    if (ok) return true;
  }
  if (lang === 'zh') return tts(word.zh, 'zh');
  if (lang === 'en') return tts(word.en, 'en');
  if (lang === 'tw' && word.tw) {
    for (const u of taigiAudioUrls(word.tw.id)) { if (await playUrl(u)) return true; }
  }
  return false;
}

// ---- 聽孩子有沒有出聲（不做語音辨識，只要有聲音就算）----
let micStream = null;
export async function listenForVoice({ timeoutMs = 5000, onLevel } = {}) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('no-mic');
  if (!micStream) micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const src = ctx.createMediaStreamSource(micStream);
  const an = ctx.createAnalyser();
  an.fftSize = 1024;
  src.connect(an);
  const buf = new Float32Array(an.fftSize);
  const start = performance.now();
  let loudFrames = 0, baseline = null;
  return new Promise(resolve => {
    const tick = () => {
      an.getFloatTimeDomainData(buf);
      let sum = 0; for (const x of buf) sum += x * x;
      const rms = Math.sqrt(sum / buf.length);
      if (baseline == null) baseline = rms;
      const threshold = Math.max(0.02, baseline * 3);
      // 環境噪音慢慢學，孩子的聲音不算進去
      if (rms < threshold) baseline = baseline * 0.95 + rms * 0.05;
      onLevel && onLevel(Math.min(1, rms * 12));
      if (rms > threshold) loudFrames++; else loudFrames = Math.max(0, loudFrames - 1);
      const elapsed = performance.now() - start;
      if (loudFrames > 6) { ctx.close(); return resolve(true); }
      if (elapsed > timeoutMs) { ctx.close(); return resolve(false); }
      requestAnimationFrame(tick);
    };
    tick();
  });
}
export function releaseMic() {
  if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
}

// ---- 家長錄音 ----
export async function recordClip(maxMs = 4000) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(t => window.MediaRecorder?.isTypeSupported?.(t)) || '';
  const mr = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  const chunks = [];
  mr.ondataavailable = e => e.data.size && chunks.push(e.data);
  const stopped = new Promise(r => { mr.onstop = r; });
  mr.start();
  const stop = () => { if (mr.state !== 'inactive') mr.stop(); };
  const timer = setTimeout(stop, maxMs);
  return {
    stop,
    done: stopped.then(() => {
      clearTimeout(timer);
      stream.getTracks().forEach(t => t.stop());
      return new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
    }),
  };
}
