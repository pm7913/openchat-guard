/**
 * 導流連結判斷：QR Code 內容或文字訊息裡的連結，哪些一出現就視為詐騙導流。
 * 純字串比對，不需要網路或 AI。
 */
import { compactText, normalizeText } from "./normalize.js";

/**
 * LINE 自家的新聞連結：網域跟 LINE 加好友／小程式連結一樣，但只是新聞文章，不是導流。
 * 先比對這份白名單，命中就不處理。
 *   - today.line.me/...：LINE TODAY 網頁版
 *   - liff.line.me/1454987169-xxxx/...：LINE TODAY 在 App 裡的分享連結（1454987169 是 LINE TODAY 的頻道 ID）
 */
export const LINE_NEWS_LINK = /(?:(?:^|\/\/)today\.line\.me\/|(?:^|\/\/)liff\.line\.me\/1454987169-)\S*/gi;

function isLineNews(link: string): boolean {
  LINE_NEWS_LINK.lastIndex = 0;
  return LINE_NEWS_LINK.test(link.trim());
}

const BLOCK: [RegExp, string][] = [
  [/(^|\/\/|\.)line\.me\//i, "LINE 加好友／加群連結"],
  [/(^|\/\/)lin\.ee\//i, "LINE 官方帳號短連結"],
  [/liff\.line\.me/i, "LINE 小程式連結"],
  [/^line:\/\//i, "LINE App 連結"],
  [/(^|\/\/)(t|telegram)\.me\//i, "Telegram 連結"],
  [/(^|\/\/)(wa\.me|chat\.whatsapp\.com)\//i, "WhatsApp 連結"],
  [/weixin|wechat|u\.wechat\.com|wxp:\/\//i, "微信連結"],
  [
    /(^|\/\/)(reurl\.cc|bit\.ly|tinyurl\.com|ppt\.cc|myppt\.cc|pse\.is|lihi\d?\.(cc|com|me)|cutt\.ly|is\.gd|v\.gd|goo\.gl|rebrand\.ly|shorturl\.at|s\.id|t\.ly|url\.kr|url\.asia|url\.tw|lurl\.cc|risu\.io|supr\.link|ssur\.cc|gg\.gg|tiny\.cc|ow\.ly|rb\.gy|0rz\.tw|tinyurl\.tw)\//i,
    "短網址（常用來藏真正的連結）",
  ],
  [/(^|\/\/)(linktr\.ee|portaly\.cc)\//i, "多連結導流頁（常用來藏 LINE／群組連結）"],
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

/** 常見新聞、股市、影音、社群主站：不是短網址、也不會是導流頁。跳轉追蹤和「要求加 LINE」判斷都略過。 */
export const KNOWN_SITES = [
  "cna.com.tw", "udn.com", "ltn.com.tw", "yahoo.com", "ettoday.net",
  "setn.com", "tvbs.com.tw", "chinatimes.com", "storm.mg", "businessweekly.com.tw",
  "cw.com.tw", "bnext.com.tw", "technews.tw", "moneydj.com", "cnyes.com",
  "anue.com", "wantgoo.com", "cmoney.tw", "goodinfo.tw", "twse.com.tw",
  "tpex.org.tw", "tradingview.com", "investing.com", "youtube.com", "youtu.be",
  "google.com", "wikipedia.org", "github.com", "ptt.cc", "dcard.tw",
  "mobile01.com", "facebook.com", "instagram.com", "threads.net", "threads.com",
  "x.com", "twitter.com",
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
  if (isLineNews(t)) return null;
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

/**
 * 文字明講要人「加 LINE／加賴／加好友」（壓縮後比對，「加 L I N E」「加 賴」也算）。
 * 搭配一條不認識的連結，幾乎就是導流：連結本身常是自架的跳轉頁，網域每次都換，靠清單擋不住。
 */
const ASK_ADD_LINE = /加(入)?(line|好友)|addline|line好友/;

/** 不在已知大站、也不是 LINE 新聞的連結 */
function isUnknownSite(link: string): boolean {
  if (isLineNews(link)) return false;
  const host = hostOf(link);
  if (!host || !host.includes(".")) return false;
  return !KNOWN_SITES.some((d) => isUnder(host, d));
}

/** 文字訊息裡有沒有導流連結。只看已知的導流連結，或「要求加 LINE + 不認識的連結」；一般網站（例如新聞）不處理。 */
export function judgeText(text: string, opts: Pick<PolicyOptions, "extraDomains"> = {}): QrVerdict {
  const links = extractLinks(text);
  if (links.length === 0) return { block: false, reason: "沒有連結" };
  const verdict = judgeQr(links, { extraDomains: opts.extraDomains });
  if (verdict.block) return verdict;
  const unknown = links.find(isUnknownSite);
  if (unknown) {
    const rest = normalizeForLinks(text).replace(LINK, " ");
    if (ASK_ADD_LINE.test(compactText(normalizeText(rest)))) {
      return { block: true, reason: "文字要求加 LINE 並附上不明連結", text: unknown };
    }
  }
  return { block: false, reason: "連結不是已知的導流連結", text: links[0] };
}
