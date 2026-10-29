// Cloudflare Workers AI（ハピクルのCloudflareアカウントの無料枠）の呼び出し。キーは要らない（wrangler.toml の [ai] でつなぐ）。
// 無料枠＝1日10,000ニューロン（日本時間の朝9時に戻る）。Gemma 4 は1題（2回）で約100〜150ニューロン。
// Worker 本体と、手元の試験（ローカルAIテスト/Cloudflare無料AIの試験）の両方から使う。
//
// 2026-10-29 の試験で決めたこと（結果＝ローカルAIテスト/AI比較_Codex_Cloudflare無料AI_2026-10-29.md）
// - 考える時間（thinking）は省く：とると2〜4分かかり、時間切れ（3046）も出た。省くと10〜45秒で、直し方の質は同じくらい
// - JSONの形を json_schema でしばらない：答案によっては毎回4分で時間切れになった。JSONであることだけをしばり（json_object）、
//   形は指示文に書いて、足りないキーはここで補う

export class FreeQuotaError extends Error {}

const TIMEOUT_MS = 100000;

export async function callWorkersAI(env, route, body, options = {}) {
  const first = await runOnce(env, route.system(), route.input(body), route.schema, options);
  if (!route.check || options.skipCheck) return first;
  // 日本語の添削は、生徒の文と見比べる見直しをもう1回かける。見直しが失敗したら1回目の結果を返す
  try {
    const checked = await runOnce(env, route.check.system(), route.check.input(body, first.data), route.check.schema, options);
    return { data: checked.data, usage: { first: first.usage, check: checked.usage }, first: first.data };
  } catch (error) {
    console.warn("ja check failed", String(error?.message || error));
    return first;
  }
}

async function runOnce(env, system, input, schema, options) {
  const model = env.WAI_MODEL || "@cf/google/gemma-4-26b-a4b-it";
  const params = {
    messages: [
      { role: "system", content: `${system}\n\n## JSONの形\n次のJSONスキーマのキーをすべて入れたJSONだけを出す。\n${JSON.stringify(schema)}` },
      { role: "user", content: input }
    ],
    response_format: { type: "json_object" },
    chat_template_kwargs: { enable_thinking: false },
    max_completion_tokens: 8000,
    ...options.extra
  };
  if (params.response_format === null) delete params.response_format;

  let lastError;
  // 時間切れ・JSONの崩れ・6文そろわないときは、もう1回だけ頼む
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response;
    try {
      response = await withTimeout(env.AI.run(model, params), TIMEOUT_MS);
    } catch (error) {
      const message = String(error?.message || error);
      if (/4006|daily free allocation/i.test(message)) throw new FreeQuotaError(message);
      lastError = error;
      continue;
    }
    const content = response?.choices?.[0]?.message?.content ?? response?.response;
    try {
      const data = typeof content === "string" ? JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, "")) : content;
      if (!data || typeof data !== "object") throw new Error("empty");
      fillDefaults(schema, data);
      const problem = coreProblem(data);
      if (problem) throw new Error(problem);
      return { data, usage: response.usage };
    } catch (error) {
      lastError = new Error(`bad_output: ${error.message}: ${String(content).slice(0, 200)}`);
    }
  }
  throw lastError;
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// スキーマの required にあるキーが抜けていたら、空の値で補う（文法の名前の欄などが抜けることがある）
function fillDefaults(schema, value) {
  if (!schema || !value || typeof value !== "object") return;
  if (schema.type === "array" && Array.isArray(value)) {
    value.forEach((item) => fillDefaults(schema.items, item));
    return;
  }
  if (schema.type !== "object") return;
  for (const key of schema.required || []) {
    const child = schema.properties[key];
    if (value[key] === undefined || value[key] === null) {
      value[key] = { array: [], string: "", boolean: false, integer: 0, object: {} }[child.type];
    }
    fillDefaults(child, value[key]);
  }
}

// 6文そろっていない・段落の本文がないときは、使えないのでやり直す
function coreProblem(data) {
  if ("sentences" in data) {
    if (!Array.isArray(data.sentences) || data.sentences.length !== 6) return "sentences_not_6";
    if (data.sentences.some((s) => !s.revised)) return "revised_empty";
  }
  if ("corrections" in data) {
    if (!Array.isArray(data.corrections) || data.corrections.length !== 6) return "corrections_not_6";
    if (!data.paragraph1?.text || !data.paragraph4?.text) return "paragraph_empty";
  }
  return "";
}
