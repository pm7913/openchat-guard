# OpenChat Guard: anti-scam bot for LINE OpenChat

[繁體中文](README.md) | **English**

Watches a LINE OpenChat (社群) community, detects **QR codes in images that lure members to outside chats**, then deletes the ad and bans the poster.

The most common scam in investment and stock communities is a screenshot advertising a "free VIP stock group" or a "teacher" with daily picks, followed by a QR code that adds you to a LINE group. This guard targets exactly that:

- **Runs locally**: QR codes are decoded on your own machine. No AI, no paid API, and images are never sent anywhere else.
- **Reacts in seconds**: ads are usually gone a few seconds after they are posted.
- **Removes the whole post**: other messages the same person sent with the QR code, such as the text screenshot, are deleted too.
- **Never touches admins**: messages from the admin, co-admins and whitelisted members are always skipped.

> [!NOTE]
> The program's console output and the comments in the code are in Traditional Chinese. This README explains what the important messages mean.

> [!WARNING]
> **Understand the risks before using this**
> - LINE has no official API for OpenChat. This project signs in to a LINE account through the unofficial [linejs](https://github.com/evex-dev/linejs) library. **This violates LINE's Terms of Use, and the account may be suspended.**
> - **Always create a dedicated bot account.** Never use your own account or the community owner's account.
> - This project is meant only for protecting communities from scams. **Use it at your own risk**; the authors accept no liability.

## Which QR codes are acted on

A QR code is acted on if it decodes to one of these links (see [src/qr-policy.ts](src/qr-policy.ts)):

| Type | Examples |
|---|---|
| LINE add-friend / join-group | `line.me/ti/...`, `line.me/R/...` |
| LINE Official Account short link | `lin.ee/...` |
| LINE mini app | `liff.line.me/...` |
| Telegram | `t.me/...`, `telegram.me/...` |
| WhatsApp | `wa.me/...`, `chat.whatsapp.com/...` |
| WeChat | links containing `weixin` or `wechat` |
| URL shorteners (often used to hide the real link) | `reurl.cc`, `bit.ly`, `tinyurl.com`, `ppt.cc`, `lihi`… |

Other QR codes, such as ordinary websites or share codes from stock apps, are left alone. If your community bans QR codes entirely, set `qrBlockAnyQr` to `true`.

## Setup

### 0. Requirements

- [Node.js](https://nodejs.org) 22.18 or later, or 24 LTS
- A computer or VPS that stays on. On Windows, go to Settings → System → Power and set sleep to "Never".

```bash
git clone <this repo's URL>
cd openchat-guard
npm install
```

### 1. Prepare a bot account

1. Register a new LINE account with a separate phone number.
2. Join your community with it and **turn on notifications for that community** (needed for real-time messages).
3. From the owner's account, make it a **co-admin** with permission to delete messages and remove members.

### 2. Sign in

```bash
npm run login
```

The QR code is drawn directly in the terminal and also saved as `data/login-qr.png` (opened automatically on Windows). Scan it with LINE on the **bot account's phone** (Home → scan icon at the top right), then enter the verification code shown on screen.

**Signing in on a VPS**: SSH in, run `npm run login`, and scan the QR code straight from the SSH window. It is about 57 columns wide and 29 rows tall. If your phone can't read it, enlarge the window or shrink the font so the whole code fits without wrapping.

Login data is stored in `data/auth.json` and `data/line-storage.json`. **Treat these like a password and never share them.** Later runs reuse them, so you don't need to scan again.

### 3. Choose the chats to guard

```bash
npm run list
```

The first time you run any command, your own `config.json` is created from `config.example.json`. Put the chat IDs to guard (they start with `m`) into `watchChatMids` in `config.json`:

```json
"watchChatMids": ["m1234abcd..."]
```

### 4. Dry run (recommended for a few days)

```bash
npm run guard
```

By default `config.json` has `"dryRun": true`: the guard only prints what it *would* do (會刪除 = would delete, 會封鎖 = would ban) and **does not act**. At startup, check that the bot's role shows `CO_ADMIN` or `ADMIN`, and check the list of admins that will be skipped.

### 5. Go live

Once you're happy with the results, either:

- set `"dryRun"` to `false` in `config.json` and run `npm run guard`, or
- run `npm run guard:live`, which acts for this run only without changing the config file.

When an ad is caught, the console shows:

```
🚫 導流 QR｜your community｜poster's name｜LINE 加好友／加群連結｜https://line.me/ti/g2/...
  └ 訊息 2 則：已刪除、已刪除｜成員：已封鎖
```

That reads: "lure QR | community | poster | LINE add-friend/join-group link | link", then "2 messages: deleted, deleted | member: banned". If banning fails, the guard falls back to removing the member (已移出 = removed).

Every action is logged to `data/guard-actions.jsonl`, and the flagged image is saved to `data/guard-images/` as evidence. These contain member content, so clean them up regularly.

**Note**: run only one program per bot account at a time, and never on two machines at once.

### Keep it running

- **Windows**: double-click `start-guard.bat`. It restarts the guard automatically if it crashes. Whether it actually acts still depends on `dryRun`.
- **VPS (Linux)**: use [pm2](https://pm2.keymetrics.io) or systemd, for example:
  ```bash
  pm2 start npm --name openchat-guard -- run guard
  ```

## Configuration (config.json)

Settings used by the QR guard:

| Setting | Description |
|---|---|
| `dryRun` | `true` only prints what would happen (default); `false` deletes and bans for real |
| `watchChatMids` | Chat IDs to guard; find them with `npm run list` |
| `banInsteadOfKick` | `true` bans, so the person can't rejoin (default); `false` only removes them |
| `hideContentsOnBan` | Also hide all of the person's past messages when banning (default `false`) |
| `whitelistMemberMids` | Member IDs (starting with `p`) that are never acted on. Admins and co-admins are excluded automatically |
| `qrBurstWindowSec` | After a catch, also delete the same person's messages from this many seconds (default 120) |
| `qrBlockAnyQr` | `true` acts on any QR code; `false` only on the lure links listed above (default) |
| `pollIntervalSec` | Range in seconds between catch-up fetches (default `[10, 20]`); see "How messages arrive" below |

The other settings in `config.json` belong to the experimental AI mode and are not used by the QR guard.

## Other commands

| Command | Purpose |
|---|---|
| `npm run watch` | Receive-only test: logs messages, saves images and scans their QR codes, but never deletes or bans. Output goes to `data/watch-messages.jsonl` and `data/watch-images/` (contains member messages; delete after testing) |
| `npm run guard:test` | Acts for real but only removes instead of banning, so a test account can rejoin afterwards |
| `npm run test:image` | QR decoding test using generated tricky images (tiny QR in a corner, inverted, rotated, blurred, noisy…). No sign-in needed |
| `npx tsx src/test-image.ts <image or folder>` | Scan your own images, such as ad screenshots from your phone |

## How it works

### How messages arrive

- **Push (primary)**: a long-lived connection to LINE, the same way the official app works. The server sends new messages as they arrive.
- **Catch-up (backup)**: every 10–20 seconds (randomized), the guard fetches recent events to pick up anything push missed. In testing, push occasionally missed messages and catch-up filled the gap within tens of seconds.
- A message received both ways is handled only once. Every hour the guard reports how many messages came from push and from catch-up, and how many catch-up requests failed.

### How QR codes are decoded

The full-size image is scanned locally with [zxing-wasm](https://github.com/Sec-ant/zxing-wasm), which tries rotation, inversion, downscaling and denoising. Small images are also scanned at 2× size, and [jsQR](https://github.com/cozmo/jsQR) is used as a fallback. The decoder ships with the npm package and is never downloaded at runtime.

## Limitations

- **Private messages**: scammers who message members directly are invisible to the bot. Consider pinning a notice such as "Admins will never message you privately. Anyone inviting you to invest in a private chat is a scammer."
- **Text-only or link-only ads**: the QR guard only looks at QR codes in images.
- **Deliberately damaged or well-hidden QR codes**: if it can't be decoded, it won't be acted on.

## Experimental: AI review of text ads

`npm start` runs a different version that, besides QR codes, uses rules and Claude to judge text ads. It is experimental and has not been validated in a real community the way the QR guard has. It also needs an [Anthropic API key](https://console.anthropic.com), which costs money.

1. Copy `.env.example` to `.env` and fill in `ANTHROPIC_API_KEY`.
2. `npm run test:rules` tests the rules only (free); `npm run test:ai` tests rules plus AI (small cost). Sample messages are in `samples/`.
3. Related settings: `model`, `thresholds`, `newMemberDays`, `ruleOnlyScore`, `llmGate`, `llmScoreGate`, `llmMinLengthForReview`, `extraKeywords`, `ignoreKeywords`, `contextMessages`. See [src/config.ts](src/config.ts) for details.

## Where data is stored

Everything is stored in the project's `data/` folder, which is excluded from git:

| File | Contents |
|---|---|
| `auth.json`, `line-storage.json` | Bot account login data. **Treat like a password; never share** |
| `guard-actions.jsonl`, `guard-images/` | QR guard action log and evidence images |
| `guard-state.json` | Read progress |
| `watch-*` | Receive-only test logs and images |

## License

[MIT](LICENSE). This project is not affiliated with LINE Corporation.
