// AI添削の仮の窓口（林田さんのPCで動かす）。Codex CLI（Sign in with ChatGPT／okb.hapikuru）に添削させる。
// AI添削サーバー（Cloudflare Worker）にAPIキーが無いあいだ、Worker がトンネル経由でここを呼ぶ。
// 指示文と出力の形は Worker と同じ（../worker/src/prompts.js）。
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import {
  buildJaReviewPrompt,
  buildEnReviewPrompt,
  buildJaReviewInput,
  buildEnReviewInput,
  JA_REVIEW_SCHEMA,
  EN_REVIEW_SCHEMA
} from "../worker/src/prompts.js";

const HOME = os.homedir();
const PORT = Number(process.env.BRIDGE_PORT || 8787);
const TOKEN_FILE = process.env.BRIDGE_TOKEN_FILE || path.join(HOME, ".config/hapikuru-writing-bridge/token");
const TOKEN = readFileSync(TOKEN_FILE, "utf8").trim();
const CODEX = process.env.CODEX_BIN || path.join(HOME, ".npm-global/bin/codex");
const CODEX_HOME = process.env.CODEX_HOME || path.join(HOME, ".codex-hapikuru");
const EFFORT = process.env.BRIDGE_EFFORT || "medium";
const TIMEOUT_MS = Number(process.env.BRIDGE_TIMEOUT_MS || 240000);
const MAX_PARALLEL = Number(process.env.BRIDGE_PARALLEL || 2);

const ROUTES = {
  "/review-ja": { system: buildJaReviewPrompt, input: buildJaReviewInput, schema: JA_REVIEW_SCHEMA },
  "/review-en": { system: buildEnReviewPrompt, input: buildEnReviewInput, schema: EN_REVIEW_SCHEMA }
};

// 同時に動かす数を絞る（Codexの使用量とPCの負荷を抑える）
let running = 0;
const waiting = [];
function acquire() {
  if (running < MAX_PARALLEL) {
    running += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiting.push(resolve));
}
function release() {
  const next = waiting.shift();
  if (next) next();
  else running -= 1;
}

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function runCodex(route, body) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "hwa-bridge-"));
  const schemaFile = path.join(dir, "schema.json");
  const outFile = path.join(dir, "out.json");
  writeFileSync(schemaFile, JSON.stringify(route.schema));
  const prompt = `${route.system()}

## 生徒の入力
${route.input(body)}

ツールやファイルは使わずに、指定のJSONスキーマどおりのJSONだけを返してください。`;
  return new Promise((resolve, reject) => {
    const child = spawn(CODEX, [
      "exec", "--skip-git-repo-check", "--ephemeral", "--sandbox", "read-only",
      "--output-schema", schemaFile, "-o", outFile,
      "-c", `model_reasoning_effort="${EFFORT}"`,
      prompt
    ], { cwd: dir, env: { ...process.env, CODEX_HOME }, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-4000); });
    const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);
    child.on("close", (code) => {
      clearTimeout(timer);
      try {
        if (code !== 0 || !existsSync(outFile)) throw new Error(`codex exit ${code}: ${stderr.slice(-600)}`);
        const text = readFileSync(outFile, "utf8").trim();
        resolve(JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "")));
      } catch (error) {
        reject(error);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, running, waiting: waiting.length }));
    return;
  }
  const route = ROUTES[url.pathname];
  if (!route || req.method !== "POST") {
    res.writeHead(404).end();
    return;
  }
  if (req.headers["x-bridge-token"] !== TOKEN) {
    res.writeHead(401).end();
    return;
  }
  let raw = "";
  for await (const chunk of req) raw += chunk;
  let body;
  try {
    body = JSON.parse(raw);
  } catch (error) {
    res.writeHead(400).end();
    return;
  }

  // 返事はすぐ始め、待つあいだ空白を送る（トンネルの100秒の切断を避ける）
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  const keepAlive = setInterval(() => res.write(" "), 10000);
  const started = Date.now();
  await acquire();
  try {
    const result = await runCodex(route, body);
    res.end(JSON.stringify({ result }));
    log(url.pathname, "ok", `${((Date.now() - started) / 1000).toFixed(1)}s`);
  } catch (error) {
    res.end(JSON.stringify({ error: "codex_failed", message: String(error.message || error).slice(0, 300) }));
    log(url.pathname, "error", String(error.message || error).slice(0, 300));
  } finally {
    clearInterval(keepAlive);
    release();
  }
});

server.listen(PORT, "127.0.0.1", () => log(`bridge listening on 127.0.0.1:${PORT} (CODEX_HOME=${CODEX_HOME})`));
