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

export function loadConfig(file = path.join(PROJECT_DIR, "config.json")): GuardConfig {
  // 第一次執行：從範本建立自己的 config.json（config.json 不會上傳到 git）
  const example = path.join(PROJECT_DIR, "config.example.json");
  if (!fs.existsSync(file) && fs.existsSync(example)) {
    fs.copyFileSync(example, file);
    console.log("已從 config.example.json 建立 config.json，之後請改這個檔案。");
  }
  if (!fs.existsSync(file)) return structuredClone(DEFAULTS);
  const user = JSON.parse(fs.readFileSync(file, "utf-8")) as Partial<GuardConfig>;
  return {
    ...DEFAULTS,
    ...user,
    thresholds: { ...DEFAULTS.thresholds, ...(user.thresholds ?? {}) },
  };
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
