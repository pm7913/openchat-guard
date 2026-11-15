#!/bin/sh
# 用「掛載進來的 /data 資料夾的擁有者」身分執行程式。
#
# 為什麼要這樣做：容器寫出來的登入資料、設定檔都在 /data，如果身分對不上，
# 不是容器寫不進去（permission denied），就是主機上要 sudo 才能編輯 config.json。
# 不同主機的使用者編號不一樣（例如 Ubuntu 預設是 1000，Oracle Cloud 是 1001），
# 所以這裡直接看資料夾本身是誰的，不寫死。
set -e

uid=${PUID:-1000}
gid=${PGID:-1000}

if [ -d /data ]; then
  owner_uid=$(stat -c %u /data)
  owner_gid=$(stat -c %g /data)
  if [ "$owner_uid" = "0" ]; then
    # Docker 自動建立的資料夾屬於 root，誰都寫不進去：改成預設（或 PUID/PGID 指定）的使用者。
    # 想在主機上直接編輯 config.json 的話，先自己 mkdir -p data 再啟動，資料夾就會是你的。
    [ "$(id -u)" = "0" ] && chown "$uid:$gid" /data
  else
    uid=$owner_uid
    gid=$owner_gid
  fi
elif [ "$(id -u)" = "0" ]; then
  mkdir -p /data
  chown "$uid:$gid" /data
fi

# compose 已經指定 user: 的話就不是 root，直接照它的身分跑
if [ "$(id -u)" != "0" ]; then
  exec "$@"
fi

# npm 需要一個寫得進去的家目錄放快取和記錄
export HOME=/tmp
exec setpriv --reuid="$uid" --regid="$gid" --clear-groups "$@"
