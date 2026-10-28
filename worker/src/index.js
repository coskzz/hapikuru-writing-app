// ハピクル 英検準1級ライティング：AI添削の中継サーバー（Cloudflare Worker）
// - APIキーはここ（Workerの秘密の設定）にだけ置き、アプリ（GitHub Pages）には置かない
// - ハピクルのアプリでログインしている人だけが呼べる（Firebase IDトークンを検証）
// - 1人あたり・全体の1日の回数に上限をかける（KV）
import Anthropic from "@anthropic-ai/sdk";
import { verifyFirebaseIdToken } from "./auth.js";
import { callClaude } from "./claude.js";
import {
  buildJaReviewPrompt,
  buildEnReviewPrompt,
  buildJaReviewInput,
  buildEnReviewInput,
  JA_REVIEW_SCHEMA,
  EN_REVIEW_SCHEMA
} from "./prompts.js";

const ROUTES = {
  "/api/review-ja": { system: buildJaReviewPrompt, input: buildJaReviewInput, schema: JA_REVIEW_SCHEMA },
  "/api/review-en": { system: buildEnReviewPrompt, input: buildEnReviewInput, schema: EN_REVIEW_SCHEMA }
};

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, env);
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, model: env.MODEL, hasKey: Boolean(env.ANTHROPIC_API_KEY) }, 200, cors);
    }

    const route = ROUTES[url.pathname];
    if (!route || request.method !== "POST") return json({ error: "not_found" }, 404, cors);
    if (!cors["Access-Control-Allow-Origin"]) return json({ error: "origin_not_allowed" }, 403, cors);

    let user;
    try {
      const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      user = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID);
    } catch (error) {
      return json({ error: "unauthorized", message: "ログインし直してください。" }, 401, cors);
    }
    if (!env.ANTHROPIC_API_KEY) return json({ error: "ai_key_missing", message: "AI添削の準備中です（AIのキーがまだ設定されていません）。田中先生に知らせてください。" }, 503, cors);

    let body;
    try {
      body = await request.json();
      validateBody(body, url.pathname);
    } catch (error) {
      return json({ error: "bad_request", message: String(error.message || error) }, 400, cors);
    }

    const limited = await checkAndCountUsage(env, user.uid);
    if (limited) return json({ error: "rate_limited", message: limited }, 429, cors);

    try {
      const result = await callClaude(env, route, body);
      console.log(JSON.stringify({ route: url.pathname, uid: user.uid, usage: result.usage }));
      return json({ result: result.data }, 200, cors);
    } catch (error) {
      console.error(url.pathname, error?.status || "", error?.message || error);
      const status = error instanceof Anthropic.RateLimitError ? 429 : 502;
      return json({ error: "ai_failed", message: "AIの添削に失敗しました。少し待ってからもう一度押してください。" }, status, cors);
    }
  }
};

function validateBody(body, path) {
  if (!body || typeof body !== "object") throw new Error("body must be an object");
  const topic = body.topic || {};
  if (typeof topic.en !== "string" || !topic.en.trim()) throw new Error("topic.en is required");
  if (!Array.isArray(topic.points)) throw new Error("topic.points is required");
  if (!["agree", "disagree"].includes(body.stance)) throw new Error("stance must be agree or disagree");
  if (!Array.isArray(body.reasons) || body.reasons.length !== 2) throw new Error("reasons must have 2 items");
  for (const reason of body.reasons) {
    if (!Array.isArray(reason.ja) || reason.ja.length !== 3) throw new Error("each reason needs 3 Japanese sentences");
    if (path === "/api/review-en" && (!Array.isArray(reason.en) || reason.en.length !== 3)) {
      throw new Error("each reason needs 3 English sentences");
    }
  }
  const total = JSON.stringify(body).length;
  if (total > 12000) throw new Error("input too long");
}

async function checkAndCountUsage(env, uid) {
  if (!env.USAGE) return "";
  const day = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const userKey = `u:${uid}:${day}`;
  const totalKey = `t:${day}`;
  const [userCount, totalCount] = await Promise.all([env.USAGE.get(userKey), env.USAGE.get(totalKey)]);
  const perUser = Number(env.DAILY_LIMIT_PER_USER || 30);
  const perDay = Number(env.DAILY_LIMIT_TOTAL || 600);
  if (Number(userCount || 0) >= perUser) return `今日のAI添削の回数（${perUser}回）を使い切りました。明日また使えます。`;
  if (Number(totalCount || 0) >= perDay) return "今日のAI添削は混み合っています。明日また使ってください。";
  const ttl = { expirationTtl: 3 * 24 * 3600 };
  await Promise.all([
    env.USAGE.put(userKey, String(Number(userCount || 0) + 1), ttl),
    env.USAGE.put(totalKey, String(Number(totalCount || 0) + 1), ttl)
  ]);
  return "";
}

function corsHeaders(origin, env) {
  const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean);
  const headers = {
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
  if (allowed.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8" }
  });
}
