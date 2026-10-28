#!/bin/bash
# Vault（正）→ ~/hapikuru-writing-app（git の作業コピー）に写して、GitHub に push する。
# 使い方：bash tools/publish.sh "変更の説明"            … アプリ（GitHub Pages）だけ
#         bash tools/publish.sh --worker "変更の説明"   … AI添削サーバー（Cloudflare Worker）も配置
set -euo pipefail

DEPLOY_WORKER=0
if [ "${1:-}" = "--worker" ]; then DEPLOY_WORKER=1; shift; fi
MESSAGE="${1:-Update writing app}"

SRC="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$HOME/hapikuru-writing-app"
REPO="https://github.com/coskzz/hapikuru-writing-app.git"

if [ ! -d "$DEST/.git" ]; then
  git clone "$REPO" "$DEST"
fi

rsync -a --delete --exclude .git --exclude node_modules --exclude .wrangler "$SRC/" "$DEST/"

cd "$DEST"
node --check app.js
node --check data.js
git add -A
if git diff --cached --quiet; then
  echo "変更なし（push しません）"
else
  git commit -m "$MESSAGE"
  git push origin main
  echo "公開：https://coskzz.github.io/hapikuru-writing-app/ （反映まで1〜2分）"
fi

if [ "$DEPLOY_WORKER" = "1" ]; then
  cd "$DEST/worker"
  [ -d node_modules ] || npm install --no-audit --no-fund
  npx wrangler deploy
fi
