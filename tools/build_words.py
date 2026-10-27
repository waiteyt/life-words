#!/usr/bin/env python3
"""把 data/src/*.txt 的詞條整理成 data/words.json。

需要兩份外部資料（不放進 repo，建置時下載）：
  - g0v/moedict-data 的 dict-revised.json（教育部重編國語辭典，取台灣標準注音）
  - ChhoeTaigi/ChhoeTaigiDatabase 的 ChhoeTaigi_KauiokpooTaigiSutian.csv（教育部台語辭典＋華語對照）

用法：
  python3 tools/build_words.py --moedict PATH/dict-revised.json \
      --taigi PATH/ChhoeTaigi_KauiokpooTaigiSutian.csv
"""
import argparse, csv, json, re, subprocess, sys, unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'data' / 'src'
OUT = ROOT / 'data' / 'words.json'
OVR = ROOT / 'data' / 'taigi-overrides.tsv'

def parse_sources():
    cats, words = [], []
    cat = None
    for f in sorted(SRC.glob('*.txt')):
        for line in f.read_text(encoding='utf-8').splitlines():
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            if line.startswith('@'):
                key, name, icon = line[1:].split(' ', 2)
                cat = {'id': key, 'name': name, 'icon': icon}
                cats.append(cat)
                continue
            zh, en, wiki, emoji, lv = [x.strip() for x in line.split('|')]
            if wiki == '':
                wiki = en[:1].upper() + en[1:]
            words.append({'zh': zh, 'en': en, 'wiki': None if wiki == '-' else wiki,
                          'emoji': emoji, 'level': int(lv), 'cat': cat['id']})
    return cats, words

# ---------- 注音 ----------
INITIALS = [('zh','ㄓ'),('ch','ㄔ'),('sh','ㄕ'),('b','ㄅ'),('p','ㄆ'),('m','ㄇ'),('f','ㄈ'),('d','ㄉ'),('t','ㄊ'),
            ('n','ㄋ'),('l','ㄌ'),('g','ㄍ'),('k','ㄎ'),('h','ㄏ'),('j','ㄐ'),('q','ㄑ'),('x','ㄒ'),('r','ㄖ'),
            ('z','ㄗ'),('c','ㄘ'),('s','ㄙ')]
FINALS = {'a':'ㄚ','o':'ㄛ','e':'ㄜ','ai':'ㄞ','ei':'ㄟ','ao':'ㄠ','ou':'ㄡ','an':'ㄢ','en':'ㄣ','ang':'ㄤ','eng':'ㄥ',
          'er':'ㄦ','i':'ㄧ','ia':'ㄧㄚ','ie':'ㄧㄝ','iao':'ㄧㄠ','iu':'ㄧㄡ','iou':'ㄧㄡ','ian':'ㄧㄢ','in':'ㄧㄣ',
          'iang':'ㄧㄤ','ing':'ㄧㄥ','iong':'ㄩㄥ','u':'ㄨ','ua':'ㄨㄚ','uo':'ㄨㄛ','uai':'ㄨㄞ','ui':'ㄨㄟ','uei':'ㄨㄟ',
          'uan':'ㄨㄢ','un':'ㄨㄣ','uen':'ㄨㄣ','uang':'ㄨㄤ','ong':'ㄨㄥ','ü':'ㄩ','üe':'ㄩㄝ','üan':'ㄩㄢ','ün':'ㄩㄣ',
          'v':'ㄩ','ve':'ㄩㄝ','van':'ㄩㄢ','vn':'ㄩㄣ','ue':'ㄩㄝ'}
TONES = {'1':'','2':'ˊ','3':'ˇ','4':'ˋ','5':'˙','0':'˙'}

def py2zy(syl):
    m = re.match(r'([a-zü]+)(\d)?$', syl)
    if not m:
        return syl
    s, tone = m.group(1), m.group(2) or '5'
    if s in ('zhi','chi','shi','ri','zi','ci','si'):
        base = dict(INITIALS)[s[:-1]]
    else:
        ini = ''
        for p, z in INITIALS:
            if s.startswith(p):
                ini, s = z, s[len(p):]
                break
        if ini in ('ㄐ','ㄑ','ㄒ') and s.startswith('u'):
            s = 'ü' + s[1:]
        if not ini and s.startswith('y'):
            s = {'yu':'ü','yue':'üe','yuan':'üan','yun':'ün','yong':'iong','yi':'i','yin':'in','ying':'ing'}.get(s, 'i' + s[1:] if not s.startswith('yi') else s[1:])
        if not ini and s.startswith('w'):
            s = {'wu':'u'}.get(s, 'u' + s[1:])
        base = ini + FINALS.get(s, '?' + s)
    t = TONES[tone]
    return ('˙' + base) if t == '˙' else base + t

def build_zhuyin(words, moedict_path):
    d = json.load(open(moedict_path, encoding='utf-8'))
    lex, chars = {}, {}
    def clean(b):
        return re.sub(r'（.*?）', '', b).strip()
    for e in d:
        hs = [h for h in (e.get('heteronyms') or []) if h.get('bopomofo')]
        if hs:
            lex[e['title']] = clean(hs[0]['bopomofo'])
            if len(e['title']) == 1:
                chars[e['title']] = [clean(h['bopomofo']) for h in hs]
    maxlen = 6
    # 單字用 pinyin-pro 依上下文判讀
    need = sorted({w['zh'] for w in words})
    node = subprocess.run(['node', str(ROOT / 'tools' / 'pinyin.mjs')], input=json.dumps(need),
                          capture_output=True, text=True, cwd=str(ROOT / 'tools'))
    pp = json.loads(node.stdout)
    for w in words:
        zh = w['zh']
        if len(zh) > 1 and zh in lex and len(lex[zh].split()) == len(zh):
            w['zhuyin'] = lex[zh]; continue
        out, i = [], 0
        sylls = pp.get(zh, [])
        while i < len(zh):
            ch = zh[i]
            if not ('一' <= ch <= '鿿'):
                j = i
                while j < len(zh) and not ('一' <= zh[j] <= '鿿'):
                    j += 1
                out.append(zh[i:j].strip()); i = j; continue
            for L in range(min(maxlen, len(zh) - i), 1, -1):
                seg = zh[i:i+L]
                if seg in lex and len(lex[seg].split()) == L:
                    out.extend(lex[seg].split()); i += L; break
            else:
                hi = sum(1 for c in zh[:i] if '一' <= c <= '鿿')
                guess = py2zy(sylls[hi]) if hi < len(sylls) else '?'
                opts = chars.get(ch, [])
                if len(opts) == 1:
                    guess = opts[0]
                elif opts and guess not in opts:
                    # 拼音庫是大陸讀音時，改用台灣字典的同音字（忽略聲調）或第一個讀音
                    same = [o for o in opts if o.strip('ˊˇˋ˙') == guess.strip('ˊˇˋ˙')]
                    guess = same[0] if same else opts[0]
                out.append(guess); i += 1
        w['zhuyin'] = ' '.join(x for x in out if x.strip())

# ---------- 台語 ----------
def clean_kip(s):
    s = re.sub(r'\((替|白|文|俗|又)\)', '', s)
    return s.split('/')[0].strip()

def build_taigi(words, taigi_path):
    rows = list(csv.DictReader(open(taigi_path, encoding='utf-8-sig')))
    by_hoabun, by_head = {}, {}
    for r in rows:
        ent = {'id': int(r['DictWordID']), 'han': r['HanLoTaibunKip'], 'lo': clean_kip(r['KipUnicode']),
               'hoabun': [x.strip() for x in r['HoaBun'].split('、') if x.strip()]}
        by_head.setdefault(ent['han'], []).append(ent)
        for h in ent['hoabun']:
            by_hoabun.setdefault(h, []).append(ent)
    overrides = {}
    if OVR.exists():
        for line in OVR.read_text(encoding='utf-8').splitlines():
            if line.strip() and not line.startswith('#'):
                parts = line.split('\t')
                overrides[parts[0]] = parts[1:]
    stats = {'override': 0, 'auto': 0, 'none': 0}
    for w in words:
        zh = w['zh']
        if zh in overrides:
            o = overrides[zh]
            if o[0] == '-':
                w['tw'] = None; stats['none'] += 1; continue
            han = o[0]
            lo = o[1] if len(o) > 1 and o[1] else None
            cand = by_head.get(han, [])
            norm = lambda x: re.sub(r'[\s\-]', '', unicodedata.normalize('NFC', x or '').lower())
            if lo:
                ent = next((c for c in cand if norm(c['lo']) == norm(lo)), None)
            else:
                ent = cand[0] if cand else None
            w['tw'] = {'han': han, 'lo': lo or (ent['lo'] if ent else ''), 'id': ent['id'] if ent else None, 'src': 'override'}
            stats['override'] += 1
            continue
        cands = by_hoabun.get(zh, [])
        if not cands and zh in by_head:
            cands = by_head[zh]
        if not cands:
            w['tw'] = None; stats['none'] += 1; continue
        def rank(e):
            return (e['han'] != zh, e['hoabun'][0] != zh if e['hoabun'] else True, len(e['han']), e['id'])
        cands = sorted(cands, key=rank)
        best = cands[0]
        w['tw'] = {'han': best['han'], 'lo': best['lo'], 'id': best['id'], 'src': 'auto'}
        if len(cands) > 1:
            w['tw']['alt'] = [{'han': c['han'], 'lo': c['lo'], 'id': c['id']} for c in cands[1:4]]
        stats['auto'] += 1
    return stats

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--moedict', required=True)
    ap.add_argument('--taigi', required=True)
    a = ap.parse_args()
    cats, words = parse_sources()
    seen = set()
    for i, w in enumerate(words):
        if w['zh'] in seen:
            sys.exit('重複詞條：' + w['zh'])
        seen.add(w['zh'])
        w['id'] = 'w%04d' % (i + 1)
    build_zhuyin(words, a.moedict)
    stats = build_taigi(words, a.taigi)
    for c in cats:
        c['count'] = sum(1 for w in words if w['cat'] == c['id'])
    keys = ['id','zh','zhuyin','en','tw','cat','level','emoji','wiki']
    out = {'version': 1, 'categories': cats, 'words': [{k: w[k] for k in keys if w.get(k) is not None} for w in words]}
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'{len(words)} 個詞條，{len(cats)} 個分類；台語：{stats}', file=sys.stderr)

if __name__ == '__main__':
    main()
