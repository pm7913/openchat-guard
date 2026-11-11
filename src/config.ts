import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** 專案根目錄（src 的上一層）。不管從哪裡執行，資料都存在專案裡。 */
export const PROJECT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DATA_DIR = path.join(PROJECT_DIR, "data");

export interface GuardConfig {
  /** true = 只記錄「會怎麼處理」，不真的刪除或踢人。上線前先觀察幾天。 */
  dryRun: boolean;
  /** Claude 模型 ID。改成 "claude-haiku-5-5" 可大幅降低費用。 */
  model: string;
  /** 要監看的聊天室 ID（squareChatMid，m 開頭）。用 `npm run list` 查。 */
  watchChatMids: string[];
  /** 加入幾天內算「新成員」。 */
  newMemberDays: number;
  /** 依 AI 判斷為詐騙的把握程度（0~1）決定動作。 */
  thresholds: {
    /** 達到就刪除訊息 */
    delete: number;
    /** 達到就把人移出（kick）或封鎖（ban） */
    remove: number;
    /** 新成員的移出門檻（通常比較低） */
    removeNewMember: number;
  };
  /** 移出時改用「封鎖」，對方無法再加入。 */
  banInsteadOfKick: boolean;
  /** 封鎖時一併隱藏此人過去的所有訊息。 */
  hideContentsOnBan: boolean;
  /** 規則分數達到這個值就直接處理，不問 AI（省錢、反應快）。 */
  ruleOnlyScore: number;
  /** 什麼訊息要送給 AI 判斷："suspicious"=有可疑跡象才送；"all"=全部都送（較貴）。 */
  llmGate: "suspicious" | "all";
  /** 文字長度超過這個數，即使沒有可疑跡象也送 AI（抓「假心得」類的長文）。 */
  llmMinLengthForReview: number;
  /** 永遠不處理的成員 ID（squareMemberMid，p 開頭）。管理員與副管理員已自動排除。 */
  whitelistMemberMids: string[];
  /** 社群額外的可疑關鍵字。 */
  extraKeywords: string[];
  /** 社群裡屬於正常話題、不該當誘餌的詞（例如股票社群的「主力」「漲停」）。 */
  ignoreKeywords: string[];
  /** 規則分數達到多少才送 AI（llmGate 為 "suspicious" 時）。 */
  llmScoreGate: number;
  /** 判斷時附上同聊天室最近幾則訊息作為上下文。 */
  contextMessages: number;
  /** 補漏間隔（秒）：每次在 [最短, 最長] 之間隨機，避免固定節奏。主要靠推播即時收訊息。 */
  pollIntervalSec: [number, number];
  /** QR 守衛：判定詐騙後，一併刪除同一人這麼多秒內發的其他訊息（例如一起傳的文字截圖）。 */
  qrBurstWindowSec: number;
  /** QR 守衛：true = 任何 QR Code 都處理；false = 只處理 LINE／Telegram／WhatsApp／微信／短網址。 */
  qrBlockAnyQr: boolean;
}

const DEFAULTS: GuardConfig = {
  dryRun: true,
  model: "claude-opus-5-5",
  watchChatMids: [],
  newMemberDays: 7,
  thresholds: { delete: 0.7, remove: 0.9, removeNewMember: 0.8 },
  banInsteadOfKick: true,
  hideContentsOnBan: false,
  ruleOnlyScore: 0.95,
  llmGate: "suspicious",
  llmMinLengthForReview: 60,
  whitelistMemberMids: [],
  extraKeywords: [],
  ignoreKeywords: [],
  llmScoreGate: 0.2,
  contextMessages: 8,
  pollIntervalSec: [10, 20],
  qrBurstWindowSec: 120,
  qrBlockAnyQr: false,
};

const CONFIG_FILE = path.join(PROJECT_DIR, "config.json");

/** 第一次執行：從範本建立自己的 config.json（config.json 不會上傳到 git）。回傳檔案是否存在。 */
function ensureConfigFile(file: string): boolean {
  const example = path.join(PROJECT_DIR, "config.example.json");
  if (!fs.existsSync(file) && fs.existsSync(example)) {
    fs.copyFileSync(example, file);
    console.log("已從 config.example.json 建立 config.json，之後請改這個檔案。");
  }
  return fs.existsSync(file);
}

/** 讀取設定檔文字。去掉 Windows 記事本、PowerShell 常加在開頭的 BOM，否則 JSON.parse 會失敗。 */
function readConfigText(file: string): string {
  return fs.readFileSync(file, "utf-8").replace(/^﻿/, "");
}

export function loadConfig(file = CONFIG_FILE): GuardConfig {
  if (!ensureConfigFile(file)) return structuredClone(DEFAULTS);
  const user = JSON.parse(readConfigText(file)) as Partial<GuardConfig>;
  return {
    ...DEFAULTS,
    ...user,
    thresholds: { ...DEFAULTS.thresholds, ...(user.thresholds ?? {}) },
  };
}

/**
 * 改寫 config.json 的 watchChatMids。只替換這一段，保留檔案其他部分的排版。
 * 找不到這個設定時，改成整份重新寫入。
 */
export function saveWatchChatMids(mids: string[]): void {
  const raw = ensureConfigFile(CONFIG_FILE) ? readConfigText(CONFIG_FILE) : "{}";
  const pattern = /("watchChatMids"\s*:\s*)\[[^\]]*\]/;
  let next: string;
  if (pattern.test(raw)) {
    const value = `[${mids.map((m) => JSON.stringify(m)).join(", ")}]`;
    next = raw.replace(pattern, (_, key: string) => key + value);
  } else {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    obj.watchChatMids = mids;
    next = JSON.stringify(obj, null, 2) + "\n";
  }
  // 確認改完還是合法的 JSON，而且讀回來的清單真的是新的
  // （檔案裡如果有兩個 watchChatMids，上面只會改到第一個，但讀取時用的是最後一個）
  const saved = (JSON.parse(next) as { watchChatMids?: unknown }).watchChatMids;
  if (!Array.isArray(saved) || saved.length !== mids.length || saved.some((m, i) => m !== mids[i])) {
    throw new Error("config.json 裡的 watchChatMids 沒辦法自動修改（可能寫了不只一次）。請手動整理成只有一個 watchChatMids。");
  }
  // 先寫到暫存檔再換掉原檔，避免其他程式剛好讀到寫一半的檔案
  const tmp = `${CONFIG_FILE}.tmp`;
  fs.writeFileSync(tmp, next, "utf-8");
  fs.renameSync(tmp, CONFIG_FILE);
}

/** 啟動守衛前確認有設定要守護的聊天室，沒有就說明怎麼加入並結束程式。 */
export function requireWatchChats(cfg: GuardConfig): void {
  if (cfg.watchChatMids.length > 0) return;
  console.error("config.json 的 watchChatMids 是空的。請先執行 npm run list 查聊天室 ID，再用 npm run chat:add <聊天室 ID> 加入。");
  process.exit(1);
}

const RUN_LOCK = path.join(DATA_DIR, "running.json");

/**
 * 記下「守衛正在執行」，程式結束時自動清掉。
 * 讓其他指令（例如 chat:add）知道不要同時用同一個帳號登入。
 */
export function claimRunLock(): void {
  ensureDataDir();
  const script = path.basename(process.argv[1] ?? "");
  fs.writeFileSync(RUN_LOCK, JSON.stringify({ pid: process.pid, script, startedAt: new Date().toISOString() }), "utf-8");
  process.on("exit", () => {
    try {
      const lock = JSON.parse(fs.readFileSync(RUN_LOCK, "utf-8")) as { pid?: number };
      if (lock.pid === process.pid) fs.unlinkSync(RUN_LOCK);
    } catch {
      // 檔案已經不在或讀不到，不用處理
    }
  });
}

/** 正在執行的守衛（guard、watch 或 start）。沒有在執行就回傳 null。 */
export function findRunningGuard(): { pid: number; script: string; startedAt: string } | null {
  let lock: { pid: number; script: string; startedAt: string };
  try {
    lock = JSON.parse(fs.readFileSync(RUN_LOCK, "utf-8"));
  } catch {
    return null; // 沒有紀錄
  }
  try {
    process.kill(lock.pid, 0); // 只檢查程式還在不在，不會真的停掉它
    return lock;
  } catch (e) {
    // EPERM：程式還在，只是沒有權限碰它；其他（ESRCH）：程式已經結束，例如直接關掉視窗
    return (e as NodeJS.ErrnoException).code === "EPERM" ? lock : null;
  }
}

export function ensureDataDir(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf-8")) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(file: string, value: unknown): void {
  ensureDataDir();
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(value, null, 2), "utf-8");
}

export function appendLog(file: string, record: unknown): void {
  ensureDataDir();
  fs.appendFileSync(path.join(DATA_DIR, file), JSON.stringify(record) + "\n", "utf-8");
}
