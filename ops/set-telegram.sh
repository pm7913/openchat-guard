#!/usr/bin/env bash
# 互動式填入 Telegram 通知設定。
# token 只會留在這台機器的 .env（權限 600、不在 git 裡），不用貼到聊天視窗，也不會留在指令歷史。
# 用法（在 VPS 上，裝好自動部署之後）：
#   bash <(git -C ~/openchat-guard/.deploy/repo show origin/main:ops/set-telegram.sh)
# 或在 clone 下來的專案裡：bash ops/set-telegram.sh
set -euo pipefail

ROOT="${DEPLOY_ROOT:-$HOME/openchat-guard}"
ENV_FILE="$ROOT/.env"
mkdir -p "$ROOT"

echo "=== OpenChat Guard：設定 Telegram 通知"
echo

# -s：貼上時畫面不顯示，token 不會留在終端機畫面或捲動紀錄裡
printf '貼上 bot token（畫面不會顯示），按 Enter：'
read -rs TOKEN
printf '\n'
TOKEN=$(printf '%s' "$TOKEN" | tr -d '[:space:]')
[[ -n "$TOKEN" ]] || { echo "沒有輸入，結束。"; exit 1; }

api() { curl -fsS -m 20 "https://api.telegram.org/bot$TOKEN/$1"; }

user=$(api getMe 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["result"]["username"])' 2>/dev/null) || {
  echo "✗ Telegram 不接受這個 token。請回 @BotFather → /mybots → API Token 重新複製（格式像 123456789:AAE...）。"
  exit 1
}
echo "✓ token 有效，機器人是 @$user"
echo

printf '貼上 chat id（不知道的話直接按 Enter，我去問 Telegram）：'
read -r CHAT
CHAT=$(printf '%s' "$CHAT" | tr -d '[:space:]')

if [[ -z "$CHAT" ]]; then
  echo
  echo "那就自動偵測："
  echo "  1. 用你自己的 Telegram 打開 https://t.me/$user"
  echo "  2. 按「開始 / START」，再隨便傳一句話給它（例如 hi）"
  echo "  3. 回到這裡按 Enter"
  read -r _
  CHAT=$(api getUpdates 2>/dev/null | python3 -c '
import json, sys
ids = []
for u in json.load(sys.stdin)["result"]:
    m = u.get("message") or u.get("channel_post") or {}
    c = m.get("chat") or {}
    if "id" in c and c["id"] not in ids:
        ids.append(c["id"])
print(ids[-1] if ids else "")
' 2>/dev/null) || CHAT=""
  if [[ -z "$CHAT" ]]; then
    echo "✗ 收不到訊息。確認你真的傳了一句話給 @$user 之後再重跑一次。"
    echo "  （這個機器人若設過 webhook，getUpdates 會一直是空的，要先 /deletewebhook）"
    exit 1
  fi
  echo "✓ 偵測到 chat id：$CHAT"
fi

[[ "$CHAT" =~ ^-?[0-9]+$ ]] || { echo "✗ chat id 看起來不是數字：$CHAT"; exit 1; }

# 先用這組設定真的發一則訊息，確定通得過再寫檔，免得寫進一組不會動的設定
if ! curl -fsS -m 20 -o /dev/null "https://api.telegram.org/bot$TOKEN/sendMessage" \
       --data-urlencode "chat_id=$CHAT" \
       --data-urlencode "text=[OpenChat Guard deploy] 通知設定完成。之後部署成功、失敗、回退、還沒登入都會通知這裡。"; then
  echo "✗ 這組 token 和 chat id 發不出訊息，沒有寫入設定。"
  echo "  常見原因：chat id 填錯，或你還沒跟 @$user 按過「開始」。"
  exit 1
fi
echo "✓ 測試訊息已送出"

# 用環境變數傳值，不放命令列參數（參數會出現在 ps 的輸出裡）
umask 077
TG_TOKEN="$TOKEN" TG_CHAT="$CHAT" TG_ENV="$ENV_FILE" python3 <<'PY'
import os, pathlib
p = pathlib.Path(os.environ["TG_ENV"])
want = {"TELEGRAM_BOT_TOKEN": os.environ["TG_TOKEN"], "TELEGRAM_CHAT_ID": os.environ["TG_CHAT"]}
lines = p.read_text(encoding="utf-8").splitlines() if p.exists() else []
out, seen = [], set()
for ln in lines:
    k = ln.split("=", 1)[0].strip()
    if k in want:
        if k in seen:          # 同一個 key 重複出現就只留一行
            continue
        out.append(f"{k}={want[k]}")
        seen.add(k)
    else:
        out.append(ln)
for k, v in want.items():
    if k not in seen:
        out.append(f"{k}={v}")
p.write_text("\n".join(out).rstrip("\n") + "\n", encoding="utf-8", newline="\n")
PY
chmod 600 "$ENV_FILE"
echo "✓ 已寫入 $ENV_FILE（權限 600，不在 git 裡）"
echo
echo "去 Telegram 看收到測試訊息了沒有。收到就完成了，不用重啟任何東西。"
unset TOKEN
