# ハピクル 準1級ライティング 開発メモ（AI引き継ぎ用）

## 目的

英検準1級の英作文を「型」で書けるようにする。田中先生（ハピクル英語塾）と林田さんのミーティングで決まった流れをそのまま実装している。正の資料＝Vault `20_projects/99_hapikuru_english/06_application/ライティングアプリ/` の議事録と `00_設計書兼引き継ぎ書.md`。

## 守ること

- 生徒が書くのは理由（2・3段落目）だけ。日本語6文→英語6文。1段落目と4段落目はAIが作る
- 日本語の添削は「中学3年間の文法で英語にできる日本語」に直し、意図をコメントで返す
- 1段落目：Nowadays, … has been a controversial issue … / Although some argue that …, / I strongly believe that … for the following two reasons. 2文目を3文目のただの否定にしない（文法の形を変える）
- 4段落目：田中先生の枠 `In conclusion for the above-mentioned two reasons, A, and B, there is no doubt that …` を句読点ごとそのまま使う。A・Bは理由を名詞・動名詞にまとめたもの（語形変化）。結論の文は1段落目の3文目と形を変える
- 指示文の本体は `worker/src/prompts.js`。変えるときは議事録の「決まったこと」と照らす
- ハピクル共通仕様 v1：バニラJS／Firebase共通プロジェクト／`idToEmail()` は単語アプリと1文字も変えない／学習データは `users/{uid}/modules/writing/...`
- APIキーはアプリに置かない。Workerの秘密の設定（`wrangler secret put ANTHROPIC_API_KEY`）だけ

## 主な関数（app.js）

- `submitJa` → `/api/review-ja` → `normalizeJaReview`
- `submitEn` → `/api/review-en` → `normalizeEnReview` → `buildEssay`（4段落を組み立て、`countWords` で語数）
- `renderResult`：全文・LINE用コピー・型のポイント・添削・4観点。書く画面／学習データのノート／管理画面で共通
- 学習データ・マイページ・管理画面は単語アプリ（`~/hapikuru-english-app`）の構造とクラス名を写している（`openStats`／`openMyPage`／`switchAdminTab`・`openUserDetail`）。単語アプリと共通の項目（名前・ID・パスワード・role・archived）は users/{uid} の書類にあり、ここで変えると単語アプリにも反映される
- 1日ごとの回数・履歴・ポイントはモジュールの書類（`users/{uid}/modules/writing` の `dailyLog`・`historyLog`・`points`）。`logActivity("ja"|"done")` で増える
- `persistRecord`：記録の保存と、モジュールの題数の更新
- デモモード（`localMode`）は `mockJaReview` / `mockEnReview` で仮の結果を返す

## チュートリアル動画

- `videos/tutorial_app.mp4`（使い方・58秒）＝使い方の画面（初回に自動で開く／「使い方」ボタン）。`videos/tutorial_example.mp4`（例題の解き方・90秒）＝例題の「▶ 解き方の動画」。登録は `data.js` の `WRITING_VIDEOS`
- 作り直しは `~/hapikuru-tutorial-video`（Remotion。手順は同フォルダの README）。アプリの画面を変えたら、動画も撮り直す
- 例題（`WRITING_EXAMPLE`）：デモのときだけ見本の添削結果を返す。動画2はこの見本で撮っている

## 確認

```bash
node --check app.js && node --check data.js
python3 -m http.server 8765 &
node tools/smoke-test.mjs http://127.0.0.1:8765/
```

## 公開

Vaultが正。`~/hapikuru-writing-app` が git の作業コピー（iCloud の下に .git や node_modules を置かない）。
`bash tools/publish.sh "変更の説明"` で Vault → 作業コピーに写して push（GitHub Pages）。Worker を変えたら `bash tools/publish.sh --worker "説明"`。
