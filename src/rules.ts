import { compactText, nameKey, normalizeText, similarity } from "./normalize.js";

export interface RuleInput {
  text: string;
  /** IMAGE / CONTACT / NONE(純文字) / STICKER ... */
  contentType: string;
  /** 從圖片 QR Code 解出的內容 */
  qrTexts: string[];
  displayName: string;
  /** 加入社群幾天，未知則為 null */
  memberDays: number | null;
  newMemberDays: number;
  /** 管理員、副管理員的暱稱 */
  adminNames: string[];
  /** 同一段內容最近被幾個「不同成員」發過（含本次） */
  duplicateSenders: number;
  extraKeywords: string[];
  /** 社群裡屬於正常話題、不該當誘餌的詞（例如股票社群的「主力」「漲停」） */
  ignoreKeywords: string[];
}

export interface RuleResult {
  score: number;
  signals: string[];
  normalized: string;
  compact: string;
  isNewMember: boolean;
  hasUrl: boolean;
}

const LINE_INVITE = /(line\.me\/(ti|r)\/|lin\.ee\/|line:\/\/|liff\.line\.me|line\.me\/[a-z]{1,3}\/[a-z]{1,3}\/)/;
const URL = /(https?:\/\/|www\.|\b[a-z0-9-]{2,}\.(com|net|org|cc|top|xyz|vip|me|io|ly|gl|link|shop|club|site|online|tw|hk|info|app|pro|live)\b)/;
const SHORTENER = /(bit\.ly|reurl\.cc|tinyurl|ppt\.cc|lihi\d?\.(cc|com|me)|pse\.is|t\.ly|is\.gd|shorturl|risu\.io|cutt\.ly|rb\.gy|t\.co\/|goo\.su|s\.id\/|lnk\.to|linktr\.ee|bio\.link|beacons\.ai)/;
const LINE_ID = /(line\s*id|id\s*[:：]|搜尋\s*id|加\s*id|@[a-z0-9._-]{4,})/;

// 以下比對「壓縮後」文字（已去空白標點、諧音已還原）
const PRIVATE_CONTACT = /(加(我|line|好友|老師|助理|官方|wechat|telegram)|私訊|line(id|帳號|帐号|搜尋|搜索)|找(老師|助理)|聯繫(老師|助理|我)|联系(老师|助理|我)|點(我|頭像|头像)|看(我|頭像|头像|簡介|简介)|頭像(加|聯繫)|主頁|簡介有)/;
const INVEST_BAIT = [
  "飆股", "穩賺", "保本", "保證獲利", "保证获利", "內線", "帶單", "老師", "助理", "股票群", "投資群", "投资群",
  "免費領", "免费领", "會員群", "vip群", "明牌", "主力", "漲停", "涨停", "翻倍", "月入", "日賺", "日赚", "被動收入",
  "被动收入", "虛擬貨幣", "虚拟货币", "usdt", "泰達幣", "博弈", "百家樂", "娛樂城", "兼職", "兼职", "打字員", "刷單",
  "點讚賺", "在家工作", "高報酬", "高回报", "名額有限", "名额有限", "限時", "免費體驗", "免费体验", "操盤", "操盘",
  "分析師", "分析师", "財富自由", "财富自由", "賺錢", "赚钱", "獲利", "获利", "報牌", "报牌", "領取", "领取",
  "飆漲", "飙涨", "抄底", "外匯", "外汇", "期貨", "期货", "代操", "跟投", "收益", "免費進", "免费进", "拉你進",
  "拉你进", "進群", "进群",
];
/** 「LINE／微信／TG」後面接一串含 3 個以上數字的帳號，例：wechatkk8877、lineidking168 */
const APP_ACCOUNT = /(line|wechat|telegram|whatsapp)(id)?[a-z0-9_]*\d{3,}/;
const OFFICIAL_IMPERSONATION = /(管理員|管理员|版主|群主|官方|客服|公告|小編|小编)/;

const EVASION_CHARS =
  /[​-‏‪-‮⁠-⁯﻿­͏ㅤﾠ０-９Ａ-Ｚａ-ｚ①-⓿Ѐ-ӿͰ-Ͽ]|[\u{1D400}-\u{1D7FF}\u{1F130}-\u{1F189}]/gu;

function countEvasionChars(text: string): number {
  return (text?.match(EVASION_CHARS) ?? []).length;
}

export function evaluateRules(input: RuleInput): RuleResult {
  const normalized = normalizeText(input.text);
  const compact = compactText(normalized);
  const signals: string[] = [];
  let score = 0;
  const add = (points: number, signal: string) => {
    score += points;
    signals.push(signal);
  };

  const qrJoined = input.qrTexts.map(normalizeText).join(" ");
  const allText = `${normalized} ${qrJoined}`;

  if (LINE_INVITE.test(allText)) add(0.6, "含 LINE 加好友／加群連結");
  if (input.qrTexts.length > 0) {
    if (LINE_INVITE.test(qrJoined)) add(0.4, "圖片 QR Code 是 LINE 加好友／加群連結");
    else add(0.3, "圖片含 QR Code");
  }
  const hasUrl = URL.test(allText);
  if (hasUrl && !LINE_INVITE.test(allText)) add(0.15, "含網址");
  if (SHORTENER.test(allText)) add(0.25, "含短網址或導流頁");
  if (LINE_ID.test(normalized)) add(0.3, "含 LINE ID 寫法");
  if (PRIVATE_CONTACT.test(compact)) add(0.35, "引導私下聯繫");
  if (APP_ACCOUNT.test(compact)) add(0.4, "含通訊軟體帳號（LINE／微信／Telegram + ID）");

  const ignored = new Set(input.ignoreKeywords.map((k) => compactText(normalizeText(k))));
  const baits = INVEST_BAIT.filter((k) => !ignored.has(k) && compact.includes(k));
  const extras = input.extraKeywords.filter((k) => k && compact.includes(compactText(normalizeText(k))));
  const baitCount = baits.length + extras.length;
  if (baitCount > 0) add(Math.min(0.15 * baitCount, 0.45), `誘餌關鍵字：${[...baits, ...extras].slice(0, 6).join("、")}`);

  if (input.contentType === "CONTACT") add(0.5, "分享聯絡人名片");

  // 文字刻意變形：隱形字元、全形英數、花體英數、混入外文假字母（不計中文全形標點）
  const evasion = countEvasionChars(input.text);
  if (evasion >= 3) add(0.2, `文字刻意變形（${evasion} 個隱形字元／全形英數／假字母）`);

  // 暱稱
  const nk = nameKey(input.displayName);
  if (nk && (PRIVATE_CONTACT.test(nk) || LINE_INVITE.test(normalizeText(input.displayName)) || /line|wechat|telegram|飆股|老師|助理/.test(nk))) {
    add(0.3, "暱稱含導流字眼");
  }
  const adminLike = input.adminNames.map(nameKey).filter(Boolean).find((an) => similarity(nk, an) >= 0.75 || (an.length >= 2 && nk.includes(an)));
  if (adminLike) add(0.5, "暱稱與管理員相似（疑似假冒）");
  else if (OFFICIAL_IMPERSONATION.test(nk)) add(0.3, "暱稱自稱官方／管理員");

  if (input.duplicateSenders >= 2) add(0.4, `同樣內容被 ${input.duplicateSenders} 個不同成員發過`);

  const isNewMember = input.memberDays !== null && input.memberDays < input.newMemberDays;
  if (isNewMember && score > 0) add(0.1, `新成員（加入 ${input.memberDays!.toFixed(1)} 天）`);

  return { score: Math.min(score, 1), signals, normalized, compact, isNewMember, hasUrl };
}
