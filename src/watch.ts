/**
 * 收訊測試：只登入、接收社群訊息、記錄下來。
 * 圖片會下載原圖存到本機，並在本機掃描 QR Code（不需要網路或 AI）。
 * 不呼叫 AI、不判斷、不刪除、不封鎖、不通知、不查成員資料。
 *   npm run watch
 *
 * 紀錄：data/watch-messages.jsonl、data/watch-images/（含成員發言與圖片，測完請刪除）
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { appendLog, DATA_DIR, loadConfig, readJson, writeJson } from "./config.js";
import { downloadImage, scanQr } from "./image.js";
import { loginSaved, saveAuth } from "./line.js";
import { startReceiver } from "./receiver.js";

const STATS_EVERY_MIN = 10;
const IMAGE_DIR = path.join(DATA_DIR, "watch-images");
mkdirSync(IMAGE_DIR, { recursive: true });

const cfg = loadConfig();
if (cfg.watchChatMids.length === 0) {
  console.error("config.json 的 watchChatMids 是空的。請先執行 npm run list，把聊天室 ID 填進去。");
  process.exit(1);
}

const ts = () => new Date().toLocaleString("zh-TW", { hour12: false });
const log = (msg: string) => console.log(`[${ts()}] ${msg}`);

// 測試用獨立的書籤檔，不影響之後正式機器人
const state = readJson<{ syncTokens: Record<string, string> }>("watch-state.json", { syncTokens: {} });

const client = await loginSaved();
log(`已登入：${client.base.profile?.displayName ?? "(未知)"}`);
log("收訊測試模式：只接收並記錄（圖片會存檔並掃 QR Code），不會刪除、封鎖、通知，也不會呼叫 AI。按 Ctrl+C 停止。");
setInterval(() => saveAuth(client), 30 * 60 * 1000).unref();

const names = new Map<string, string>();
for (const mid of cfg.watchChatMids) {
  const chat = await client.getSquareChat(mid);
  const square = await client.base.square.getSquare({ squareMid: chat.raw.squareMid });
  names.set(mid, chat.raw.name);
  log(`監看「${chat.raw.name}」｜機器人身分：${square.myMembership.role}`);
}

let total = 0;
let images = 0;
let imagesWithQr = 0;
let imageFailures = 0;

/** 下載圖片原圖、存檔、掃 QR Code，結果寫進紀錄。只在本機處理。 */
async function inspectImage(
  m: Parameters<typeof downloadImage>[0],
  chatName: string | undefined,
  messageId: string,
  createdMs: number,
  sender: string,
) {
  const stamp = new Date(createdMs || Date.now()).toISOString().replace(/[:.]/g, "-");
  let step = "下載";
  try {
    const { buf, preview } = await downloadImage(m);
    const file = path.join(IMAGE_DIR, `${stamp}_${messageId}.jpg`);
    writeFileSync(file, buf);
    step = "掃描";
    const qr = await scanQr(buf);
    images++;
    if (qr.length) imagesWithQr++;
    log(
      `  └ 圖片已存${preview ? "（只拿到縮圖）" : ""}｜${sender}｜QR：${qr.length ? qr.map((q) => q.text).join("、") : "無"}`,
    );
    appendLog("watch-messages.jsonl", {
      receivedAt: new Date().toISOString(),
      event: "image",
      chat: chatName,
      messageId,
      file: path.relative(DATA_DIR, file),
      bytes: buf.length,
      preview,
      qr: qr.map((q) => q.text),
    });
  } catch (e) {
    imageFailures++;
    log(`  └ 圖片${step}失敗${step === "下載" ? "（可能已被刪除）" : ""}｜${sender}｜${(e as Error).message}`);
    appendLog("watch-messages.jsonl", { receivedAt: new Date().toISOString(), event: "image-failed", step, chat: chatName, messageId, error: (e as Error).message });
  }
}
const started = Date.now();
// 補漏抓到的訊息不帶暱稱：用同一個成員 ID 之前出現過的暱稱補上
const senderNames = new Map<string, string>();

await startReceiver({
  client,
  chatMids: cfg.watchChatMids,
  pollIntervalSec: cfg.pollIntervalSec,
  syncTokens: state.syncTokens,
  onSyncToken: () => writeJson("watch-state.json", state),
  statsEveryMin: STATS_EVERY_MIN,
  log,
  onMessage: (chatMid, m, { via, senderDisplayName }) => {
    total++;
    const raw = m.raw.message;
    const createdMs = Number(raw.createdTime ?? 0);
    const delaySec = createdMs ? (Date.now() - createdMs) / 1000 : null;
    const contentType = String(raw.contentType ?? "NONE");
    const text = raw.text ?? "";
    if (senderDisplayName) senderNames.set(raw.from, senderDisplayName);
    const sender = senderDisplayName ?? senderNames.get(raw.from) ?? `(未知 ${String(raw.from).slice(0, 8)})`;
    const preview = text ? text.replace(/\s+/g, " ").slice(0, 40) : `[${contentType}]`;
    log(
      `${via === "push" ? "推播" : "補漏"}｜${names.get(chatMid)}｜${sender}｜` +
        `延遲 ${delaySec === null ? "?" : delaySec.toFixed(1)} 秒｜${preview}`,
    );
    appendLog("watch-messages.jsonl", {
      receivedAt: new Date().toISOString(),
      via,
      delaySec,
      chat: names.get(chatMid),
      squareChatMid: chatMid,
      messageId: raw.id,
      createdAt: createdMs ? new Date(createdMs).toISOString() : null,
      senderMid: raw.from,
      senderDisplayName: senderDisplayName ?? senderNames.get(raw.from) ?? null,
      contentType,
      text,
      // 圖片的附加資訊（例如一次傳多張時的分組編號），用來研究「同一則多張圖」
      ...(contentType === "IMAGE" ? { meta: raw.contentMetadata } : {}),
    });
    if (contentType === "IMAGE") {
      void inspectImage(m, names.get(chatMid), raw.id, createdMs, sender);
    }
  },
  onJoin: (chatMid, member) => {
    log(`新成員加入｜${names.get(chatMid)}｜${member.displayName}`);
    appendLog("watch-messages.jsonl", { receivedAt: new Date().toISOString(), event: "join", chat: names.get(chatMid), memberMid: member.squareMemberMid, displayName: member.displayName });
  },
  onProfileUpdate: (chatMid, member) => {
    log(`成員改暱稱｜${names.get(chatMid)}｜${member.displayName}`);
    appendLog("watch-messages.jsonl", { receivedAt: new Date().toISOString(), event: "profile", chat: names.get(chatMid), memberMid: member.squareMemberMid, displayName: member.displayName });
  },
});

log(`開始接收。每 ${STATS_EVERY_MIN} 分鐘回報一次推播／補漏統計。`);

process.on("SIGINT", () => {
  saveAuth(client);
  writeJson("watch-state.json", state);
  const mins = ((Date.now() - started) / 60000).toFixed(0);
  log(`已停止。共跑 ${mins} 分鐘，收到 ${total} 則訊息；圖片 ${images} 張（含 QR ${imagesWithQr} 張、失敗 ${imageFailures} 張）。紀錄在 data/watch-messages.jsonl、data/watch-images/`);
  process.exit(0);
});
