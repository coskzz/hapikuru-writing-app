// AIの指示文を手元で試す（Workerを通さず、同じ処理を直接呼ぶ）。
// 使い方（作業コピーで）：cd ~/hapikuru-writing-app/worker && ANTHROPIC_API_KEY=... node ../tools/try-prompts.mjs [A|B] [出力先ディレクトリ]
// 日本語添削 → その結果の日本語＋サンプル英文で英文添削、の順に2回呼ぶ。
import { writeFileSync, mkdirSync } from "node:fs";
import { callClaude } from "../worker/src/claude.js";
import {
  buildJaReviewPrompt,
  buildEnReviewPrompt,
  buildJaReviewInput,
  buildEnReviewInput,
  JA_REVIEW_SCHEMA,
  EN_REVIEW_SCHEMA
} from "../worker/src/prompts.js";

const SAMPLES = {
  A: {
    topic: {
      en: "Agree or disagree: High school education in Japan needs to be improved",
      ja: "日本の高校教育は改善されるべきか",
      points: ["Curriculum", "Globalization", "Pressure on students", "Quality of teaching"]
    },
    stance: "agree",
    reasons: [
      {
        point: "Curriculum",
        ja: [
          "日本の高校のカリキュラムは生徒の能力開発において効率性を欠いている。",
          "例えば北大のレポートによると、教師とのインタラクションこそがスキル向上の最適解らしい。",
          "なのに今の日本の教育は講義と暗記に偏重しすぎ。"
        ],
        en: [
          "Firstly, curriculum of high school is not efficient for develop students ability.",
          "For example, report by Hokkaido University show that interact with teachers is best way to hone skills.",
          "But now Japanese education is too lecture and memorize."
        ]
      },
      {
        point: "Globalization",
        ja: [
          "グローバル化が進む社会で英語を話せる力を伸ばすことが必要不可欠だ。",
          "私の経験上、ほとんどの生徒は授業で英文を読むだけでスピーキングの練習はしてない。",
          "このままだと、いつまでたっても英語がペラペラにならない。"
        ],
        en: [
          "we need develop ability of speaking English in globalizing society.",
          "In my experience, most student only read English sentence and they don't practice speak English in class.",
          "In this system, student can not speak English fluently forever."
        ]
      }
    ]
  },
  B: {
    topic: {
      en: "Should governments work together to increase global food production?",
      ja: "各国の政府は世界の食料生産を増やすために協力すべきか",
      points: ["Land space", "Pollution", "Population", "Technology"]
    },
    stance: "disagree",
    reasons: [
      {
        point: "Land space",
        ja: [
          "食料をもっと作るためには新しい農地が必要だが、もう土地があまり残っていない。",
          "たとえば、森林を切りひらいて畑にすると、動物の住む場所がなくなってしまう。",
          "だから、世界で協力して生産を増やすのは現実的ではない。"
        ],
        en: [
          "Firstly, we need new farmland to make more food, but there are not much land left.",
          "For example, if we cut forests for fields, animals lose the place to live.",
          "So it is not realistic that countries work together for increasing production."
        ]
      },
      {
        point: "Pollution",
        ja: [
          "食料生産を増やすと環境汚染がひどくなる。",
          "例えば化学肥料をたくさん使うと川や海が汚れる。",
          "その結果、かえって将来の食料が減ってしまうかもしれない。"
        ],
        en: [
          "Additionally, increasing food production makes pollution worse.",
          "For instance, using a lot of chemical fertilizer pollute rivers and seas.",
          "As a result, food in future may decrease."
        ]
      }
    ]
  }
};

const which = process.argv[2] || "A";
const outDir = process.argv[3] || "/tmp/hapikuru-writing-try";
mkdirSync(outDir, { recursive: true });
const sample = SAMPLES[which];
const env = {
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  MODEL: process.env.MODEL || "claude-opus-5-5",
  EFFORT: process.env.EFFORT || "medium"
};

const jaRoute = { system: buildJaReviewPrompt, input: buildJaReviewInput, schema: JA_REVIEW_SCHEMA };
const enRoute = { system: buildEnReviewPrompt, input: buildEnReviewInput, schema: EN_REVIEW_SCHEMA };

let started = Date.now();
const ja = await callClaude(env, jaRoute, sample);
console.log(`[${which}] 日本語添削 ${((Date.now() - started) / 1000).toFixed(1)}秒`, JSON.stringify(ja.usage));
writeFileSync(`${outDir}/${which}_ja.json`, JSON.stringify(ja.data, null, 2));

const revised = [0, 1].map((r) => ja.data.sentences.filter((s) => s.reason === r + 1).sort((a, b) => a.index - b.index).map((s) => s.revised));
const enBody = {
  ...sample,
  reasons: sample.reasons.map((reason, r) => ({ point: reason.point, ja: revised[r], en: reason.en }))
};
started = Date.now();
const en = await callClaude(env, enRoute, enBody);
console.log(`[${which}] 英文添削 ${((Date.now() - started) / 1000).toFixed(1)}秒`, JSON.stringify(en.usage));
writeFileSync(`${outDir}/${which}_en.json`, JSON.stringify(en.data, null, 2));
console.log(`保存先: ${outDir}`);
