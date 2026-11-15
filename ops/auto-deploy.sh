#!/usr/bin/env bash
# OpenChat Guard 自動部署（在 VPS 上執行；systemd timer 每 2 分鐘呼叫一次 `tick`）。
# 仿照同一台機器上 cerberus-shioaji-deploy 的做法：
#   fetch GitHub → 有新 commit 就 git archive 該 commit → build openchat-guard:<短碼>
#   → 無網路容器跑測試 → 換容器 → 等日誌出現「開始守護」；失敗就回退並用 Telegram 通知。
#
# 用法（安裝後指令名稱為 openchat-guard-deploy）：
#   openchat-guard-deploy tick            # timer 呼叫：有新 commit 才部署
#   openchat-guard-deploy now [--force]   # 立刻檢查並部署（--force：重試失敗過的 commit）
#   openchat-guard-deploy rollback        # 回到上一個成功部署的版本
#   openchat-guard-deploy status          # 目前版本、遠端版本、最近的部署紀錄
#
# 狀態（$DEPLOY_ROOT/.deploy/）：
#   current＝最後處理過的 commit；deployed＝映像與 compose 正在執行的 commit；
#   previous＝上一個成功部署的 commit（回退用）。只改 Markdown 時只更新 current。
#
# 設定（環境變數，可寫在 /etc/default/openchat-guard-deploy）：
#   DEPLOY_ROOT=/home/ubuntu/openchat-guard   執行目錄（.env、data/、docker-compose.yml）
#   DEPLOY_BRANCH=main
#
# Telegram 通知：在 $DEPLOY_ROOT/.env 填 TELEGRAM_BOT_TOKEN 和 TELEGRAM_CHAT_ID，
# 沒填就不通知，其他功能照常。這個檔案不會進 git。
set -euo pipefail

ROOT="${DEPLOY_ROOT:-$HOME/openchat-guard}"
BRANCH="${DEPLOY_BRANCH:-main}"
REPO="$ROOT/.deploy/repo"
STATE="$ROOT/.deploy"
IMAGE="openchat-guard"
CONTAINER="openchat-guard"
HEALTH_MARK="開始守護"
HEALTH_TIMEOUT=120
KEEP_IMAGES=5

mkdir -p "$STATE"
exec 9>"$STATE/lock"
flock -n 9 || { echo "另一個部署正在執行，略過"; exit 0; }

log() { echo "[deploy $(TZ=Asia/Taipei date '+%F %T')] $*" | tee -a "$STATE/deploy.log"; }

notify() {
  log "通知：$1"
  local token chat
  token=$(grep -E '^TELEGRAM_BOT_TOKEN=' "$ROOT/.env" 2>/dev/null | cut -d= -f2- | tr -d '"'"'"'\r' || true)
  chat=$(grep -E '^TELEGRAM_CHAT_ID=' "$ROOT/.env" 2>/dev/null | cut -d= -f2- | tr -d '"'"'"'\r' || true)
  [[ -n "$token" && -n "$chat" ]] || return 0
  curl -fsS -m 15 -o /dev/null "https://api.telegram.org/bot${token}/sendMessage" \
    --data-urlencode "chat_id=${chat}" --data-urlencode "text=[OpenChat Guard deploy] $1" \
    || log "Telegram 通知失敗"
}

read_state() { cat "$STATE/$1" 2>/dev/null || true; }
short() { echo "${1:0:7}"; }
compose() { (cd "$ROOT" && docker compose "$@"); }

# 守衛要能啟動，得先登入、也要設定好聊天室。缺的話通知一次就好，不要每 2 分鐘洗版。
preflight() {
  local why=""
  [[ -f "$ROOT/data/auth.json" ]] || why="尚未登入（$ROOT/data/auth.json 不存在）"
  if [[ -z "$why" ]] && ! grep -qE '"watchChatMids"[[:space:]]*:[[:space:]]*\[[[:space:]]*"m' "$ROOT/data/config.json" 2>/dev/null; then
    why="還沒設定要守護的聊天室（$ROOT/data/config.json 的 watchChatMids 是空的）"
  fi
  if [[ -n "$why" ]]; then
    log "$why，先不部署"
    if [[ "$(read_state nologin)" != "$why" ]]; then
      echo "$why" > "$STATE/nologin"
      notify "$why，設定好之後會自動部署"
    fi
    return 1
  fi
  rm -f "$STATE/nologin"
  return 0
}

healthy_since() {
  # $1＝容器啟動時間（RFC3339）。等日誌出現「開始守護」，且容器仍在執行
  local since=$1 st
  for _ in $(seq 1 "$HEALTH_TIMEOUT"); do
    # 啟動就當掉（重啟次數 > 0 或已結束）立刻判定失敗，不用等滿
    st=$(docker inspect -f '{{.RestartCount}} {{.State.Status}}' "$CONTAINER" 2>/dev/null || echo "x missing")
    [[ "$st" == "0 running" || "$st" == "0 created" ]] || return 1
    if docker logs --since "$since" "$CONTAINER" 2>&1 | grep -q "$HEALTH_MARK"; then
      sleep 3
      [[ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null)" == "true" ]] && return 0
      return 1
    fi
    sleep 1
  done
  return 1
}

prepare() {
  # $1＝commit。放好該版本的 docker-compose.yml，並把 :latest 指到 :<短碼>
  local sha=$1
  git -C "$REPO" show "$sha:docker-compose.yml" > "$ROOT/docker-compose.yml.new"
  mv "$ROOT/docker-compose.yml.new" "$ROOT/docker-compose.yml"
  docker tag "$IMAGE:$(short "$sha")" "$IMAGE:latest"
}

switch_to() {
  # $1＝commit。換成該版本後重建容器，並等它真的起來
  local sha=$1 since
  prepare "$sha"
  since=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  compose up -d --no-build --remove-orphans --force-recreate
  healthy_since "$since"
}

deploy() {
  local target=$1 force=$2 current deployed tag subject
  current=$(read_state current)
  deployed=$(read_state deployed)
  tag="$IMAGE:$(short "$target")"

  if [[ "$force" != 1 && "$(read_state failed)" == "$target" ]]; then
    exit 0   # 這個 commit 已失敗過，等新 commit 或 now --force
  fi

  # 只改 Markdown 不部署（仍記錄為目前版本）
  if [[ "$force" != 1 && -n "$current" && "$current" != "$target" ]] && git -C "$REPO" cat-file -e "$current" 2>/dev/null; then
    if ! git -C "$REPO" diff --name-only "$current" "$target" | grep -qvE '\.md$'; then
      echo "$target" > "$STATE/current"
      log "$(short "$target") 只改 Markdown，不部署"
      return 0
    fi
  fi

  subject=$(git -C "$REPO" log -1 --format=%s "$target")
  log "開始部署 $(short "$target")：$subject"

  # 同一個 commit 重試時不用再 build 和測試一次
  if ! docker image inspect "$tag" >/dev/null 2>&1; then
    if ! git -C "$REPO" archive --format=tar "$target" \
        | docker build -q -t "$tag" - >>"$STATE/deploy.log" 2>&1; then
      notify "$(short "$target") build 失敗，未部署（$subject）"
      echo "$target" > "$STATE/failed"; exit 1
    fi

    # 不連網路跑測試：QR 辨識和連結規則都是純本機判斷，本來就不該需要網路
    if ! docker run --rm --network none "$tag" npm run test:image >>"$STATE/deploy.log" 2>&1 \
       || ! docker run --rm --network none "$tag" npm run test:links >>"$STATE/deploy.log" 2>&1; then
      notify "$(short "$target") 測試失敗，未部署（$subject）"
      echo "$target" > "$STATE/failed"; exit 1
    fi
  fi

  # 還沒部署過的話先把 docker-compose.yml 和 :latest 準備好，
  # 這樣即使還沒登入，也能用 docker compose run 做登入和設定。
  [[ -n "$deployed" ]] || prepare "$target"

  preflight || exit 0

  if switch_to "$target"; then
    [[ -n "$deployed" && "$deployed" != "$target" ]] && echo "$deployed" > "$STATE/previous"
    echo "$target" > "$STATE/deployed"
    echo "$target" > "$STATE/current"
    rm -f "$STATE/failed"
    notify "已部署 $(short "$target")：$subject"
    prune
    return 0
  fi

  docker logs --tail 30 "$CONTAINER" >>"$STATE/deploy.log" 2>&1 || true
  echo "$target" > "$STATE/failed"
  if [[ -n "$deployed" ]] && docker image inspect "$IMAGE:$(short "$deployed")" >/dev/null 2>&1 && switch_to "$deployed"; then
    notify "$(short "$target") 健康檢查失敗，已回退到 $(short "$deployed")（$subject）"
  else
    notify "$(short "$target") 健康檢查失敗，而且無法回退，請手動處理"
  fi
  exit 1
}

prune() {
  # 保留最近 KEEP_IMAGES 個版本的映像（目前、上一版一定保留）
  local keep_cur keep_prev
  keep_cur="$IMAGE:$(short "$(read_state deployed)")"; keep_prev="$IMAGE:$(short "$(read_state previous)")"
  docker images "$IMAGE" --format '{{.Repository}}:{{.Tag}}' | grep -vE ':latest$' \
    | tail -n +$((KEEP_IMAGES + 1)) | while read -r img; do
      [[ "$img" == "$keep_cur" || "$img" == "$keep_prev" ]] || docker rmi "$img" >/dev/null 2>&1 || true
    done
}

fetch() {
  [[ -d "$REPO" ]] || { echo "尚未設定 repo：$REPO（請執行 ops/install-auto-deploy.sh）" >&2; exit 1; }
  git -C "$REPO" fetch -q origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH"
  git -C "$REPO" rev-parse "origin/$BRANCH"
}

cmd=${1:-tick}
case "$cmd" in
  tick|now)
    force=0; [[ "${2:-}" == "--force" ]] && force=1
    target=$(fetch)
    if [[ "$target" == "$(read_state current)" && "$force" != 1 ]]; then
      [[ "$cmd" == now ]] && echo "已是最新 $(short "$target")"
      exit 0
    fi
    deploy "$target" "$force"
    ;;
  rollback)
    prev=$(read_state previous); cur=$(read_state deployed)
    [[ -n "$prev" ]] || { echo "沒有上一版可回退" >&2; exit 1; }
    log "手動回退 $(short "$cur") → $(short "$prev")"
    if switch_to "$prev"; then
      # current 不動：同一個遠端 commit 不會再自動部署，推新 commit 或 now --force 才會
      echo "$prev" > "$STATE/deployed"; echo "$cur" > "$STATE/previous"
      notify "已手動回退到 $(short "$prev")；推新 commit 或 now --force 才會再部署"
    else
      notify "回退到 $(short "$prev") 失敗，請手動處理"; exit 1
    fi
    ;;
  status)
    cur=$(read_state deployed)
    echo "執行中版本：$(short "$cur") $( [[ -n "$cur" ]] && git -C "$REPO" log -1 --format='%s (%cr)' "$cur" 2>/dev/null)"
    echo "已處理到：$(short "$(read_state current)")（之後只改 Markdown 的 commit 不重新部署）"
    echo "上一版本：$(short "$(read_state previous)")"
    echo "遠端 $BRANCH：$(short "$(git -C "$REPO" rev-parse "origin/$BRANCH" 2>/dev/null)")（上次 fetch 的結果）"
    [[ -n "$(read_state nologin)" ]] && echo "等設定完成：$(read_state nologin)"
    [[ -n "$(read_state failed)" ]] && echo "失敗、不再自動重試：$(short "$(read_state failed)")"
    echo "--- 最近紀錄"; tail -n 10 "$STATE/deploy.log" 2>/dev/null || true
    ;;
  *) echo "用法：$0 {tick|now [--force]|rollback|status}" >&2; exit 2 ;;
esac
