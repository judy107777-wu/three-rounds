# 三遍練習

同一個主題連續講三遍，看自己每一遍留下什麼、丟掉什麼。

開工前請先讀 [CLAUDE.md](CLAUDE.md) 的「最高原則」。

## 怎麼跑起來

```bash
npm install
```

跑測試：

```bash
npm test
```

本機預覽（開在 http://localhost:4173）：

```bash
npm run serve
```

重新產生桌面圖示：

```bash
npm run icons
```

## 檔案在哪

| 路徑 | 是什麼 |
| --- | --- |
| `index.html` | 唯一的頁面，四個畫面都在裡面切換 |
| `src/styles.css` | 色票、字體、版面。改樣式只動這一個檔 |
| `src/metrics.js` | 字數、語速、贅詞數、贅詞密度 |
| `src/compare.js` | 兩遍之間的差距與方向 |
| `src/storage.js` | IndexedDB 讀寫、音檔 7 天清除、釘選、搜尋 |
| `src/recorder.js` | 錄音與正數計時 |
| `src/speech.js` | 即時語音轉文字、斷網標記 |
| `src/session.js` | 三遍流程、中斷續接、補標題存檔 |
| `src/ai-review.js` | 組提示詞、呼叫 Gemini、解析四項回傳 |
| `src/ui-*.js` | 各畫面。只畫畫面，不做運算與存取 |
| `src/app.js` | 把上面全部接起來 |
| `sw.js`、`manifest.webmanifest`、`icons/` | 加到主畫面與離線使用 |
| `tests/` | Vitest 測試。每個模組一個檔 |
| `docs/` | 需求與架構文件 |

## 要用 AI 分析的話

1. 到 [Google AI Studio](https://aistudio.google.com/apikey) 申請一把 Gemini API 金鑰
2. 打開 APP → 右上角「設定」→ 貼上金鑰 → 儲存

金鑰只存在這台裝置的瀏覽器裡，不會進原始碼、不會上傳。沒有金鑰也能正常練習，只是不能做 AI 分析。

## 資料存在哪

全部存在這台裝置的瀏覽器（IndexedDB），沒有帳號、沒有雲端。

- 逐字稿、數據、AI 分析：永久保留
- 音檔：7 天後自動清除，除非被釘選
- 清除瀏覽器資料會遺失全部紀錄。要留底就到設定頁按「匯出全部紀錄」

## 部署

見 [docs/部署.md](docs/部署.md)。
