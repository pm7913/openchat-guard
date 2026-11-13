/**
 * 導流連結判斷：QR Code 內容或文字訊息裡的連結，哪些一出現就視為詐騙導流。
 * 純字串比對，不需要網路或 AI。
 */

const BLOCK: [RegExp, string][] = [
  [/(^|\/\/|\.)line\.me\//i, "LINE 加好友／加群連結"],
  [/(^|\/\/)lin\.ee\//i, "LINE 官方帳號短連結"],
  [/liff\.line\.me/i, "LINE 小程式連結"],
  [/^line:\/\//i, "LINE App 連結"],
  [/(^|\/\/)(t|telegram)\.me\//i, "Telegram 連結"],
  [/(^|\/\/)(wa\.me|chat\.whatsapp\.com)\//i, "WhatsApp 連結"],
  [/weixin|wechat|u\.wechat\.com|wxp:\/\//i, "微信連結"],
  [
    /(^|\/\/)(reurl\.cc|bit\.ly|tinyurl\.com|ppt\.cc|pse\.is|lihi\d?\.(cc|com|me)|cutt\.ly|is\.gd|v\.gd|goo\.gl|rebrand\.ly|shorturl\.at|s\.id|t\.ly|url\.kr|gg\.gg|tiny\.cc|ow\.ly|rb\.gy|0rz\.tw|tinyurl\.tw)\//i,
    "短網址（常用來藏真正的連結）",
  ],
];

/**
 * 免費子網域、動態 DNS、臨時通道服務：任何人都能馬上申請一個新網址（例如 okbin.eu.cc），
 * 詐騙集團常拿來架導流頁、換網域繞過封鎖。一般成員幾乎不會分享這類網址。
 */
const FREE_DOMAINS = [
  "eu.cc", "us.kg", "xx.kg", "dpdns.org", "qzz.io", "ggff.net",
  "ddns.net", "duckdns.org", "hopto.org", "zapto.org", "sytes.net",
  "trycloudflare.com", "ngrok-free.app", "ngrok.app", "ngrok.io", "loca.lt",
];

/** 連結或 QR 內容的網域（小寫）。不是網址就回傳空字串。 */
function hostOf(link: string): string {
  const m = link.trim().match(/^(?:[a-z][a-z0-9+.-]*:\/\/)?([^/?#\s:@]+)/i);
  return m ? m[1].toLowerCase().replace(/\.$/, "") : "";
}

/** host 是 domain 本身或它的子網域 */
function isUnder(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** 把使用者填的網域整理成可比對的格式：去掉 http://、路徑、開頭的 *. 或 . */
export function normalizeDomain(input: string): string {
  return hostOf(input.trim().replace(/^\*?\./, ""));
}

export interface PolicyOptions {
  /** true = 任何 QR Code 都視為詐騙（社群規定不准貼 QR 時用）。只用在 QR Code。 */
  blockAnyQr?: boolean;
  /** 自訂要封鎖的網域（含子網域），config.json 的 extraBlockDomains */
  extraDomains?: string[];
}

/** 單一連結或 QR 內容是不是導流 */
function judgeOne(text: string, extraDomains: string[]): string | null {
  const t = text.trim();
  for (const [re, reason] of BLOCK) if (re.test(t)) return reason;
  const host = hostOf(t);
  if (!host || !host.includes(".")) return null;
  for (const d of extraDomains) if (d && isUnder(host, d)) return "自訂封鎖網域";
  for (const d of FREE_DOMAINS) if (isUnder(host, d)) return "免費網域（常用來架導流頁）";
  return null;
}

export interface QrVerdict {
  /** 是否視為詐騙導流 */
  block: boolean;
  /** 命中的原因（給人看的） */
  reason: string;
  /** 觸發的那個 QR 內容 */
  text?: string;
}

/** @param qrTexts 圖片裡解出的所有 QR 內容 */
export function judgeQr(qrTexts: string[], opts: PolicyOptions = {}): QrVerdict {
  const extra = (opts.extraDomains ?? []).map(normalizeDomain);
  for (const text of qrTexts) {
    const reason = judgeOne(text, extra);
    if (reason) return { block: true, reason, text };
  }
  if (qrTexts.length === 0) return { block: false, reason: "沒有 QR Code" };
  if (opts.blockAnyQr) return { block: true, reason: "含 QR Code（設定為一律處理）", text: qrTexts[0] };
  return { block: false, reason: "QR Code 不是已知的導流連結", text: qrTexts[0] };
}

/**
 * 文字裡看起來像連結的片段：有 http(s):// 或 line:// 的，或是沒寫開頭的網域（例如 lin.ee/abc、okbin.eu.cc）。
 * email 的 @ 後面不算。抓到的只拿來比對導流清單，一般網域不會被處理。
 */
const LINK = /(?:https?:\/\/|line:\/\/)\S+|(?<![@\w.-])(?:[a-z0-9-]+\.)+[a-z]{2,}(?![\w-])(?:\/\S*)?/gi;

/** 全形字轉半形、去掉零寬字元，「line。me」這類寫法也還原，避免連結被刻意變形繞過。 */
function normalizeForLinks(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[​-‏⁠-⁯﻿]/g, "")
    .replace(/[。｡]/g, ".");
}

/** 從文字訊息裡找出所有連結。 */
export function extractLinks(text: string): string[] {
  return normalizeForLinks(text).match(LINK) ?? [];
}

/** 文字訊息裡有沒有導流連結。只看已知的導流連結；一般網站（例如新聞）不處理。 */
export function judgeText(text: string, opts: Pick<PolicyOptions, "extraDomains"> = {}): QrVerdict {
  const links = extractLinks(text);
  if (links.length === 0) return { block: false, reason: "沒有連結" };
  const verdict = judgeQr(links, { extraDomains: opts.extraDomains });
  return verdict.block ? verdict : { block: false, reason: "連結不是已知的導流連結", text: links[0] };
}
