// 動作確認：ヘッドレスChromeでデモモード（AIなし）を最初から最後まで通す。
// 使い方：アプリのフォルダで `python3 -m http.server 8765` を起動してから
//   node tools/smoke-test.mjs [アプリのURL] [スクショの保存先]
// 確かめること：ログイン画面→デモ→トピック→日本語6文→日本語の添削→英語6文→全文（回答例どおりなら160語。スペース区切り＝Wordと同じ数え方。回答例の表記は161語）→ノート→管理画面
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const appUrl = process.argv[2] || "http://127.0.0.1:8765/";
const shotDir = process.argv[3] || "/tmp/hapikuru-writing-shots";
const chromePath = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const port = 9300 + Math.floor(Math.random() * 500);
mkdirSync(shotDir, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const chrome = spawn(chromePath, [
  "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/hapikuru-writing-chrome-${port}`,
  "--window-size=430,932", "--no-first-run", "--no-default-browser-check", "about:blank"
], { stdio: "ignore" });

let ws;
try {
  let target;
  for (let i = 0; i < 50 && !target; i += 1) {
    await sleep(200);
    try {
      const tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      target = tabs.find((tab) => tab.type === "page");
    } catch (error) { /* 起動待ち */ }
  }
  if (!target) throw new Error("Chromeに接続できませんでした");

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  const consoleErrors = [];
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.exceptionThrown") consoleErrors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") consoleErrors.push(message.params.args.map((a) => a.value || a.description).join(" "));
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message));
    else entry.resolve(message.result);
  };
  const send = (method, params = {}) => {
    id += 1;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  };
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const shot = async (name) => {
    const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    writeFileSync(`${shotDir}/${name}.png`, Buffer.from(data, "base64"));
  };
  const waitFor = async (expression, label, timeout = 8000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (await evaluate(expression)) return;
      await sleep(150);
    }
    throw new Error(`待っても出てこない：${label}`);
  };
  const check = (ok, label) => {
    if (!ok) throw new Error(`NG：${label}`);
    console.log(`OK：${label}`);
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 430, height: 932, deviceScaleFactor: 2, mobile: true });
  await send("Page.navigate", { url: appUrl });
  await waitFor(`document.querySelector('#screen-welcome.active') !== null`, "ログイン画面", 15000);
  await evaluate(`localStorage.clear(); true`);
  await shot("01_login");
  check(true, "ログイン画面が出る");

  await evaluate(`document.querySelector('#btn-demo-login').click(); true`);
  await waitFor(`document.querySelector('#screen-home.active') && document.querySelectorAll('.topic-card').length > 0`, "トピック一覧");
  check(await evaluate(`!document.querySelector('#tutorial-modal').classList.contains('hidden')`), "初回は使い方が開く");
  await shot("02_tutorial");
  await evaluate(`document.querySelector('#btn-finish-tutorial').click(); true`);
  await shot("03_home");
  check(await evaluate(`!document.querySelector('#tab-admin').classList.contains('hidden')`), "講師（デモ）には管理タブが出る");

  check(await evaluate(`document.querySelectorAll('.topic-card').length === window.WRITING_TOPICS.length && window.WRITING_TOPICS.length >= 30`), "過去問トピックが全件並ぶ");
  await evaluate(`(() => { const box = document.querySelector('#topic-search'); box.value = 'vegetarian'; box.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  check(await evaluate(`document.querySelectorAll('.topic-card').length === 1`), "トピックを検索で絞れる");
  await evaluate(`(() => { const box = document.querySelector('#topic-search'); box.value = ''; box.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await evaluate(`document.querySelector('[data-mode=summary]').click(); true`);
  check(await evaluate(`!document.querySelector('#mode-summary').classList.contains('hidden')`), "要約タブに切り替わる（準備中）");
  await evaluate(`document.querySelector('[data-mode=essay]').click(); true`);

  await evaluate(`document.querySelector('[data-start="2019-2"]').click(); true`);
  await waitFor(`document.querySelector('#screen-write.active') && document.querySelector('#btn-review-ja')`, "日本語の入力画面");
  await evaluate(`document.querySelector('#btn-review-ja').click(); true`);
  check(await evaluate(`document.querySelector('#ja-error').textContent.includes('賛成か反対')`), "立場を選ばないと止まる");

  const ja = [
    ["日本の高校のカリキュラムは生徒の能力開発において効率性を欠いている。", "例えば北大のレポートによると、教師とのインタラクションこそがスキル向上の最適解らしい。", "なのに今の日本の教育は講義と暗記に偏重しすぎ。"],
    ["グローバル化が進む社会で英語を話せる力を伸ばすことが必要不可欠だ。", "私の経験上、ほとんどの生徒は授業で英文を読むだけでスピーキングの練習はしてない。", "このままだと、いつまでたっても英語がペラペラにならない。"]
  ];
  await evaluate(`(() => {
    const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));
    const agree = document.querySelector('input[name=stance][value=agree]'); agree.checked = true; fire(agree, 'change');
    const selects = document.querySelectorAll('[data-point]');
    selects[0].value = 'Curriculum'; fire(selects[0], 'change');
    selects[1].value = 'Globalization'; fire(selects[1], 'change');
    const ja = ${JSON.stringify(ja)};
    document.querySelectorAll('[data-ja]').forEach((area) => { const [r, i] = area.dataset.ja.split('-').map(Number); area.value = ja[r][i]; fire(area, 'input'); });
    return true;
  })()`);
  await shot("04_ja_input");
  await evaluate(`document.querySelector('#btn-review-ja').click(); true`);
  await waitFor(`document.querySelector('#btn-go-en')`, "日本語の添削結果");
  check(await evaluate(`document.querySelectorAll('.review-item').length === 6`), "日本語の添削が6文ぶん出る");
  await shot("05_ja_review");

  await evaluate(`document.querySelector('#btn-go-en').click(); true`);
  await waitFor(`document.querySelector('#btn-review-en')`, "英語の入力画面");
  check(await evaluate(`document.querySelectorAll('.ja-model').length === 6`), "英語にする画面に直した日本語が6文出る");
  const en = [
    ["Firstly, curriculum of high school education is not efficient to develop student ability.", "A report issued by Hokkaido University, for example, shows that interacting with teachers is the best way to hone student skills.", "However, today's Japanese education system is too lecture and rote memorization-oriented."],
    ["Additionally, we need to develop ability to speak English in this globalizing society.", "In my experience, for instance, most students just read English sentences but don't practice speaking English in their class.", "In this system, students will not come to speak English fluently forever."]
  ];
  await evaluate(`(() => {
    const en = ${JSON.stringify(en)};
    document.querySelectorAll('[data-en]').forEach((area) => { const [r, i] = area.dataset.en.split('-').map(Number); area.value = en[r][i]; area.dispatchEvent(new Event('input', { bubbles: true })); });
    return true;
  })()`);
  await shot("06_en_input");
  await evaluate(`document.querySelector('#btn-review-en').click(); true`);
  await waitFor(`document.querySelector('.essay-panel')`, "全文");
  const wordText = await evaluate(`document.querySelector('.word-count').textContent`);
  check(wordText.startsWith("160語"), `回答例と同じ全文の語数が160語になる（表示：${wordText}）`);
  check(await evaluate(`document.querySelectorAll('.essay-paragraph').length === 4`), "全文が4段落で出る");
  check(await evaluate(`document.querySelector('#copy-block').textContent.includes('■ 全文（160語）')`), "LINE用のコピー欄に全文が入る");
  check(await evaluate(`document.querySelector('[data-line-share]').href.startsWith('https://line.me/R/share?text=')`), "LINEで送るボタンのリンクができる");
  await shot("07_result");
  await evaluate(`document.querySelector('[data-toggle-memorize]').click(); true`);
  check(await evaluate(`document.body.classList.contains('memorize-mode')`), "1・4段落をかくせる");
  await shot("08_memorize");

  await evaluate(`document.querySelector('[data-go-notes]').click(); true`);
  await waitFor(`document.querySelector('#screen-notes.active') && document.querySelectorAll('#notes-list .record-row').length === 1`, "ノートに1件");
  check(true, "ノートに1件たまる");
  await shot("09_notes");
  await evaluate(`document.querySelector('#notes-list .record-row').click(); true`);
  await waitFor(`document.querySelector('#screen-record.active .essay-panel')`, "ノートから全文を開く");
  check(true, "ノートから全文を開ける");

  await evaluate(`document.querySelector('#tab-admin').click(); true`);
  await waitFor(`document.querySelectorAll('#admin-student-list [data-student]').length >= 1`, "管理画面の生徒一覧");
  check(await evaluate(`document.querySelector('#admin-student-list [data-student]').textContent.includes('1題')`), "管理画面で英作文の題数が見える");
  await shot("10_admin");

  const unit = await evaluate(`(() => { const t = window.__writingTest; return t.countWords("Don't stop — it's the above-mentioned plan."); })()`);
  check(unit === 6, `語数の数え方（ダッシュは数えず、don't・above-mentioned は1語）＝${unit}`);

  check(consoleErrors.length === 0, `コンソールのエラーなし${consoleErrors.length ? "：" + consoleErrors.join(" / ") : ""}`);
  console.log(`スクショ：${shotDir}`);
} catch (error) {
  console.error(error.message || error);
  process.exitCode = 1;
} finally {
  try { ws && ws.close(); } catch (error) { /* noop */ }
  chrome.kill();
}
