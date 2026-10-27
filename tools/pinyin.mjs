// 讀入 JSON 詞語陣列，輸出 {詞: [每個漢字的數字聲調拼音...]}，供 build_words.py 補單字注音
import { pinyin } from 'pinyin-pro';
let buf = '';
process.stdin.on('data', d => buf += d);
process.stdin.on('end', () => {
  const out = {};
  for (const w of JSON.parse(buf)) {
    out[w] = pinyin(w, { toneType: 'num', type: 'all', v: false })
      .filter(x => x.isZh)
      .map(x => x.pinyin.replace(/0$/, '5'));
  }
  process.stdout.write(JSON.stringify(out));
});
