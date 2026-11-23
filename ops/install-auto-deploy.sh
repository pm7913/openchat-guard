#!/usr/bin/env bash
# 在 VPS 上安裝自動部署（可重複執行，重跑等於更新）。
#   - 建立執行目錄 ~/openchat-guard（.env、data/、docker-compose.yml 都在這裡）
#   - 建立 .deploy/repo（只用來 fetch 與 git archive，不 checkout）
#   - 安裝 /usr/local/bin/openchat-guard-deploy 與 systemd timer（每 2 分鐘）
#
# 用法（在 VPS 上）：
#   git clone https://github.com/pm7913/openchat-guard.git /tmp/openchat-guard-install
#   bash /tmp/openchat-guard-install/ops/install-auto-deploy.sh
#
# openchat-guard 是公開 repo，用 HTTPS 抓就好，不需要 deploy key。
set -euo pipefail

BRANCH=${1:-main}
URL=${OPENCHAT_GUARD_REPO:-https://github.com/pm7913/openchat-guard.git}
ROOT="$HOME/openchat-guard"
REPO="$ROOT/.deploy/repo"
HERE=$(cd "$(dirname "$0")" && pwd)
SVC=openchat-guard-deploy

# data/ 先由自己建立，裡面的檔案才會屬於自己，主機上才編輯得動 config.json
mkdir -p "$ROOT/data" "$ROOT/.deploy"

# 只用來 fetch 的 repo，不 checkout
if [[ ! -d "$REPO/.git" ]]; then
  git init -q "$REPO"
  git -C "$REPO" remote add origin "$URL"
fi
git -C "$REPO" remote set-url origin "$URL"

sudo install -m 0755 "$HERE/auto-deploy.sh" "/usr/local/bin/$SVC"
sudo tee "/etc/default/$SVC" >/dev/null <<EOF
DEPLOY_ROOT=$ROOT
DEPLOY_BRANCH=$BRANCH
HOME=$HOME
EOF
sudo tee "/etc/systemd/system/$SVC.service" >/dev/null <<EOF
[Unit]
Description=OpenChat Guard auto deploy (fetch GitHub, build, test, switch)
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=oneshot
User=$(id -un)
EnvironmentFile=/etc/default/$SVC
ExecStart=/usr/local/bin/$SVC tick
TimeoutStartSec=20min
EOF
sudo tee "/etc/systemd/system/$SVC.timer" >/dev/null <<EOF
[Unit]
Description=Run OpenChat Guard auto deploy every 2 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=2min
AccuracySec=10s

[Install]
WantedBy=timers.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now "$SVC.timer" >/dev/null

echo "== 安裝完成"
systemctl list-timers "$SVC.timer" --no-pager | head -3
echo
echo "== 接下來"
echo "1. 先建好映像檔（也會產生 $ROOT/docker-compose.yml）："
echo "   $SVC now"
echo "2. 登入（要用機器人帳號的手機掃 QR Code）："
echo "   cd $ROOT && docker compose run --rm guard npm run login"
echo "3. 設定要守護的聊天室："
echo "   cd $ROOT && docker compose run --rm guard npm run chat:add <聊天室 ID>"
echo "   設定好之後 timer 會在 2 分鐘內自動把守衛啟動起來。"
echo "4. 想要 Telegram 通知就執行（會一步步帶你填好 $ROOT/.env）："
echo "   bash <(git -C $REPO show origin/main:ops/set-telegram.sh)"
echo "   也可以自己在 $ROOT/.env 填 TELEGRAM_BOT_TOKEN=... 和 TELEGRAM_CHAT_ID=..."
echo "   沒設定就不通知，其他功能照常。這個檔案不會進 git。"
echo "5. 看狀態：$SVC status"
