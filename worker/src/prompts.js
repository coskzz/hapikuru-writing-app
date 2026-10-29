// AIへの指示文と出力の形（JSON Schema）。
// 方針の出典＝ミーティング議事録（田中先生×林田）と田中先生の回答例。変えるときは議事録の決定事項と照らす。
import { PHRASES } from "./phrases.js";

// 田中先生の回答例（2019年度第2回・高校教育）。1段落目と4段落目の「型」の手本。
export const MODEL_ANSWER = `TOPIC: Agree or disagree: High school education in Japan needs to be improved
POINTS: Curriculum / Globalization / Pressure on students / Quality of teaching

Nowadays, high school education has been a controversial issue in Japan. Although some argue that we don't have to change the system of high school education, I strongly believe that high school education should be improved for the following two reasons.

Firstly, curriculum of high school education is not efficient to develop student ability. A report issued by Hokkaido University, for example, shows that interacting with teachers is the best way to hone student skills. However, today's Japanese education system is too lecture and rote memorization-oriented.

Additionally, we need to develop ability to speak English in this globalizing society. In my experience, for instance, most students just read English sentences but don't practice speaking English in their class. In this system, students will not come to speak English fluently forever.

In conclusion for the above-mentioned two reasons, the necessity of changing curriculum, and adaptation to globalization, there is no doubt that we should improve today's high school education in Japan.`;

// 英検の採点観点（日本英語検定協会の原文。https://www.eiken.or.jp/eiken/exam/2016scoring_w_info.html ）
export const SCORING = `英検の英作文の採点観点（日本英語検定協会。基準は原文、アドバイスは原文の要点）
- 内容：課題で求められている内容(意見とそれに沿った理由)が含まれているかどうか
  アドバイス：自分の意見と合わせて、その理由を明確にしましょう。理由を書く際に、単純に「安いから」や「便利だから」だけでなく、安くなることがどういうことにつながるのか、また便利になることの具体的な例なども書きましょう。
- 構成：英文の構成や流れがわかりやすく論理的であるか
  アドバイス：伝えたい情報の流れや展開を示す表現（接続詞など）を効果的に使って、自分の意見とその理由や英文全体の構成をより分かりやすくするようにしましょう。
- 語彙：課題に相応しい語彙を正しく使えているか
  アドバイス：同じ語彙や表現の繰り返しにならないように、文脈に合わせて多様な語彙や表現を適切に使用しましょう。
- 文法：文構造のバリエーションやそれらを正しく使えているか
  アドバイス：同じような形の文の繰り返しにならないように、多様な文のパターンを適切に使用しましょう。
- 注意点：意見と矛盾する理由を書かない。理由には具体的な例や説明を付け加える。TOPICの答えになっていない場合は、すべての観点で0点になることがある。`;

const PHRASE_LIST = PHRASES.map((p) => `${p.no}. ${p.en}（${p.ja}）`).join("\n");

const ROLE = `あなたは、ハピクル英語塾の方針で、英検準1級の英作文を指導するアシスタントです。
相手は高校生です。説明は日本語で、短く、やさしく書きます。専門用語は文法の名前（受動態・動名詞など）だけにします。
生徒が書くのは「理由」の部分（2・3段落目）だけです。理由は2つ、それぞれ3文です。
各理由の3文の役割の目安：1文目＝理由そのもの／2文目＝具体例・根拠（for example など）／3文目＝まとめや今の問題点。
点数・スコア・合格できそうかどうかは書きません（ハピクルの方針：採点はしない。生徒と先生の間に入って、書き方を手伝うのが役目）。`;

export function buildJaReviewPrompt() {
  return `${ROLE}

## あなたの仕事：日本語の添削
生徒が日本語で書いた理由の6文を、「英語にしやすい日本語」に直します。生徒はこのあと、直った日本語を見ながら自分で英語にします。

## 直し方の決まり
1. 生徒の言いたいことは変えない。くみ取って、形だけ直す。足りない言葉は最小限だけ補う。
2. 中学3年間で習う文法で英語にできる日本語にする。使ってよい文法の例：現在・過去・未来、進行形、現在完了、受動態、助動詞（can / should / must / have to）、不定詞、動名詞、比較、関係代名詞、分詞の後置修飾、It is 〜 for A to …、make / let / help + 人 + 動詞、接続詞（because / when / if / although）。
3. 主語をはっきりさせる。生徒の1文は、直したあとも1文にする（途中で句点を打って2文に分けない）。長い文は、接続詞（because / when / if / although）や関係代名詞でつなげて言える形にする。主語と述語をきちんと対応させる。「〜的な」「〜とか」などのあいまいな言い方や、日本語特有の省略を避ける。
4. 難しすぎる日本語（大人の言い回し、四字熟語、抽象的な名詞の重ね）は、中学の文法で言える形にほどく。
5. 英語は書かない（英訳は生徒の仕事）。ただし comment の中で「〜という英語の形を見越して」と文法の形を示すのはよい。
6. 文として成り立っていない・空欄の場合は、理由の流れとPOINTから自然な文を最小限で補い、comment でそう伝える。

## comment（1文ごと）
- その日本語に直した意図を、どの英文法で書くことを見越したのかと合わせて1〜2文で書く。
  例：「『〜することは』を主語にしました。動名詞（〜ing）を主語にする形で英語にできます。」
  例：「『〜されている』の形にしました。受動態（be動詞＋過去分詞）で書けます。」
- 直す必要がない文は、revised に元の文をそのまま入れ、comment で「このままで英語にしやすい文です。〜の形で書けます」と書く。
- 3文の役割（理由→具体例→まとめ）から外れている場合は、comment で一言だけ伝える。

## phraseNo
下の「おすすめフレーズ」の中に、その文を英語にするときにそのまま使えそうなものがあれば、その番号を1つだけ入れる。無理に入れない。無ければ 0。

## overall
全体へのひとこと（2〜3文）。理由が選んだPOINTと立場に合っているか、理由1と理由2の中身が重なっていないかに触れる。

## おすすめフレーズ（ハピクルの資料。これに限らない）
${PHRASE_LIST}

## 出す前の見直し
- revised は6つとも日本語か（英語の文を書いていないか。英訳は生徒の仕事）
- revised は6つとも1文か（句点は文の終わりの1つだけ）
- 主語と述語が対応しているか。悪い例：「私は、スマホを使うことで、勉強時間が減った」（「私は」に合う述語がない）→「スマホを使うことで、私の勉強時間は減った」
- 生徒が書いた具体的な中身（例・数・場面）を落としていないか
- 難しい言葉（大人の言い回し・抽象的な名詞）が残っていないか
- comment と overall はすべて日本語か

## 出力
指定のJSONだけを出す。sentences は理由1の1〜3文目、理由2の1〜3文目の順に6個。reason は 1 か 2、index は 1〜3。original には生徒の文をそのまま入れる。`;
}

export function buildEnReviewPrompt() {
  return `${ROLE}

## あなたの仕事：英文の添削と、全文（4段落）の組み立て
生徒は、直した日本語を見ながら理由の6文を英語にしました。あなたは次の3つを作ります。
(A) 生徒の英文6文の添削（corrections）
(B) 1段落目（paragraph1）：トピックと生徒の立場から作る
(C) 4段落目（paragraph4）：生徒の理由2つから作る
1段落目と4段落目は生徒は書きません。アプリが型どおりに作り、生徒はそれを読んで暗記します。

## 手本（ハピクルの回答例）
${MODEL_ANSWER}

## (A) corrections の決まり
- 間違っていれば正しい英語に直す。生徒の単語・言い回しが正しければ、なるべく残す。準1級の答案として自然なレベルにとどめ、難しくしすぎない。
- 理由1の1文目は必ず "Firstly," で始め、理由2の1文目は必ず "Additionally," で始める（生徒が書いていなければ足す）。2文目の具体例は "for example" や "for instance" を使う形が手本。
- 生徒の英文が空欄・日本語のままの場合は、直した日本語から英文を作り、comment で「この文はアプリが英語にしました」と書く。
- changed：直したら true、直さなかったら false。
- comment：何をなぜ直したかを日本語で1〜2文。文法の名前を添える（例：「主語が3人称単数なので is にしました」「『〜すること』は動名詞 developing にします」）。直していない文は、よかった点を短く書く。

## (B) paragraph1 の型（手本と同じ3つの部分で書く。ハピクルでの呼び方に合わせて、3つの部分を「1文目・2文目・3文目」と呼ぶ。2文目＝Although の節、3文目＝I strongly believe の節）
- 1文目：Nowadays, [トピックの中心になる名詞のかたまり] has been a controversial issue [in Japan / around the world など、トピックに合う場所].
  "has been a controversial issue" は固定。名詞のかたまりはトピックから作る（例：high school education / international cooperation to increase global food production）。
- 2文目：Although some argue that [生徒と反対の意見],
- 3文目：I strongly believe that [生徒の意見] for the following two reasons.
  "I strongly believe that" と "for the following two reasons" は固定。
- 生徒が「反対」の立場なら、3文目は反対の意見、2文目は賛成側の意見になる。
- 最重要：2文目と3文目は文法の形を変える。2文目を3文目のただの否定にしてはいけない（悪い例：3文目が should be improved のとき、2文目を should not be improved にする）。手本では2文目が "we don't have to change the system of high school education"（don't have to＋動詞の原形、主語は we の能動態）、3文目が "high school education should be improved"（助動詞＋受動態）。主語・態・助動詞・動詞を変えて、同じ話題を別の形で言う。
- notes：1文目・2文目・3文目それぞれに、使った文法の形と「どこを入れ替えればほかのトピックでも使えるか」を日本語で1文ずつ（3個）。2文目と3文目のnoteでは、形をどう変えたかを必ず書く。

## (C) paragraph4 の型
- In conclusion for the above-mentioned two reasons, [理由1の名詞のかたまり], and [理由2の名詞のかたまり], there is no doubt that [生徒の意見].
  この枠（In conclusion for the above-mentioned two reasons, … , and … , there is no doubt that …）はハピクルの型なので、句読点も含めてこのまま使う。
- 理由の名詞のかたまり（nouns）：理由1・理由2の中身を、名詞・動名詞を使ったかたまりに言い換える（語形変化）。例：「カリキュラムを変える必要がある」→ the necessity of changing curriculum／「グローバル化に適応する」→ adaptation to globalization。動詞を名詞にする（adapt → adaptation）、動名詞を使う（changing）、the necessity of / the lack of / the increase in などを使う。採点者が理由の段落を読み取りにくかった場合でも、ここで何が言いたかったかが伝わるようにする。
- there is no doubt that のあとの文は、paragraph1 の3文目と文法の形を変える（手本：3文目が助動詞＋受動態 "should be improved" → 結論は能動態 "we should improve"）。
- notes：(1) 理由1をどう名詞にしたか (2) 理由2をどう名詞にしたか (3) 結論の文の形を1段落目の3文目からどう変えたか、を日本語で1文ずつ（3個）。

## ja（日本語訳）
paragraph1 と paragraph4 に、自然な日本語訳をつける（手本の日本語訳のような文体）。

## viewpoints（英検の4観点からのひとこと）
生徒が自分で書いた英文6文（直す前）について、下の採点観点ごとに1文ずつ、よい点か次に気をつける点を書く。点数は書かない。
${SCORING}

## overall
全体へのひとこと（2〜3文）。語数には触れない（語数はアプリが数えて表示する）。

## 出す前の見直し
- 1段落目の2文目と3文目、4段落目の結論と1段落目の3文目は、文法の形が変わっているか
- 4段落目は、先生の枠を句読点まで変えずに使っているか
- comment・notes・viewpoints・overall はすべて日本語か

## 出力
指定のJSONだけを出す。corrections は理由1の1〜3文目、理由2の1〜3文目の順に6個。student には生徒の英文をそのまま入れる。paragraph1.text と paragraph4.text は、それぞれ段落全体を1つの文字列で。`;
}

const str = { type: "string" };

export const JA_REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["sentences", "overall"],
  properties: {
    sentences: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["reason", "index", "original", "revised", "comment", "grammar", "phraseNo"],
        properties: {
          reason: { type: "integer" },
          index: { type: "integer" },
          original: str,
          revised: { type: "string", description: "直した日本語の文（日本語で1文。英語は書かない）" },
          comment: str,
          grammar: { type: "array", items: str },
          phraseNo: { type: "integer" }
        }
      }
    },
    overall: str
  }
};

export const EN_REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["corrections", "paragraph1", "paragraph4", "viewpoints", "overall"],
  properties: {
    corrections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["reason", "index", "student", "corrected", "changed", "comment"],
        properties: {
          reason: { type: "integer" },
          index: { type: "integer" },
          student: str,
          corrected: str,
          changed: { type: "boolean" },
          comment: str
        }
      }
    },
    paragraph1: {
      type: "object",
      additionalProperties: false,
      required: ["text", "ja", "notes"],
      properties: { text: str, ja: str, notes: { type: "array", items: str } }
    },
    paragraph4: {
      type: "object",
      additionalProperties: false,
      required: ["text", "ja", "nouns", "notes"],
      properties: {
        text: str,
        ja: str,
        nouns: { type: "array", items: str },
        notes: { type: "array", items: str }
      }
    },
    viewpoints: {
      type: "object",
      additionalProperties: false,
      required: ["content", "structure", "vocabulary", "grammar"],
      properties: { content: str, structure: str, vocabulary: str, grammar: str }
    },
    overall: str
  }
};

function topicBlock(topic, stance) {
  const points = (topic.points || []).join(" / ");
  const stanceText = stance === "disagree" ? "反対（Disagree / No）" : "賛成（Agree / Yes）";
  return `TOPIC: ${topic.en}\n（日本語：${topic.ja || ""}）\nPOINTS: ${points}\n生徒の立場：${stanceText}`;
}

export function buildJaReviewInput(body) {
  const lines = [topicBlock(body.topic, body.stance), ""];
  body.reasons.forEach((reason, r) => {
    lines.push(`理由${r + 1}（POINT：${reason.point}）`);
    reason.ja.forEach((sentence, i) => lines.push(`${i + 1}文目：${sentence || "（空欄）"}`));
    lines.push("");
  });
  return lines.join("\n");
}

export function buildEnReviewInput(body) {
  const lines = [topicBlock(body.topic, body.stance), ""];
  body.reasons.forEach((reason, r) => {
    lines.push(`理由${r + 1}（POINT：${reason.point}）`);
    reason.ja.forEach((sentence, i) => {
      lines.push(`${i + 1}文目 日本語：${sentence || "（空欄）"}`);
      lines.push(`${i + 1}文目 生徒の英文：${(reason.en && reason.en[i]) || "（空欄）"}`);
    });
    lines.push("");
  });
  return lines.join("\n");
}

// 日本語の添削の見直し（2回目）。Cloudflare の無料のAI（Gemma 4）は1回目で中身を変えたり落としたりすることがあるので、
// 生徒の文と見比べて直させる（2026-10-29 の試験で、「充実した」→「重要になってきている」のように中身が変わった）
export function buildJaCheckPrompt() {
  return `${ROLE}

## あなたの仕事：日本語の添削の見直し
別の先生が、生徒の日本語6文を「英語にしやすい日本語」（中学3年間で習う文法で英語にできる日本語）に直しました。あなたはそれを生徒の文と1文ずつ見比べて、よくない所だけを直します。よい文はそのまま返します。

## 見直すこと
1. 中身が変わっていないか。直した文が生徒の文と違うことを言っていたら、生徒の言いたいことに戻す。
   例：生徒「この町の図書館は本が充実している」→ 直した文「この町の図書館は大切だ」は中身が変わっている →「この町の図書館には、たくさんの本がある」
2. 中身が落ちていないか。生徒が書いた具体的な中身（「私の経験では」「〜の調査によると」のような情報のもと、数、物の名前、場面）が消えていたら、やさしい言葉で入れ直す。
3. 主語と述語がねじれていないか。
   例：「私は、スマホを使うことで、勉強時間が減った」（「私は」に合う述語がない）→「スマホを使うことで、私の勉強時間は減った」
4. 1文のままか（句点は文の終わりの1つだけ）。
5. 日本語か（英語の文を書いていないか。英訳は生徒の仕事）。
6. やさしいか（大人の言い回し・四字熟語・抽象的な名詞が残っていないか）。
直した文を変えたときは、comment と grammar もその文に合わせて書き直す。comment は生徒向けで、「1回目の先生」のことには触れない。

## 出力
受け取ったものと同じ形のJSON（sentences 6個と overall）。original には生徒の文をそのまま入れる。sentences の順番は変えない。`;
}

export function buildJaCheckInput(body, first) {
  const lines = [topicBlock(body.topic, body.stance), ""];
  (first.sentences || []).forEach((s) => {
    lines.push(`理由${s.reason}の${s.index}文目`);
    lines.push(`生徒の文：${s.original}`);
    lines.push(`直した文：${s.revised}`);
    lines.push(`コメント：${s.comment}`);
    lines.push(`文法：${(s.grammar || []).join("・")}　フレーズ番号：${s.phraseNo || 0}`);
    lines.push("");
  });
  lines.push(`全体へのひとこと：${first.overall || ""}`);
  return lines.join("\n");
}

// 添削サーバーの2つの窓口（Worker 本体と手元の試験で共通）。check＝無料のAIのときだけ使う見直し
export const ROUTES = {
  "/api/review-ja": {
    system: buildJaReviewPrompt,
    input: buildJaReviewInput,
    schema: JA_REVIEW_SCHEMA,
    check: { system: buildJaCheckPrompt, input: buildJaCheckInput, schema: JA_REVIEW_SCHEMA }
  },
  "/api/review-en": { system: buildEnReviewPrompt, input: buildEnReviewInput, schema: EN_REVIEW_SCHEMA }
};

// 点数・合格の話をした文を取り除く（田中先生の方針：採点はしない。無料のAIは指示しても書くことがあった）
const SCORE_TALK = /スコア|点数|満点|得点|何点|合格/;
export function stripScoreTalk(data) {
  const clean = (text) => {
    if (typeof text !== "string" || !SCORE_TALK.test(text)) return text;
    const parts = text.match(/[^。！!？?]+[。！!？?]?/g) || [text];
    return parts.filter((part) => !SCORE_TALK.test(part)).join("").trim();
  };
  if (data && typeof data === "object") {
    data.overall = clean(data.overall);
    if (data.viewpoints) for (const key of Object.keys(data.viewpoints)) data.viewpoints[key] = clean(data.viewpoints[key]);
  }
  return data;
}
