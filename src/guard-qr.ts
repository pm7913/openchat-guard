/**
 * QR 守衛：看圖片裡的 QR Code 和文字訊息裡的連結。出現 LINE 加好友／加群、Telegram、
 * WhatsApp、微信、短網址等導流連結，就刪除訊息（含同一人前後一起傳的圖）並封鎖或移出發文者。
 * 純本機判斷，不呼叫 AI。文字只看連結，不判斷內容（blockTextLinks 為 false 時不看文字）。
 *
 *   npm run guard
 *
 * config.json 的 dryRun 為 true 時只顯示「會怎麼處理」，不真的動手。
 * 啟動參數（只影響這次執行，不改 config.json）：
 *   --live   這次正式動手（忽略 dryRun）
 *   --kick   這次只移出、不封鎖（測試帳號之後還能再加入）
 *   npm run guard:live = --live；npm run guard:test = --live --kick
 *   （PowerShell 會吞掉 npm run 後面的 --，所以用專用指令，不要用 npm run guard -- --live）
 * 管理員、副管理員、whitelistMemberMids 永遠不處理。
 * 紀錄：data/guard-actions.jsonl（文字訊息的內容也記在這裡）；被判定的圖存在 data/guard-images/（證據，定期清理）。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { SquareMessage } from "@evex-dev/linejs";
import { appendLog, claimRunLock, DATA_DIR, loadConfig, requireWatchChats, readJson, writeJson } from "./config.js";
import { downloadImage, scanQr } from "./image.js";
import { getChatInfo, isAdminRole, loginSaved, saveAuth } from "./line.js";
import { judgeQr, judgeText, type QrVerdict } from "./qr-policy.js";
import { startReceiver } from "./receiver.js";

const cfg = loadConfig();
const args = process.argv.slice(2);
if (args.includes("--live")) cfg.dryRun = false;
if (args.includes("--kick")) cfg.banInsteadOfKick = false;
requireWatchChats(cfg);
claimRunLock();

const EVIDENCE_DIR = path.join(DATA_DIR, "guard-images");
mkdirSync(EVIDENCE_DIR, { recursive: true });

const ts = () => new Date().toLocaleString("zh-TW", { hour12: false });
const log = (msg: string) => console.log(`[${ts()}] ${msg}`);
const now = () => Date.now();

const state = readJson<{ syncTokens: Record<string, string> }>("guard-state.json", { syncTokens: {} });

const client = await loginSaved();
const sq = client.base.square;
log(`已登入：${client.base.profile?.displayName ?? "(未知)"}`);
log(
  cfg.dryRun
    ? "⚠ 觀察模式（dryRun: true）：只顯示「會怎麼處理」，不會真的刪除或封鎖。"
    : `🛡 正式模式：偵測到導流 QR Code${cfg.blockTextLinks ? "或文字連結" : ""}會刪除訊息並${cfg.banInsteadOfKick ? "封鎖" : "移出"}發文者。`,
);
setInterval(() => saveAuth(client), 30 * 60 * 1000).unref();

// ---------- 聊天室與管理員 ----------

interface Chat {
  mid: string;
  squareMid: string;
  name: string;
  myMemberMid: string;
  protectedMids: Set<string>;
  /** 最近的訊息，用來找出同一人一起傳的其他圖 */
  recent: { id: string; sender: string; at: number }[];
}

const chats = new Map<string, Chat>();

async function refreshAdmins(chat: Chat): Promise<string[]> {
  const mids = new Set<string>([chat.myMemberMid, ...cfg.whitelistMemberMids]);
  const names: string[] = [];
  let token: string | undefined;
  do {
    const r = await sq.searchSquareMembers({
      request: {
        squareMid: chat.squareMid,
        searchOption: { membershipState: "JOINED", memberRoles: ["ADMIN", "CO_ADMIN"], includingMe: true },
        limit: 100,
        continuationToken: token,
      },
    });
    for (const m of r.members) {
      mids.add(m.squareMemberMid);
      if (m.displayName) names.push(m.displayName);
    }
    token = r.continuationToken || undefined;
  } while (token);
  chat.protectedMids = mids;
  return names;
}

for (const mid of cfg.watchChatMids) {
  const info = await getChatInfo(client, mid);
  const chat: Chat = {
    mid,
    squareMid: info.squareMid,
    name: info.name,
    myMemberMid: info.myMemberMid,
    protectedMids: new Set(),
    recent: [],
  };
  const admins = await refreshAdmins(chat);
  chats.set(mid, chat);
  log(`守護「${chat.name}」｜機器人身分：${info.role}｜不處理的管理員 ${admins.length} 位：${admins.join("、")}`);
  if (!isAdminRole(info.role)) log("  ⚠ 機器人不是管理員或副管理員，無法刪除訊息或移出成員。");
  setInterval(() => refreshAdmins(chat).catch((e) => log(`更新管理員名單失敗：${e.message}`)), 30 * 60 * 1000).unref();
}

// ---------- 處理 ----------

/** 已處理的發文者 → 處理時間。之後短時間內補漏才抓到的同一人訊息也一併刪除。 */
const handled = new Map<string, number>();
const deleted = new Set<string>();
const senderNames = new Map<string, string>();
let scanned = 0;
let caught = 0;

async function deleteMessage(chat: Chat, messageId: string): Promise<string> {
  if (deleted.has(messageId)) return "已刪過";
  deleted.add(messageId);
  if (cfg.dryRun) return "會刪除";
  try {
    await sq.destroyMessage({ squareChatMid: chat.mid, messageId });
    return "已刪除";
  } catch (e) {
    deleted.delete(messageId);
    return `刪除失敗：${(e as Error).message}`;
  }
}

async function removeMember(memberMid: string): Promise<string> {
  const verb = cfg.banInsteadOfKick ? "封鎖" : "移出";
  if (cfg.dryRun) return `會${verb}`;
  if (cfg.banInsteadOfKick) {
    try {
      const r = await sq.getSquareMember({ squareMemberMid: memberMid });
      await sq.updateSquareMember({
        request: {
          updatedAttrs: [5], // MEMBERSHIP_STATE
          updatedPreferenceAttrs: [],
          squareMember: { ...r.squareMember, membershipState: "BANNED" },
        },
      });
      if (cfg.hideContentsOnBan) await sq.hideSquareMemberContents({ request: { squareMemberMid: memberMid } });
      return "已封鎖";
    } catch (e) {
      log(`  封鎖失敗（${(e as Error).message}），改用移出`);
    }
  }
  try {
    await sq.deleteOtherFromSquare(memberMid);
    return "已移出";
  } catch (e) {
    return `移出失敗：${(e as Error).message}`;
  }
}

async function inspectImage(chat: Chat, m: SquareMessage, sender: string, name: string): Promise<void> {
  const messageId = String(m.raw.message.id);
  let buf: Buffer;
  try {
    buf = (await downloadImage(m)).buf;
  } catch (e) {
    log(`圖片下載失敗（可能已被刪除）｜${name}｜${(e as Error).message}`);
    return;
  }
  const qr = (await scanQr(buf)).map((q) => q.text);
  scanned++;
  const verdict = judgeQr(qr, { blockAnyQr: cfg.qrBlockAnyQr, extraDomains: cfg.extraBlockDomains });
  if (!verdict.block) {
    if (qr.length) log(`圖片 QR 未處理｜${name}｜${verdict.reason}｜${qr.join("、")}`);
    return;
  }
  await punish(chat, sender, name, messageId, verdict, { image: buf });
}

function inspectText(chat: Chat, text: string, messageId: string, sender: string, name: string): void {
  const verdict = judgeText(text, { extraDomains: cfg.extraBlockDomains });
  if (!verdict.block) return;
  void punish(chat, sender, name, messageId, verdict, { text }).catch((e) =>
    log(`處理文字連結出錯｜${name}｜${(e as Error).message}`),
  );
}

/** 抓到導流：刪除這則和同一人一起傳的訊息，封鎖或移出發文者，留下紀錄。 */
async function punish(
  chat: Chat,
  sender: string,
  name: string,
  messageId: string,
  verdict: QrVerdict,
  source: { image: Buffer } | { text: string },
): Promise<void> {
  const kind = "image" in source ? "QR" : "文字連結";
  // 同一人可能同時傳了好幾則導流訊息，只處理第一次，其他的只刪除
  if (handled.has(sender)) {
    const r = await deleteMessage(chat, messageId);
    log(`  └ 同一人的另一則導流${kind}：${r}`);
    return;
  }
  handled.set(sender, now());
  caught++;

  let evidence: string | undefined;
  if ("image" in source) {
    evidence = path.join(EVIDENCE_DIR, `${new Date().toISOString().replace(/[:.]/g, "-")}_${messageId}.jpg`);
    writeFileSync(evidence, source.image);
  }

  // 這則 + 同一人在時間窗內的其他訊息（一起傳的文字截圖等）
  const windowMs = cfg.qrBurstWindowSec * 1000;
  const targets = new Set([messageId, ...chat.recent.filter((r) => r.sender === sender && now() - r.at <= windowMs).map((r) => r.id)]);
  const results: string[] = [];
  for (const id of targets) results.push(await deleteMessage(chat, id));
  const memberResult = await removeMember(sender);

  log(`🚫 導流${kind}｜${chat.name}｜${name}｜${verdict.reason}｜${verdict.text}`);
  log(`  └ 訊息 ${targets.size} 則：${results.join("、")}｜成員：${memberResult}`);
  appendLog("guard-actions.jsonl", {
    at: new Date().toISOString(),
    dryRun: cfg.dryRun,
    chat: chat.name,
    senderMid: sender,
    senderName: name,
    source: "image" in source ? "image" : "text",
    reason: verdict.reason,
    qr: verdict.text,
    ...("text" in source ? { text: source.text } : {}),
    triggerMessageId: messageId,
    deletedMessageIds: [...targets],
    deleteResults: results,
    memberResult,
    ...(evidence ? { evidence: path.relative(DATA_DIR, evidence) } : {}),
  });
}

const stats = await startReceiver({
  client,
  chatMids: cfg.watchChatMids,
  pollIntervalSec: cfg.pollIntervalSec,
  syncTokens: state.syncTokens,
  onSyncToken: () => writeJson("guard-state.json", state),
  statsEveryMin: 60,
  log,
  onMessage: (chatMid, m, { senderDisplayName }) => {
    const chat = chats.get(chatMid);
    if (!chat) return;
    const raw = m.raw.message;
    const sender = String(raw.from);
    const id = String(raw.id);
    if (senderDisplayName) senderNames.set(sender, senderDisplayName);
    const name = senderDisplayName ?? senderNames.get(sender) ?? `(未知 ${sender.slice(0, 8)})`;

    chat.recent.push({ id, sender, at: now() });
    const cutoff = now() - Math.max(cfg.qrBurstWindowSec, 600) * 1000;
    while (chat.recent.length && chat.recent[0].at < cutoff) chat.recent.shift();

    if (chat.protectedMids.has(sender)) return;

    // 剛處理過的人，補漏晚到的訊息也刪掉
    const t = handled.get(sender);
    if (t && now() - t <= cfg.qrBurstWindowSec * 1000) {
      void deleteMessage(chat, id).then((r) => log(`  └ ${name} 晚到的訊息：${r}`));
      return;
    }

    const contentType = String(raw.contentType);
    if (contentType === "IMAGE") {
      void inspectImage(chat, m, sender, name).catch((e) => log(`檢查圖片出錯｜${name}｜${(e as Error).message}`));
    } else if (cfg.blockTextLinks && (contentType === "NONE" || contentType === "0") && raw.text) {
      inspectText(chat, raw.text, id, sender, name);
    }
  },
});

log(`開始守護。檢查圖片裡的 QR Code${cfg.blockTextLinks ? "和文字訊息裡的導流連結" : ""}。按 Ctrl+C 停止。`);

process.on("SIGINT", () => {
  saveAuth(client);
  writeJson("guard-state.json", state);
  log(`已停止。掃描圖片 ${scanned} 張，抓到導流 ${caught} 次（推播 ${stats.push} 則、補漏 ${stats.poll} 則）。`);
  process.exit(0);
});
