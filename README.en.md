# OpenChat Guard: anti-scam bot for LINE OpenChat

[繁體中文](README.md) | **English**

Watches a LINE OpenChat (社群) community, detects **QR codes in images and links in text messages that lure members to outside chats**, then deletes the ad and bans the poster.

The most common scam in investment and stock communities is a screenshot advertising a "free VIP stock group" or a "teacher" with daily picks, followed by a QR code that adds you to a LINE group, or simply a short link or group-invite link posted as text. This guard targets exactly that:

- **Runs locally**: QR codes are decoded and links are matched on your own machine. No AI, no paid API, images are never sent anywhere else, and suspicious links are never opened.
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

## Which links are acted on

A QR code that decodes to one of these links, or a text message containing one, is acted on (see [src/qr-policy.ts](src/qr-policy.ts)):

| Type | Examples |
|---|---|
| LINE add-friend / join-group | `line.me/ti/...`, `line.me/R/...` |
| LINE Official Account short link | `lin.ee/...` |
| LINE mini app | `liff.line.me/...` |
| Telegram | `t.me/...`, `telegram.me/...` |
| WhatsApp | `wa.me/...`, `chat.whatsapp.com/...` |
| WeChat | links containing `weixin` or `wechat` |
| URL shorteners (often used to hide the real link) | `reurl.cc`, `bit.ly`, `tinyurl.com`, `ppt.cc`, `url.kr`, `lihi`… |
| Free domains (anyone can get one instantly; often used for lure pages) | `xxx.eu.cc`, `xxx.us.kg`, `xxx.duckdns.org`, `xxx.trycloudflare.com`… |
| Domains you add yourself | `extraBlockDomains` in `config.json`; see below |

Other links and QR codes, such as news sites, Yahoo Finance, YouTube or share codes from stock apps, are left alone. If your community bans QR codes entirely, set `qrBlockAnyQr` to `true`.

Text links are recognized even when disguised: full-width characters (`ｌｉｎ．ｅｅ`), an ideographic full stop instead of a dot (`lin。ee`), or zero-width characters in between.

### When a new lure domain shows up

Scammers keep switching domains. When you see a lure link the list doesn't cover, add its domain to `extraBlockDomains` in `config.json` and restart the guard:

```json
"extraBlockDomains": ["okbin.eu.cc", "scam-site.com"]
```

- Just the domain is enough; `https://` and paths are optional. Subdomains are included, so `scam-site.com` also covers `www.scam-site.com`.
- Applies to both QR codes and text links.
- Messages already posted aren't revisited; it only affects new messages.

## Setup

### 0. Requirements

- [Node.js](https://nodejs.org) 26 LTS (recommended), or 24.11+, or 22.18+ on the 22 line (required by the linejs sign-in library). The project's `.nvmrc` says 26, so tools like fnm and nvm can switch to it directly
- A computer or VPS that stays on. On Windows, go to Settings → System → Power and set sleep to "Never".

```bash
git clone https://github.com/pm7913/openchat-guard.git
cd openchat-guard
npm ci
```

`npm ci` installs the exact package versions from `package-lock.json`. If your Node version doesn't match, it stops with an error naming the required version; upgrade Node and run it again.

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

> [!IMPORTANT]
> The guard signs in as "LINE for Windows (desktop)". A LINE account can be signed in to only one desktop client at a time, so **never open LINE desktop with the bot account**. Doing so kicks the guard offline, and you'll have to run `npm run login` again. The phone app is not affected.

### 3. Choose the chats to guard

```bash
npm run list
```

This lists every community the bot has joined, its role in each, and the chat IDs (starting with `m`). Chats already being guarded are marked `✓`.

Add a chat to guard:

```bash
npm run chat:add m0123456789abcdef0123456789abcdef
```

- It signs in to confirm the chat exists and the bot is still in the community, then writes it to `watchChatMids` in `config.json`.
- **Stop the guard before adding**: adding needs to sign in, and the same account can't be signed in by the guard at the same time. If the guard is still running, the command tells you to stop it first.
- If the bot is only a regular member (`MEMBER`) there, the chat is still added, with a warning that the bot can see ads but can't delete them.
- You can add several at once, separated by spaces. IDs already on the list aren't added twice.

To stop guarding a chat:

```bash
npm run chat:remove m0123456789abcdef0123456789abcdef
```

Removing doesn't sign in, so it works while the guard is running, but the guard needs a restart to pick it up. It also removes IDs that were typed in wrong by hand.

You can also edit `config.json` directly. The first time you run any command, your own `config.json` is created from `config.example.json`. Chat IDs go in `watchChatMids`, separated by commas:

```json
"watchChatMids": ["m1234abcd...", "m5678efgh..."]
```

The bot must be a co-admin in every chat it guards.

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
🚫 導流QR｜your community｜poster's name｜LINE 加好友／加群連結｜https://line.me/ti/g2/...
  └ 訊息 2 則：已刪除、已刪除｜成員：已封鎖
```

That reads: "lure QR | community | poster | LINE add-friend/join-group link | link", then "2 messages: deleted, deleted | member: banned". Text links show as 「🚫 導流文字連結」 ("lure text link"). If banning fails, the guard falls back to removing the member (已移出 = removed).

Every action is logged to `data/guard-actions.jsonl` (including the text of flagged text messages), and the flagged image is saved to `data/guard-images/` as evidence. These contain member content, so clean them up regularly.

**Note**: run only one program per bot account at a time, and never on two machines at once.

### Keep it running

- **Windows**: double-click `start-guard.bat`. It restarts the guard automatically if it crashes. Whether it actually acts still depends on `dryRun`. To stop it, close the window.
- **VPS (Linux)**: use [pm2](https://pm2.keymetrics.io) or systemd, for example:
  ```bash
  pm2 start npm --name openchat-guard -- run guard
  ```

If you started it with `npm run guard`, press `Ctrl+C` in that window to stop. The guard saves its read progress on the way out, and the next run catches up on messages posted while it was stopped.

Changes to `config.json` take effect after a restart.

### Updating

Stop the guard, then:

```bash
git pull
npm ci
```

Your `config.json` and `data/` are left alone, and you don't need to sign in again.

## Configuration (config.json)

Settings used by the QR guard:

| Setting | Description |
|---|---|
| `dryRun` | `true` only prints what would happen (default); `false` deletes and bans for real |
| `watchChatMids` | Chat IDs to guard; find them with `npm run list`, change them with `npm run chat:add` / `chat:remove` |
| `banInsteadOfKick` | `true` bans, so the person can't rejoin (default); `false` only removes them |
| `hideContentsOnBan` | Also hide all of the person's past messages when banning (default `false`) |
| `whitelistMemberMids` | Member IDs (starting with `p`) that are never acted on. Admins and co-admins are excluded automatically |
| `qrBurstWindowSec` | After a catch, also delete the same person's messages from this many seconds (default 120) |
| `qrBlockAnyQr` | `true` acts on any QR code; `false` only on the lure links listed above (default) |
| `blockTextLinks` | `true` also acts on lure links in text messages (default); `false` checks images only |
| `extraBlockDomains` | Your own domains to block; see "When a new lure domain shows up" above (default empty) |
| `pollIntervalSec` | Range in seconds between catch-up fetches (default `[10, 20]`); see "How messages arrive" below |

The other settings in `config.json` belong to the experimental AI mode and are not used by the QR guard.

## Other commands

| Command | Purpose |
|---|---|
| `npm run watch` | Receive-only test: logs messages, saves images and scans their QR codes, but never deletes or bans. Output goes to `data/watch-messages.jsonl` and `data/watch-images/` (contains member messages; delete after testing) |
| `npm run guard:test` | Acts for real but only removes instead of banning, so a test account can rejoin afterwards |
| `npm run test:image` | QR decoding test using generated tricky images (tiny QR in a corner, inverted, rotated, blurred, noisy…). No sign-in needed |
| `npx tsx src/test-image.ts <image or folder>` | Scan your own images, such as ad screenshots from your phone |
| `npm run test:links` | Text link test: which texts count as lure links. No sign-in needed |
| `npm run probe` | Diagnostics: checks which OpenChat features work for the signed-in account. Read-only; changes nothing |
| `npm run typecheck` | For development: checks TypeScript types |

## Troubleshooting

**At startup: 「還沒登入。請先執行：npm run login」 ("Not signed in. Run npm run login first")**

You haven't signed in yet, or `data/auth.json` is missing. Run `npm run login`.

**The guard exits with an error at startup, or keeps printing 「補漏失敗」 ("catch-up failed"), or the hourly report shows 0 push messages**

The login has usually expired: someone opened LINE desktop with the bot account and kicked it offline, or the account was signed out or suspended. Stop the guard, run `npm run login`, and start it again.

With `start-guard.bat`, an expired login makes it restart every 10 seconds and fail every time. If you see that, close the window, sign in again, then reopen it.

**At startup: 「⚠ 機器人不是管理員或副管理員」 ("the bot is not an admin or co-admin")**

The bot can't delete anything, even when it catches an ad. From the owner's account, make it a co-admin with permission to delete messages and remove members, then restart.

**An ad wasn't deleted**

1. Image ads: save the image and scan it with `npx tsx src/test-image.ts <image>`. If no QR code is found, the guard won't act on it.
2. The link isn't in the [list above](#which-links-are-acted-on): add its domain to `extraBlockDomains` (see "When a new lure domain shows up"). Delete the earlier message yourself in LINE.
3. Check that the bot account has notifications turned on for the community.

**A legitimate member's message was deleted**

Add that member's ID (starts with `p`; it's the `senderMid` in that entry of `data/guard-actions.jsonl`) to `whitelistMemberMids` and restart. If you turned on `qrBlockAnyQr`, consider setting it back to `false`.

## How it works

### How messages arrive

- **Push (primary)**: a long-lived connection to LINE, the same way the official app works. The server sends new messages as they arrive.
- **Catch-up (backup)**: every 10–20 seconds (randomized), the guard fetches recent events to pick up anything push missed. In testing, push occasionally missed messages and catch-up filled the gap within tens of seconds.
- A message received both ways is handled only once. Every hour the guard reports how many messages came from push and from catch-up, and how many catch-up requests failed.

### How QR codes are decoded

The full-size image is scanned locally with [zxing-wasm](https://github.com/Sec-ant/zxing-wasm), which tries rotation, inversion, downscaling and denoising. Small images are also scanned at 2× size, and [jsQR](https://github.com/cozmo/jsQR) is used as a fallback. The decoder ships with the npm package and is never downloaded at runtime.

## Limitations

- **Private messages**: scammers who message members directly are invisible to the bot. Consider pinning a notice such as "Admins will never message you privately. Anyone inviting you to invest in a private chat is a scammer."
- **Text ads without a link**: for example "add my LINE abc8899" or "DM me for details". The guard only recognizes links; it doesn't judge what the text says.
- **New lure domains**: a domain that isn't on the list gets through the first time; add it to `extraBlockDomains` yourself.
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
| `running.json` | Marks that the guard is running so `chat:add` can tell; removed automatically when the guard exits |
| `watch-*` | Receive-only test logs and images |

## License

[MIT](LICENSE). This project is not affiliated with LINE Corporation.
