# OpenChat Guard｜LINE 社群詐騙廣告守衛

**繁體中文** | [English](README.en.md)

自動監看 LINE 社群（OpenChat），偵測圖片裡的**導流 QR Code**，刪除廣告訊息並封鎖發文者。

詐騙集團在投資、股票社群最常見的手法：一張「老師帶單、免費飆股群」的文字截圖，加一張加 LINE 群組的 QR Code。這個守衛專門處理這種廣告：

- **純本機判斷**：在你的電腦上掃 QR Code，不用 AI、不用付費 API、不會把圖片傳到別的地方。
- **秒級反應**：通常廣告貼出後幾秒內就刪掉。
- **連同夥一起刪**：同一個人前後一起傳的文字截圖也會一併刪除。
- **不動管理員**：管理員、副管理員和白名單成員的訊息永遠不處理。

> [!WARNING]
> **使用前請先了解風險**
> - LINE 沒有開放社群給程式操作。本專案透過非官方套件 [linejs](https://github.com/evex-dev/linejs) 登入一個 LINE 帳號，**這違反 LINE 使用條款，該帳號可能被停用**。
> - **一定要另外申請一個機器人專用帳號**，絕對不要用你自己或群主的帳號。
> - 本專案僅供社群管理防詐使用，**使用風險自負**，作者不負任何責任。

## 會處理哪些 QR Code

圖片裡的 QR Code 解出以下連結就處理（[src/qr-policy.ts](src/qr-policy.ts)）：

| 類型 | 例子 |
|---|---|
| LINE 加好友／加群組 | `line.me/ti/...`、`line.me/R/...` |
| LINE 官方帳號短連結 | `lin.ee/...` |
| LINE 小程式 | `liff.line.me/...` |
| Telegram | `t.me/...`、`telegram.me/...` |
| WhatsApp | `wa.me/...`、`chat.whatsapp.com/...` |
| 微信 | 含 `weixin`、`wechat` 的連結 |
| 短網址（常用來藏真正的連結） | `reurl.cc`、`bit.ly`、`tinyurl.com`、`ppt.cc`、`lihi`… |

其他 QR Code（例如一般網站、股票 App 的分享碼）不處理。如果你的社群規定「不准貼任何 QR Code」，可以把 `qrBlockAnyQr` 設成 `true`。

## 安裝

### 0. 準備

- [Node.js](https://nodejs.org) 22.18 以上或 24 LTS
- 一台一直開著的電腦或 VPS。Windows 請到「設定 → 系統 → 電源」，把睡眠設成「永不」。

```bash
git clone <這個 repo 的網址>
cd openchat-guard
npm install
```

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

第一次執行任何指令時，程式會從 `config.example.json` 自動建立你自己的 `config.json`。把要守護的聊天室 ID（`m` 開頭）填進 `config.json` 的 `watchChatMids`：

```json
"watchChatMids": ["m1234abcd..."]
```

要守護好幾個聊天室就填好幾個，用逗號隔開：`["m1234abcd...", "m5678efgh..."]`。機器人在每個聊天室都要是副管理員。

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
🚫 導流 QR｜你的社群｜發文者暱稱｜LINE 加好友／加群連結｜https://line.me/ti/g2/...
  └ 訊息 2 則：已刪除、已刪除｜成員：已封鎖
```

如果封鎖失敗，會改成把對方移出社群（顯示「已移出」）。

每次處理都記在 `data/guard-actions.jsonl`，被判定的圖片存在 `data/guard-images/` 當證據（含成員內容，請定期清理）。

**注意**：同一個機器人帳號同時只能跑一個程式，也不要同時在兩台電腦上跑。

### 讓它一直跑

- **Windows**：點兩下 `start-guard.bat`，程式當掉會自動重啟。是否真的動手一樣由 `dryRun` 決定。要停止就直接關掉這個視窗。
- **VPS（Linux）**：用 [pm2](https://pm2.keymetrics.io) 或 systemd，例如：
  ```bash
  pm2 start npm --name openchat-guard -- run guard
  ```

直接用 `npm run guard` 啟動的，在視窗裡按 `Ctrl+C` 停止，會順便存好讀取進度。下次啟動會補處理停機期間的訊息。

改了 `config.json` 之後要重新啟動才會生效。

### 更新到新版

先停止守衛，然後：

```bash
git pull
npm install
```

你的 `config.json` 和 `data/` 不會被覆蓋，也不用重新登入。

## 設定（config.json）

QR 守衛用到的設定：

| 設定 | 說明 |
|---|---|
| `dryRun` | `true` 只顯示不動手（預設）；`false` 正式刪除和封鎖 |
| `watchChatMids` | 要守護的聊天室 ID，用 `npm run list` 查 |
| `banInsteadOfKick` | `true` 封鎖，對方不能再加入（預設）；`false` 只移出 |
| `hideContentsOnBan` | 封鎖時一併隱藏此人所有歷史訊息（預設 `false`） |
| `whitelistMemberMids` | 永遠不處理的成員 ID（`p` 開頭）。管理員、副管理員已自動排除 |
| `qrBurstWindowSec` | 抓到後一併刪除同一人幾秒內的其他訊息（預設 120） |
| `qrBlockAnyQr` | `true` 任何 QR Code 都處理；`false` 只處理上面列的導流連結（預設） |
| `pollIntervalSec` | 補漏間隔的秒數範圍（預設 `[10, 20]`），見下方「怎麼收到訊息」 |

`config.json` 裡其他設定是實驗性 AI 模式用的，QR 守衛用不到。

## 其他指令

| 指令 | 用途 |
|---|---|
| `npm run watch` | 收訊測試：只接收和記錄訊息，圖片會存檔並掃 QR Code，不刪除、不封鎖。紀錄在 `data/watch-messages.jsonl`、`data/watch-images/`（含成員發言，測完請刪除） |
| `npm run guard:test` | 正式動手但只移出、不封鎖，方便用測試帳號驗證，對方之後還能再加入 |
| `npm run test:image` | QR 辨識測試：用程式產生的刁鑽圖片（角落小 QR、反色、旋轉、模糊、雜訊…），不需要登入 |
| `npx tsx src/test-image.ts <圖片或資料夾>` | 掃描你自己的圖，例如手機截下的廣告圖 |
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

1. 把那張廣告圖存下來，用 `npx tsx src/test-image.ts <圖片>` 掃看看。如果掃不出 QR Code，或連結不在[處理清單](#會處理哪些-qr-code)裡，守衛就不會處理。
2. 確認機器人帳號有開啟這個社群的通知。

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
- **只貼文字或連結的廣告**：QR 守衛只看圖片裡的 QR Code。
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
| `watch-*` | 收訊測試的紀錄與圖片 |

## 授權

[MIT](LICENSE)。本專案與 LINE 公司無關。
