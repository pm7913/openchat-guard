/**
 * 社群守衛主程式：監看聊天室、判斷詐騙、刪除與移出。
 *   npm start
 */
import crypto from "node:crypto";
import type { Client, SquareMessage } from "@evex-dev/linejs";
import { ScamClassifier } from "./classifier.js";
import { appendLog, claimRunLock, loadConfig, requireWatchChats, readJson, writeJson, type GuardConfig } from "./config.js";
import { decide, type Decision } from "./engine.js";
import { downloadImage, prepareImage } from "./image.js";
import { getChatInfo, isAdminRole, loginSaved, saveAuth } from "./line.js";
import { compactText, normalizeText } from "./normalize.js";
import { startReceiver } from "./receiver.js";
import { evaluateRules } from "./rules.js";

interface State {
  syncTokens: Record<string, string>;
  /** 接收通知的對象：使用者 mid（u 開頭）或社群聊天室 mid（m 開頭） */
  notifyTo?: string;
}

interface MemberInfo {
  displayName: string;
  role: string;
  joinedAtMs: number | null;
  fetchedAt: number;
}

interface WatchedChat {
  squareChatMid: string;
  squareMid: string;
  name: string;
  myMemberMid: string;
  adminMids: Set<string>;
  adminNames: string[];
  context: { name: string; text: string }[];
  queue: Promise<void>;
}

const cfg: GuardConfig = loadConfig();
const state = readJson<State>("state.json", { syncTokens: {} });
const saveState = () => writeJson("state.json", state);

const now = () => Date.now();
const ts = () => new Date().toLocaleString("zh-TW", { hour12: false });

function log(msg: string): void {
  console.log(`[${ts()}] ${msg}`);
}

// ---------- 啟動 ----------

requireWatchChats(cfg);
claimRunLock();

const client: Client = await loginSaved();
const sq = client.base.square;
log(`已登入：${client.base.profile?.displayName ?? "(未知)"}`);
setInterval(() => saveAuth(client), 30 * 60 * 1000).unref();

let classifier: ScamClassifier | null = null;
try {
  classifier = new ScamClassifier(cfg.model);
  log(`AI 判斷：${cfg.model}`);
} catch (e) {
  log(`⚠ 無法啟用 AI（${(e as Error).message}），只用規則判斷，且只通知不自動處理。`);
}
log(cfg.dryRun ? "模式：觀察（dryRun）— 只記錄，不會真的刪除或移出" : "模式：正式 — 會自動刪除與移出");

// ---------- 成員資料快取 ----------

const memberCache = new Map<string, MemberInfo>();
async function getMember(mid: string): Promise<MemberInfo | null> {
  const cached = memberCache.get(mid);
  if (cached && now() - cached.fetchedAt < 10 * 60 * 1000) return cached;
  try {
    const r = await sq.getSquareMember({ squareMemberMid: mid });
    const m = r.squareMember;
    const info: MemberInfo = {
      displayName: m.displayName ?? "",
      role: String(m.role ?? "MEMBER"),
      joinedAtMs: m.createdAt ? Number(m.createdAt) : null,
      fetchedAt: now(),
    };
    memberCache.set(mid, info);
    return info;
  } catch (e) {
    log(`讀取成員 ${mid} 失敗：${(e as Error).message}`);
    return null;
  }
}

async function refreshAdmins(chat: WatchedChat): Promise<void> {
  const mids = new Set<string>();
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
  mids.add(chat.myMemberMid);
  chat.adminMids = mids;
  chat.adminNames = names;
}

// ---------- 重複內容偵測（多帳號洗同一段廣告） ----------

const recentContent = new Map<string, Map<string, number>>();
function trackDuplicate(text: string, senderMid: string): number {
  const key = compactText(normalizeText(text));
  if (key.length < 10) return 1;
  const h = crypto.createHash("sha1").update(key).digest("hex");
  const senders = recentContent.get(h) ?? new Map<string, number>();
  senders.set(senderMid, now());
  for (const [mid, t] of senders) if (now() - t > 24 * 3600 * 1000) senders.delete(mid);
  recentContent.set(h, senders);
  return senders.size;
}

// ---------- 執行處理 ----------

const removedMembers = new Set<string>();

async function notify(text: string): Promise<void> {
  const to = state.notifyTo;
  if (!to) return;
  try {
    if (to.startsWith("m")) {
      await sq.sendMessage({ squareChatMid: to, text });
    } else {
      try {
        await client.base.talk.sendMessage({ to, text, e2ee: true });
      } catch {
        await client.base.talk.sendMessage({ to, text });
      }
    }
  } catch (e) {
    log(`通知傳送失敗：${(e as Error).message}`);
  }
}

async function removeMember(memberMid: string): Promise<string> {
  if (cfg.banInsteadOfKick) {
    const r = await sq.getSquareMember({ squareMemberMid: memberMid });
    await sq.updateSquareMember({
      request: {
        updatedAttrs: [5], // MEMBERSHIP_STATE
        updatedPreferenceAttrs: [],
        squareMember: { ...r.squareMember, membershipState: "BANNED" },
      },
    });
    if (cfg.hideContentsOnBan) {
      await sq.hideSquareMemberContents({ request: { squareMemberMid: memberMid } });
    }
    return "封鎖";
  }
  await sq.deleteOtherFromSquare(memberMid);
  return "移出";
}

async function act(
  chat: WatchedChat,
  d: Decision,
  target: { memberMid: string; displayName: string; messageId?: string; preview: string },
): Promise<string[]> {
  const done: string[] = [];
  if (!cfg.dryRun) {
    if (d.actions.includes("delete") && target.messageId) {
      try {
        await sq.destroyMessage({ messageId: target.messageId, squareChatMid: chat.squareChatMid });
        done.push("已刪除訊息");
      } catch (e) {
        done.push(`刪除失敗：${(e as Error).message}`);
      }
    }
    if (d.actions.includes("remove") && !removedMembers.has(target.memberMid)) {
      try {
        done.push(`已${await removeMember(target.memberMid)}成員`);
        removedMembers.add(target.memberMid);
      } catch (e) {
        done.push(`移出失敗：${(e as Error).message}`);
      }
    }
  } else {
    const wouldDo = d.actions.filter((a) => a !== "notify").map((a) => (a === "delete" ? "刪除" : cfg.banInsteadOfKick ? "封鎖" : "移出"));
    if (wouldDo.length) done.push(`（觀察模式）會${wouldDo.join("並")}`);
  }

  if (d.actions.includes("notify")) {
    const label = d.verdict === "scam" ? "🚫 詐騙" : "⚠ 可疑";
    await notify(
      `${label}｜${chat.name}\n` +
        `成員：${target.displayName}\n` +
        `內容：${target.preview.slice(0, 120)}\n` +
        `判斷：${d.tactic}（把握 ${(d.confidence * 100).toFixed(0)}%）\n` +
        `理由：${d.reason.slice(0, 150)}\n` +
        `處理：${done.join("、") || "未自動處理，請人工確認"}`,
    );
  }
  return done;
}

// ---------- 訊息處理 ----------

async function handleMessage(chat: WatchedChat, m: SquareMessage): Promise<void> {
  const raw = m.raw.message;
  const senderMid = raw.from;
  const contentType = String(raw.contentType ?? "NONE");
  let text = raw.text ?? "";
  if (contentType === "CONTACT") text = `[分享聯絡人] ${raw.contentMetadata?.displayName ?? ""} ${text}`.trim();

  if (!senderMid || senderMid === chat.myMemberMid || chat.adminMids.has(senderMid)) {
    pushContext(chat, "管理員", text);
    return;
  }
  if (cfg.whitelistMemberMids.includes(senderMid) || removedMembers.has(senderMid)) return;
  if (!text && contentType !== "IMAGE") return; // 貼圖、表情等略過

  const member = await getMember(senderMid);
  if (member && isAdminRole(member.role)) {
    chat.adminMids.add(senderMid);
    return;
  }
  const displayName = member?.displayName ?? "(未知)";
  const memberDays = member?.joinedAtMs ? (now() - member.joinedAtMs) / 86400000 : null;

  let qrTexts: string[] = [];
  let imageJpegBase64: string | undefined;
  if (contentType === "IMAGE") {
    try {
      const { buf } = await downloadImage(m);
      const prepared = await prepareImage(buf);
      qrTexts = prepared.qrTexts;
      imageJpegBase64 = prepared.jpegBase64;
    } catch (e) {
      log(`下載圖片失敗：${(e as Error).message}`);
    }
  }

  const d = await decide(
    {
      text,
      contentType,
      displayName,
      memberDays,
      duplicateSenders: text ? trackDuplicate(text, senderMid) : 1,
      qrTexts,
      imageJpegBase64,
      context: chat.context.slice(-cfg.contextMessages),
    },
    cfg,
    chat.adminNames,
    classifier,
  );
  pushContext(chat, displayName, text || "[圖片]");
  if (d.source === "skipped" || d.verdict === "ok") return;

  const preview = text || `[圖片]${qrTexts.length ? ` QR：${qrTexts.join(" ")}` : ""}`;
  const done = await act(chat, d, { memberMid: senderMid, displayName, messageId: raw.id, preview });
  log(`${d.verdict === "scam" ? "🚫" : "⚠"} ${chat.name}｜${displayName}｜${d.tactic} ${(d.confidence * 100).toFixed(0)}%｜${done.join("、") || "通知"}｜${preview.slice(0, 50)}`);
  appendLog("actions.jsonl", {
    time: new Date().toISOString(),
    chat: chat.name,
    squareChatMid: chat.squareChatMid,
    memberMid: senderMid,
    displayName,
    memberDays,
    messageId: raw.id,
    contentType,
    text,
    qrTexts,
    decision: { ...d },
    done,
    dryRun: cfg.dryRun,
  });
}

/** 新成員加入或改暱稱：只看暱稱（假冒管理員、暱稱導流） */
async function checkName(chat: WatchedChat, memberMid: string, displayName: string, why: string): Promise<void> {
  if (!memberMid || chat.adminMids.has(memberMid) || cfg.whitelistMemberMids.includes(memberMid)) return;
  const r = evaluateRules({
    text: "",
    contentType: "NONE",
    qrTexts: [],
    displayName,
    memberDays: 0,
    newMemberDays: cfg.newMemberDays,
    adminNames: chat.adminNames,
    duplicateSenders: 1,
    extraKeywords: [],
    ignoreKeywords: cfg.ignoreKeywords,
  });
  if (r.score < 0.3) return;
  const d: Decision = {
    verdict: r.score >= 0.8 ? "scam" : "suspicious",
    confidence: r.score,
    actions: r.score >= 0.8 ? ["remove", "notify"] : ["notify"],
    tactic: "可疑暱稱",
    reason: r.signals.join("；"),
    signals: r.signals,
    ruleScore: r.score,
    source: "rules",
    isNewMember: true,
  };
  const done = await act(chat, d, { memberMid, displayName, preview: `（${why}）暱稱：${displayName}` });
  log(`⚠ ${chat.name}｜${why}：${displayName}｜${r.signals.join("；")}｜${done.join("、") || "通知"}`);
  appendLog("actions.jsonl", { time: new Date().toISOString(), chat: chat.name, memberMid, displayName, why, decision: d, done, dryRun: cfg.dryRun });
}

function pushContext(chat: WatchedChat, name: string, text: string): void {
  if (!text) return;
  chat.context.push({ name, text: text.slice(0, 300) });
  if (chat.context.length > 30) chat.context.splice(0, chat.context.length - 30);
}

// ---------- 綁定通知對象（用手機私訊機器人帳號） ----------

const bindCode = String(crypto.randomInt(100000, 999999));
if (!state.notifyTo) {
  log(`尚未設定通知對象。請用你自己的 LINE 加機器人帳號好友，私訊它：綁定 ${bindCode}`);
}
client.on("message", async (msg) => {
  try {
    const text = (msg.text ?? "").trim();
    if (text === `綁定 ${bindCode}` && !state.notifyTo) {
      state.notifyTo = msg.from.id;
      saveState();
      await msg.reply("已綁定，之後偵測到詐騙會通知你。");
      log(`通知對象已綁定：${msg.from.id}`);
    }
  } catch (e) {
    log(`處理私訊失敗：${(e as Error).message}`);
  }
});
// ---------- 開始監看 ----------

const watched = new Map<string, WatchedChat>();

for (const squareChatMid of cfg.watchChatMids) {
  const info = await getChatInfo(client, squareChatMid);
  const chat: WatchedChat = {
    squareChatMid,
    squareMid: info.squareMid,
    name: info.name,
    myMemberMid: info.myMemberMid,
    adminMids: new Set(),
    adminNames: [],
    context: [],
    queue: Promise.resolve(),
  };
  if (!isAdminRole(info.role)) {
    log(`⚠ 機器人在「${chat.name}」的身分是 ${info.role}，不是管理員或副管理員，無法刪除訊息或移出成員。`);
  }
  await refreshAdmins(chat);
  setInterval(() => refreshAdmins(chat).catch((e) => log(`更新管理員名單失敗：${e.message}`)), 60 * 60 * 1000).unref();
  watched.set(squareChatMid, chat);
  log(`開始監看「${chat.name}」（管理員 ${chat.adminNames.length} 位：${chat.adminNames.join("、")}）`);
}

function enqueue(chat: WatchedChat, job: () => Promise<void>): void {
  chat.queue = chat.queue.then(job).catch((e) => log(`處理失敗：${(e as Error).message}`));
}

await startReceiver({
  client,
  chatMids: [...watched.keys()],
  pollIntervalSec: cfg.pollIntervalSec,
  syncTokens: state.syncTokens,
  onSyncToken: () => saveState(),
  listenTalk: true,
  log,
  onMessage: (chatMid, m) => {
    const chat = watched.get(chatMid);
    if (chat) enqueue(chat, () => handleMessage(chat, m));
  },
  onJoin: (chatMid, member) => {
    const chat = watched.get(chatMid);
    if (chat) enqueue(chat, () => checkName(chat, member.squareMemberMid, member.displayName, "新成員加入"));
  },
  onProfileUpdate: (chatMid, member) => {
    const chat = watched.get(chatMid);
    memberCache.delete(member.squareMemberMid);
    if (chat) enqueue(chat, () => checkName(chat, member.squareMemberMid, member.displayName, "成員改暱稱"));
  },
});


process.on("SIGINT", () => {
  saveAuth(client);
  saveState();
  log("已停止。");
  process.exit(0);
});
