# OpenChat Guard：在 VPS 上長期執行用的映像檔。
# 程式用 tsx 直接跑 TypeScript，tsx 是 devDependency，所以這裡要裝全部套件，不能用 --omit=dev。
FROM node:26-slim

# 時區：畫面上的時間用這個時區顯示。用別的地區請改 docker-compose.yml 的 TZ。
ENV TZ=Asia/Taipei

# 設定檔和資料都放在掛載的 volume 裡，重建容器不會不見
ENV OPENCHAT_GUARD_DATA=/data
ENV OPENCHAT_GUARD_CONFIG=/data/config.json

WORKDIR /app

# 先裝套件，之後只改程式碼時這一層還能沿用快取。
# --include=dev 不能省：程式用 tsx 直接跑 TypeScript，而 tsx 是 devDependency。
# 同理也不要在這行之前設 NODE_ENV=production，那會讓 npm 自動跳過 devDependencies。
COPY package.json package-lock.json .npmrc ./
RUN npm ci --include=dev

COPY tsconfig.json config.example.json ./
COPY src ./src
COPY docker-entrypoint.sh /usr/local/bin/

# 進入點會把身分降成 /data 的擁有者再執行程式，所以程式本身不是用 root 跑的。
RUN mkdir -p /data && chmod +x /usr/local/bin/docker-entrypoint.sh

VOLUME ["/data"]
ENTRYPOINT ["docker-entrypoint.sh"]

# 預設啟動守衛。是否真的刪除、封鎖由 config.json 的 dryRun 決定。
# 直接跑 node（而不是 npm run guard），這樣 docker stop 的 SIGTERM 才會直接送到程式，能好好存檔再結束。
CMD ["node", "--import", "tsx/esm", "src/guard-qr.ts"]
