# 這是什麼？生活認知卡

給 3–6 歲孩子的生活認知遊戲。孩子跟大人生活在一起，對大人每天碰到的東西都有興趣，所以詞庫不限幼兒園教材：從香蕉、垃圾車，到軌跡球、簡報筆、行車紀錄器都有。

## 兩種玩法

每一題都有 2～4 張圖卡：真實照片（維基百科、維基共享資源）、卡通圖（emoji）、程式畫的圖（顏色、形狀）。看圖說時可以點小圖切換成大圖；聽聽看時，每個選項的主圖下面還有兩張小圖提示。

- **看圖說說看**：出現一張照片，孩子說出名字。只要有出聲就算參與（不做語音辨識，避免挫折），接著播出正確唸法，由家長按「說出來了」或「還要練習」。
- **聽聽看，點點看**：播出中文、台語或英文名稱，孩子點正確的圖。點錯時會說出她點到的是什麼，再重聽一次題目。選項會隨答對的次數從 2 張增加到 4 張。

兩種玩法都用間隔重複安排題目：答對的詞過幾天再出，答錯的近期再出。

## 詞庫

- 第一、二期共 1,431 個詞，42 個分類（家人、身體、情緒、食物、台灣小吃、廚房、3C、工具、交通、地方、動物、植物、天氣、醫院……）。
- 每個詞有中文、注音、英文、emoji，867 個詞有台語漢字與台羅，其中 820 個可以播放教育部台語辭典的真人錄音。
- 首頁可以選「常見的」（第一期）或「全部」。

### 我們家的東西

家長區可以拍照新增家裡的東西，並錄下家人的中文、台語發音。**照片、錄音、進度都只存在這台裝置**，不會上傳到 GitHub 或任何伺服器。換裝置前請用「進度與備份」下載備份。

## 家長區

首頁右上角的齒輪要**按住 1.5 秒**才會打開，避免孩子誤觸。可以：

- 選擇出題語言、答案要顯示注音 / 台羅 / 英文、每題幾張圖、每次幾題、說話速度、中文和英文的語音
- 在詞庫中換圖（拍照或從維基共享資源挑）、隱藏詞、修正台語、錄音
- 查看「會說」與「聽得懂」的詞數

## 資料來源與授權

| 內容 | 來源 | 授權 |
|---|---|---|
| 注音 | 教育部《重編國語辭典修訂本》，經 [g0v/moedict-data](https://github.com/g0v/moedict-data) 整理 | 教育部 CC BY-ND 3.0 TW |
| 台語漢字、台羅、華語對照 | 教育部《臺灣台語常用詞辭典》，經 [ChhoeTaigi](https://github.com/ChhoeTaigi/ChhoeTaigiDatabase) 整理 | 教育部 CC BY-ND 3.0 TW |
| 台語錄音 | 教育部《臺灣台語常用詞辭典》網站的詞目錄音，使用時才載入 | 教育部 CC BY-ND 3.0 TW |
| 照片 | 英文、中文維基百科條目的代表圖，Wikidata 圖片，以及維基共享資源分類中的照片（清單在 `data/images.json`），使用時才載入 | 各圖授權見圖片來源頁 |
| 中文、英文發音 | 裝置內建語音（Web Speech API） | — |
| 程式碼、詞表 | 本專案 | MIT |

台語對照有兩種：家長常用說法經人工校正（`data/taigi-overrides.tsv`），其餘由辭典的華語對照自動比對，在家長區會標示「辭典對照」。發現不自然的說法，可以在家長區直接修改。

## 架構

純靜態網站，不需要建置，可以直接放在 GitHub Pages。

```
index.html            入口
css/app.css           樣式
js/app.js             首頁與兩種玩法
js/parent.js          家長區
js/speech.js          發音、聽聲音、錄音
js/images.js          圖片載入（維基百科 / 共享資源 / 自己拍的）
js/store.js           本機儲存（localStorage + IndexedDB）
sw.js                 離線快取
data/src/*.txt        詞表原稿（中文|英文|維基條目|emoji|級別）
data/words.json       建置後的詞庫
tools/build_words.py  由詞表產生 words.json（補注音、比對台語）
tools/fetch_sutian_ids.js  在台語辭典網站查詞目編號（產生 data/sutian-ids.json）
```

### 新增或修改詞條

1. 編輯 `data/src/` 裡的文字檔，一行一個詞：`中文|English|維基條目(空白=同英文，-=不用網路圖)|emoji|級別`
2. 下載資料並重新建置：

```bash
git clone --depth 1 https://github.com/g0v/moedict-data.git /tmp/moedict-data
xz -dk /tmp/moedict-data/dict-revised.json.xz
git clone --depth 1 https://github.com/ChhoeTaigi/ChhoeTaigiDatabase.git /tmp/chhoetaigi
cd tools && npm install && cd ..
python3 tools/build_words.py \
  --moedict /tmp/moedict-data/dict-revised.json \
  --taigi /tmp/chhoetaigi/ChhoeTaigiDatabase/ChhoeTaigi_KauiokpooTaigiSutian.csv
```

3. 新增了台語詞，想要有教育部錄音：先發布一次，到 https://sutian.moe.edu.tw/ 開發者主控台執行 `tools/fetch_sutian_ids.js`，把下載的 `sutian-ids.json` 放進 `data/`，再執行一次步驟 2。

## 下一步：第三期

第三期目標是擴充到上萬個詞：從詞頻表批次產生詞條、自動抓候選照片，再由家長在家長區審核。
