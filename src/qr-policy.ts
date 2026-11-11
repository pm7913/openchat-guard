/**
 * QR Code 內容判斷：哪些 QR 一出現就視為詐騙導流。
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
  [/(^|\/\/)(reurl\.cc|bit\.ly|tinyurl\.com|ppt\.cc|pse\.is|lihi\d?\.(cc|com|me)|cutt\.ly|is\.gd|goo\.gl|rebrand\.ly|shorturl\.at|s\.id|t\.ly)\//i, "短網址（常用來藏真正的連結）"],
];

export interface QrVerdict {
  /** 是否視為詐騙導流 */
  block: boolean;
  /** 命中的原因（給人看的） */
  reason: string;
  /** 觸發的那個 QR 內容 */
  text?: string;
}

/**
 * @param qrTexts 圖片裡解出的所有 QR 內容
 * @param blockAnyQr true = 任何 QR Code 都視為詐騙（社群規定不准貼 QR 時用）
 */
export function judgeQr(qrTexts: string[], blockAnyQr = false): QrVerdict {
  for (const text of qrTexts) {
    for (const [re, reason] of BLOCK) if (re.test(text.trim())) return { block: true, reason, text };
  }
  if (qrTexts.length === 0) return { block: false, reason: "沒有 QR Code" };
  if (blockAnyQr) return { block: true, reason: "含 QR Code（設定為一律處理）", text: qrTexts[0] };
  return { block: false, reason: "QR Code 不是已知的導流連結", text: qrTexts[0] };
}
