# ハピクル 準1級ライティング

ハピクル英語塾の生徒が、英検準1級の英作文（大問5）を「型」で書けるようにする静的Webアプリ。

1. トピックを選び、賛成・反対と理由2つ（各3文）を日本語で書く
2. AIが「英語にしやすい日本語」（中学で習う文法で書ける日本語）に直し、意図をコメントで返す
3. 生徒が6文を英語にする
4. AIが英文を添削し、1段落目と4段落目を型どおりに作って全文（4段落）を出す。全文は学習データのノートにたまり、LINEで先生に質問できる形でコピーできる

書くタブのいちばん上の「フレーズを覚える！」で、おすすめフレーズ77を単語アプリと同じ4択テストとフラッシュカードで覚えられる。

要約（大問4）のタブは準備中。

## 構成

| ファイル | 中身 |
|---|---|
| `index.html` / `style.css` / `app.js` | 画面と動き（バニラJS、ビルドなし） |
| `data.js` | トピック（過去問）・おすすめフレーズ77・田中先生の回答例・英検の採点観点 |
| `firebase-config.js` | ハピクル共通のFirebaseプロジェクト（単語アプリと同じ） |
| `ai-config.js` | AI添削の中継サーバーのURL（APIキーは置かない） |
| `worker/` | AI添削の中継サーバー（Cloudflare Worker）。今は Cloudflare の無料のAI（Gemma 4）を呼ぶ。`wrangler.toml` の `PROVIDER` で Claude API に替えられる |
| `firestore.rules` | Firestoreのルール（学習データ `users/{uid}/...` の読み書き） |
| `tools/smoke-test.mjs` | ヘッドレスChromeでデモモードを通しで確かめる |
| `tools/try-prompts.mjs` | AIの指示文を手元で試す |

## 手元で動かす

```bash
python3 -m http.server 8765
# → http://127.0.0.1:8765 。「デモで確認（AIなし）」で全画面を確かめられる
node tools/smoke-test.mjs http://127.0.0.1:8765/
```

## データの置き場所（ハピクル共通仕様 v1）

- `users/{uid}/modules/writing`：題数・書きかけ数・最終日
- `users/{uid}/modules/writing/records/{id}`：1題分（日本語・日本語の添削・英文・英文の添削・全文）
- `users/{uid}/streaks/{日付}`・`users/{uid}/points/summary`：アプリ横断の記録
