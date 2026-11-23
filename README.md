# OpenChat Guard｜LINE 社群詐騙廣告守衛

**繁體中文** | [English](README.en.md)

自動監看 LINE 社群（OpenChat），偵測圖片裡的**導流 QR Code** 和文字訊息裡的**導流連結**，刪除廣告訊息並封鎖發文者。

詐騙集團在投資、股票社群最常見的手法：一張「老師帶單、免費飆股群」的文字截圖，加一張加 LINE 群組的 QR Code；或直接貼一個短網址、加群連結。這個守衛專門處理這種廣告：

- **純本機判斷**：在你的電腦上掃 QR Code、比對連結，不用 AI、不用付費 API、不會把圖片傳到別的地方，也不會去開啟可疑連結。
- **秒級反應**：通常廣告貼出後幾秒內就刪掉。
- **連同夥一起刪**：同一個人前後一起傳的文字截圖也會一併刪除。
- **不動管理員**：管理員、副管理員和白名單成員的訊息永遠不處理。

> [!WARNING]
> **使用前請先了解風險**
> - LINE 沒有開放社群給程式操作。本專案透過非官方套件 [linejs](https://github.com/evex-dev/linejs) 登入一個 LINE 帳號，**這違反 LINE 使用條款，該帳號可能被停用**。
> - **一定要另外申請一個機器人專用帳號**，絕對不要用你自己或群主的帳號。
> - 本專案僅供社群管理防詐使用，**使用風險自負**，作者不負任何責任。

## 會處理哪些連結

圖片裡的 QR Code 解出以下連結，或文字訊息裡出現以下連結，就處理（[src/qr-policy.ts](src/qr-policy.ts)）：

| 類型 | 例子 |
|---|---|
| LINE 加好友／加群組 | `line.me/ti/...`、`line.me/R/...` |
| LINE 官方帳號短連結 | `lin.ee/...` |
| LINE 小程式 | `liff.line.me/...` |
| Telegram | `t.me/...`、`telegram.me/...` |
| WhatsApp | `wa.me/...`、`chat.whatsapp.com/...` |
| 微信 | 含 `weixin`、`wechat` 的連結 |
| 短網址（常用來藏真正的連結） | `reurl.cc`、`bit.ly`、`tinyurl.com`、`ppt.cc`、`url.kr`、`lihi`… |
| 多連結導流頁（常用來藏 LINE／群組連結） | `linktr.ee`、`portaly.cc` |
| 清單外的短網址跳轉到上面任何一種 | 例如 `xx.bz/abc` 跳到 `line.me/...`，見下方「清單外的短網址」 |
| 免費網域（任何人都能馬上申請，常用來架導流頁） | `xxx.eu.cc`、`xxx.us.kg`、`xxx.duckdns.org`、`xxx.trycloudflare.com`… |
| 你自己加的網域 | `config.json` 的 `extraBlockDomains`，見下方 |

其他連結和 QR Code（例如新聞、Yahoo 股市、YouTube、股票 App 的分享碼）不處理。如果你的社群規定「不准貼任何 QR Code」，可以把 `qrBlockAnyQr` 設成 `true`。

文字連結被刻意變形也認得出來，例如全形字（`ｌｉｎ．ｅｅ`）、用句號代替點（`lin。ee`）、中間夾零寬字元。

### 清單外的短網址

看起來像短網址（網域短、路徑短、不是新聞或股市等大網站）但不在清單裡的連結，守衛會自己去問一次它跳到哪裡：只讀回應標頭裡的跳轉目標（先用 HEAD，網站不接受才改 GET），不載入網頁，最多追 3 層、每層等 2 秒。跳到 LINE、Telegram、WhatsApp、微信、清單上的短網址或你自己封鎖的網域，就照樣處理。

- 這會讓 VPS 對外連到發文者貼的網址。不想要的話，把 `resolveShortLinks` 設成 `false`。
- 不會連到內網或本機位址。
- 同一條連結 10 分鐘內只問一次；逾時或連不上的不算數，下次還會再問。

### 遇到新的導流網域

詐騙集團會一直換網域。看到清單沒有的導流連結，把它的網域加進 `config.json` 的 `extraBlockDomains`，重新啟動守衛：

```json
"extraBlockDomains": ["okbin.eu.cc", "scam-site.com"]
```

- 只要填網域，`https://`、路徑都可以省略。子網域也會一起處理，例如填 `scam-site.com`，`www.scam-site.com` 也算。
- 圖片 QR Code 和文字連結都適用。
- 已經貼出來的訊息不會回頭處理，只對之後的訊息有效。

## 安裝

### 0. 準備

- [Node.js](https://nodejs.org) 26 LTS（建議），或 24.11 以上、22 版的 22.18 以上（登入用的 linejs 套件要求）。專案的 `.nvmrc` 寫的是 26，用 fnm、nvm 等工具可以直接切換到這一版
- 一台一直開著的電腦或 VPS。Windows 請到「設定 → 系統 → 電源」，把睡眠設成「永不」。

```bash
git clone https://github.com/pm7913/openchat-guard.git
cd openchat-guard
npm ci
```

`npm ci` 會照 `package-lock.json` 安裝版本完全一樣的套件。Node 版本不符合時會直接失敗，並顯示需要的版本，請先升級 Node 再安裝。

### 1. 準備機器人帳號

1. 用另一支手機號碼申請一個新的 LINE 帳號。
2. 用這個帳號加入你的社群，並**開啟這個社群的通知**（即時收訊息需要）。
3. 用群主帳號把它設成**副管理員**，並給它「刪除訊息」和「刪除成員」的權限。

### 2. 登入

```bash
npm run login
```

QR Code 會直接畫在終端機上，同時存成 `data/login-qr.png`（Windows 會自動打開這張圖）。用**機器人帳號的手機** LINE 掃描（主頁 → 右上角掃描），再輸入畫面上的認證碼。

**在 VPS 上登入**：用 SSH 連上去執行 `npm run login`，手機直接掃 SSH 視窗裡的 QR Code。QR Code 約 57 字寬、29 行高，掃不到就把視窗拉大或把字型縮小，讓它完整顯示、不要折行。

登入資料存在 `data/auth.json` 和 `data/line-storage.json`，**等同帳號密碼，不要外傳**。之後啟動不用再掃 QR Code。

> [!IMPORTANT]
> 程式是用「LINE 電腦版（Windows）」的身分登入。一個 LINE 帳號同時只能登入一台電腦版，所以**不要再用機器人帳號開 LINE 電腦版**，否則守衛會被擠下線，要重新執行 `npm run login`。手機版不受影響。

### 3. 設定要守護的聊天室

```bash
npm run list
```

畫面會列出機器人加入的每個社群、它在社群裡的身分，以及聊天室 ID（`m` 開頭）。已經在守護的聊天室前面會標 `✓`。

把要守護的聊天室加進去：

```bash
npm run chat:add m0123456789abcdef0123456789abcdef
```

- 會先登入確認聊天室存在、機器人還在社群裡，再寫進 `config.json` 的 `watchChatMids`。
- **新增前要先停止守衛**：新增需要登入，同一個帳號不能跟守衛同時登入。守衛還在跑的話，指令會提醒你先停止。
- 機器人在那個社群如果只是一般成員（`MEMBER`），還是會加入，但會提醒你：看得到廣告、刪不掉。
- 可以一次加好幾個，ID 之間用空白隔開。已經在清單裡的不會重複加入。

不想守護了就移除：

```bash
npm run chat:remove m0123456789abcdef0123456789abcdef
```

移除不需要登入，守衛執行中也可以用，但要重新啟動守衛才會生效。手動填錯的 ID 也能用這個指令移除。

也可以直接改 `config.json`。第一次執行任何指令時，程式會從 `config.example.json` 自動建立你自己的 `config.json`，聊天室 ID 填在 `watchChatMids`，好幾個就用逗號隔開：

```json
"watchChatMids": ["m1234abcd...", "m5678efgh..."]
```

機器人在每個要守護的聊天室都要是副管理員。

### 4. 觀察模式（建議先跑幾天）

```bash
npm run guard
```

`config.json` 預設 `"dryRun": true`：只在畫面上顯示「會刪除／會封鎖」，**不會真的動手**。啟動時確認畫面顯示機器人身分是 `CO_ADMIN` 或 `ADMIN`，以及哪些管理員不會被處理。

### 5. 正式啟用

確認判斷沒問題後，兩種方式擇一：

- 把 `config.json` 的 `"dryRun"` 改成 `false`，再執行 `npm run guard`。
- 或直接執行 `npm run guard:live`，這次正式動手，不改設定檔。

抓到廣告時畫面會顯示：

```
🚫 導流QR｜你的社群｜發文者暱稱｜LINE 加好友／加群連結｜https://line.me/ti/g2/...
  └ 訊息 2 則：已刪除、已刪除｜成員：已封鎖
```

文字連結會顯示「🚫 導流文字連結」。如果封鎖失敗，會改成把對方移出社群（顯示「已移出」）。

每次處理都記在 `data/guard-actions.jsonl`（文字訊息的內容也記在這裡），被判定的圖片存在 `data/guard-images/` 當證據（含成員內容，請定期清理）。

**注意**：同一個機器人帳號同時只能跑一個程式，也不要同時在兩台電腦上跑。

### 讓它一直跑

- **Windows**：點兩下 `start-guard.bat`，程式當掉會自動重啟。是否真的動手一樣由 `dryRun` 決定。要停止就在 3 秒內按兩次 `Ctrl+C`，或直接關掉這個視窗。按一次 `Ctrl+C` 只會提示，不會停止，免得想複製日誌時誤按就把守衛停掉。
- **VPS（Linux）**：建議用 [Docker](#用-docker-跑vps)，或用 [pm2](https://pm2.keymetrics.io)、systemd，例如：
  ```bash
  pm2 start npm --name openchat-guard -- run guard
  ```

直接用 `npm run guard` 啟動的，在視窗裡按 `Ctrl+C` 停止，會順便存好讀取進度。下次啟動會補處理停機期間的訊息。在 Linux 終端機裡同樣要 3 秒內按兩次；在 Windows 上用 npm 啟動則是按一次就停，因為 npm 收到第一下 `Ctrl+C` 就會自己先結束。pm2、systemd、`docker stop` 停止服務時都是馬上停。

改了 `config.json` 之後要重新啟動才會生效。

## 用 Docker 跑（VPS）

> [!WARNING]
> **從國外機房的 IP 登入，帳號更容易被盯上。** 這個帳號本來就有被 LINE 停用的風險，再從一個跟平常完全不同的國家、而且是資料中心的 IP 登入，更容易觸發驗證或停權。要用 VPS 的話，建議挑**台灣或日本**的機房。

規格 1GB 記憶體就夠，不建議 512MB（掃描大張圖片時記憶體會衝高）。不需要對外開任何 port，程式只會主動連 LINE。

設定檔和登入資料都放在 `./data`，重建容器不會不見。

### 1. 取得程式並先建好 data 資料夾

```bash
git clone https://github.com/pm7913/openchat-guard.git
cd openchat-guard
mkdir -p data
```

`mkdir -p data` 不要省略。先自己建立，裡面的檔案才會屬於你，之後在主機上才能直接編輯 `data/config.json`。忘了建也不會壞，程式照樣跑得起來，只是那些檔案會變成要用 `sudo` 才能改。

### 2. 第一次登入

```bash
docker compose run --rm guard npm run login
```

QR Code 會直接畫在畫面上，用機器人帳號的手機掃，再在手機上輸入畫面顯示的認證碼。整個過程不用打字，所以也可以先 `docker compose up -d` 再用 `docker compose logs -f` 看。但 QR Code 幾分鐘就過期，用上面這個指令比較即時。

掃不到的話，`./data/login-qr.png` 是同一張圖，可以直接打開來掃。

### 3. 設定要守護的聊天室

```bash
docker compose run --rm guard npm run list
```

第一次執行會從範本建立 `./data/config.json`。把聊天室加進去：

```bash
docker compose run --rm guard npm run chat:add <聊天室 ID>
```

`./data/config.json` 也可以直接用編輯器改。觀察模式（`dryRun`）維持 `true` 先跑幾天，確認判斷沒問題再改成 `false`。

### 4. 啟動

```bash
docker compose up -d --build
```

| 要做什麼 | 指令 |
|---|---|
| 看畫面 | `docker compose logs -f` |
| 停止 | `docker compose stop` |
| 重新啟動（改完設定） | `docker compose restart` |
| 更新到新版 | `git pull` 然後 `docker compose up -d --build` |

**登入、查聊天室、增減聊天室都要先 `docker compose stop`**，因為同一個帳號同時只能登入一個程式。守衛執行中硬跑會被擋下來（`chat:add` 會提醒你），但 `login` 不會擋，會把守衛擠下線。

時區預設是 `Asia/Taipei`，在 `docker-compose.yml` 的 `TZ` 改。

`./data/guard-images/` 會一直長大，記得定期清理。

### 自動部署（推到 GitHub 就更新）

想讓 VPS 自動跟上 GitHub 上的新版本，在 VPS 上執行一次：

```bash
git clone https://github.com/pm7913/openchat-guard.git /tmp/openchat-guard-install
bash /tmp/openchat-guard-install/ops/install-auto-deploy.sh
```

裝好之後 systemd 每 2 分鐘檢查一次 GitHub，有新 commit 就：抓下來 → 建映像 → **在沒有網路的容器裡跑測試** → 換新容器 → 等日誌出現「開始守護」。中間任何一步失敗都不會換過去；健康檢查失敗還會自動回退到上一個正常版本。只改 `.md` 的 commit 不會重新部署。

| 指令 | 用途 |
|---|---|
| `openchat-guard-deploy status` | 目前版本、遠端版本、最近的部署紀錄 |
| `openchat-guard-deploy now` | 不等 2 分鐘，立刻檢查並部署 |
| `openchat-guard-deploy rollback` | 回到上一個成功部署的版本 |

**Telegram 通知**（選用）：在 `~/openchat-guard/.env` 填這兩行，部署成功、失敗、回退時都會通知。沒填就不通知，其他功能照常。這個檔案不會進 git。

```
TELEGRAM_BOT_TOKEN=你的 bot token
TELEGRAM_CHAT_ID=你的 chat id
```

Token 跟你的 bot 綁在一起，等於密碼，不要放進 repo 或分享出去。

不用 compose、想自己跑 `docker run` 的話，用這兩個環境變數指定位置：`OPENCHAT_GUARD_DATA`（資料夾）和 `OPENCHAT_GUARD_CONFIG`（設定檔）。沒設定時就用專案裡的 `data/` 和 `config.json`。

### 更新到新版

先停止守衛，然後：

```bash
git pull
npm ci
```

你的 `config.json` 和 `data/` 不會被覆蓋，也不用重新登入。

## 設定（config.json）

QR 守衛用到的設定：

| 設定 | 說明 |
|---|---|
| `dryRun` | `true` 只顯示不動手（預設）；`false` 正式刪除和封鎖 |
| `watchChatMids` | 要守護的聊天室 ID，用 `npm run list` 查，用 `npm run chat:add`／`chat:remove` 增減 |
| `banInsteadOfKick` | `true` 封鎖，對方不能再加入（預設）；`false` 只移出 |
| `hideContentsOnBan` | 封鎖時一併隱藏此人所有歷史訊息（預設 `false`） |
| `whitelistMemberMids` | 永遠不處理的成員 ID（`p` 開頭）。管理員、副管理員已自動排除 |
| `qrBurstWindowSec` | 抓到後一併刪除同一人幾秒內的其他訊息（預設 120） |
| `qrBlockAnyQr` | `true` 任何 QR Code 都處理；`false` 只處理上面列的導流連結（預設） |
| `blockTextLinks` | `true` 文字訊息裡的導流連結也處理（預設）；`false` 只看圖片 |
| `extraBlockDomains` | 自訂要封鎖的網域，見上方「遇到新的導流網域」（預設空的） |
| `resolveShortLinks` | `true` 清單外的疑似短網址會追一次跳轉目標（預設），見上方「清單外的短網址」；`false` 不對外連線 |
| `pollIntervalSec` | 補漏間隔的秒數範圍（預設 `[10, 20]`），見下方「怎麼收到訊息」 |

`config.json` 裡其他設定是實驗性 AI 模式用的，QR 守衛用不到。

## 其他指令

| 指令 | 用途 |
|---|---|
| `npm run watch` | 收訊測試：只接收和記錄訊息，圖片會存檔並掃 QR Code，不刪除、不封鎖。紀錄在 `data/watch-messages.jsonl`、`data/watch-images/`（含成員發言，測完請刪除） |
| `npm run guard:test` | 正式動手但只移出、不封鎖，方便用測試帳號驗證，對方之後還能再加入 |
| `npm run test:image` | QR 辨識測試：用程式產生的刁鑽圖片（角落小 QR、反色、旋轉、模糊、雜訊…），不需要登入 |
| `npx tsx src/test-image.ts <圖片或資料夾>` | 掃描你自己的圖，例如手機截下的廣告圖 |
| `npm run test:links` | 文字連結測試：哪些文字會被當成導流連結，不需要登入 |
| `npm run probe` | 診斷：測試目前登入的帳號能用哪些社群功能，只讀取、不改任何東西 |
| `npm run typecheck` | 開發用：檢查 TypeScript 型別 |

## 常見問題

**啟動時顯示「還沒登入。請先執行：npm run login」**

還沒登入過，或 `data/auth.json` 不見了。執行 `npm run login` 重新登入。

**啟動時就出錯結束，或畫面一直出現「補漏失敗」、每小時統計的推播都是 0**

通常是登入失效了，例如有人用機器人帳號開了 LINE 電腦版把它擠下線，或帳號被登出、停用。停止守衛，執行 `npm run login` 重新登入，再啟動。

用 `start-guard.bat` 的話，登入失效後它會每 10 秒重啟、一直失敗下去。看到這種情況就關掉視窗，重新登入後再開。

**啟動時出現「⚠ 機器人不是管理員或副管理員」**

機器人沒有刪除權限，抓到廣告也刪不掉。用群主帳號把它設成副管理員，給它「刪除訊息」和「刪除成員」的權限，然後重新啟動。

**有廣告沒被刪掉**

1. 圖片廣告：把圖存下來，用 `npx tsx src/test-image.ts <圖片>` 掃看看。如果掃不出 QR Code，守衛就不會處理。
2. 連結不在[處理清單](#會處理哪些連結)裡：把網域加進 `extraBlockDomains`，見「遇到新的導流網域」。之前的那則要自己在 LINE 裡刪掉。
3. 確認機器人帳號有開啟這個社群的通知。

**誤刪了正常成員的訊息**

把這位成員的 ID（`p` 開頭，就是 `data/guard-actions.jsonl` 那筆紀錄的 `senderMid`）加進 `whitelistMemberMids`，重新啟動。如果你有開 `qrBlockAnyQr`，也可以考慮改回 `false`。

## 運作方式

### 怎麼收到訊息

- **推播（主要）**：跟 LINE 維持一條長連線，有新訊息時伺服器主動推過來，跟官方 App 一樣。
- **補漏（備援）**：每 10～20 秒（隨機）主動抓一次，補上推播漏掉的訊息。實測推播偶爾會漏，補漏能在幾十秒內補上。
- 同一則訊息兩邊都收到時只處理一次。程式每小時會回報推播與補漏各收到幾則、補漏失敗幾次。

### QR Code 怎麼辨識

用 [zxing-wasm](https://github.com/Sec-ant/zxing-wasm) 在本機掃描原圖，會嘗試旋轉、反色、縮放、降噪。圖片很小時會放大再掃，最後用 [jsQR](https://github.com/cozmo/jsQR) 當備援。辨識元件跟著 npm 套件安裝，執行時不會連網路下載。

## 管不到的地方

- **私訊**：詐騙集團私訊成員，機器人看不到。建議在社群公告「管理員不會私訊你，私訊邀你投資都是詐騙」。
- **沒有連結的文字廣告**：例如「加賴 abc8899」「私我拿資料」。守衛只認連結，不判斷文字內容。
- **新的導流網域**：清單沒有的網域第一次出現時會漏掉，要自己加進 `extraBlockDomains`。（新網域如果最後又跳到 LINE 等連結，追跳轉時會抓到。）
- **QR Code 被刻意破壞或藏得很深**：辨識不出來就不會處理。

## 實驗功能：AI 判斷文字廣告

`npm start` 會啟動另一個版本，除了 QR Code 也用規則和 Claude AI 判斷文字廣告。這部分還在實驗階段，沒有像 QR 守衛一樣在真實社群長時間驗證過，而且需要 [Anthropic API key](https://console.anthropic.com)，會產生費用。

1. 把 `.env.example` 複製成 `.env`，填入 `ANTHROPIC_API_KEY`。
2. `npm run test:rules` 只測規則（免費）；`npm run test:ai` 測規則加 AI（會產生少量費用）。範例訊息在 `samples/`。
3. 相關設定：`model`、`thresholds`、`newMemberDays`、`ruleOnlyScore`、`llmGate`、`llmScoreGate`、`llmMinLengthForReview`、`extraKeywords`、`ignoreKeywords`、`contextMessages`。說明見 [src/config.ts](src/config.ts)。

## 資料存在哪

所有資料都存在專案的 `data/` 資料夾，已經排除在 git 之外：

| 檔案 | 內容 |
|---|---|
| `auth.json`、`line-storage.json` | 機器人帳號登入資料，**等同帳號密碼，不可外傳** |
| `guard-actions.jsonl`、`guard-images/` | QR 守衛的處理紀錄與證據圖 |
| `guard-state.json` | 讀取進度 |
| `running.json` | 守衛執行中的標記，讓 `chat:add` 知道守衛還在跑；守衛正常結束時會自動刪除。守衛被強制關掉才會留下來，這時手動刪掉它即可 |
| `config.json` | 只有用 Docker 時設定檔才會放在這裡 |
| `watch-*` | 收訊測試的紀錄與圖片 |

## 授權

[MIT](LICENSE)。本專案與 LINE 公司無關。
