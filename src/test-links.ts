/**
 * 文字連結判斷測試：哪些文字訊息會被當成導流連結。不需要登入。
 *   npm run test:links
 */
import { judgeQr, judgeText } from "./qr-policy.js";

/** 測試用的自訂封鎖網域（config.json 的 extraBlockDomains） */
const EXTRA = ["https://scam-shop.com/", "*.evil.example"];

const cases: [text: string, shouldBlock: boolean][] = [
  // 會處理
  ["https://url.kr/qlzmri", true],
  ["免費飆股群 https://line.me/ti/g2/AbCdEfGh12 名額有限", true],
  ["加官方助理領報告 lin.ee/xYz123", true],
  ["https://liff.line.me/1234567890-AbCdEfGh", true],
  ["進群：t.me/stock_vip", true],
  ["https://wa.me/886912345678", true],
  ["https://chat.whatsapp.com/AbCdEf", true],
  ["進去領免費體驗 bit.ly/3xYz9", true],
  ["https://reurl.cc/AbCdE", true],
  ["ｈｔｔｐｓ：／／ｌｉｎ．ｅｅ／ａｂｃ", true], // 全形
  ["lin。ee/abc", true], // 句號代替點
  ["https://lin​.ee/abc", true], // 零寬字元
  ["line://ti/p/@abc8899", true],
  // 免費網域
  ["物盡其用 · 安心交換\r\nokbin.eu.cc/IjX00vF/", true],
  ["二手交換群 https://okbin.eu.cc", true],
  ["看這裡 abc.us.kg", true],
  ["https://free-stock.duckdns.org/join", true],
  ["https://a1b2.trycloudflare.com/", true],
  ["eu.cc 是什麼？", true], // 免費網域本身也算
  // 自訂網域
  ["優惠在這 https://scam-shop.com/promo", true],
  ["https://www.scam-shop.com/", true],
  ["https://x.evil.example/abc", true],
  // 不處理
  ["台積電今天又漲了，有人有抱嗎？", false],
  ["分享一篇新聞 https://www.cna.com.tw/news/afe/202611100001.aspx", false],
  ["https://tw.stock.yahoo.com/quote/2330.TW", false],
  ["https://www.youtube.com/watch?v=abc123", false],
  ["加 L I N E：@abc8899 領取今日明牌", false], // 沒有連結，QR 守衛不判斷文字內容
  ["我的 email 是 someone@example.com", false],
  ["今天 3.5% 的漲幅不錯", false],
  ["股價 2330.TW 收在 1050", false],
  ["https://notscam-shop.com/", false], // 名字很像，但不是自訂網域或它的子網域
  ["https://www.cna.com.tw/news/aipl/202611130001.aspx", false],
];

let pass = 0;
for (const [text, expected] of cases) {
  const v = judgeText(text, { extraDomains: EXTRA });
  const ok = v.block === expected;
  if (ok) pass++;
  console.log(`${ok ? "✓" : "✗"} ${v.block ? "處理  " : "不處理"}｜${text}${v.block ? `｜${v.reason}` : ""}`);
}
// QR Code 內容也套用同樣的免費網域和自訂網域規則
const qrCases: [qr: string, shouldBlock: boolean][] = [
  ["https://okbin.eu.cc/IjX00vF/", true],
  ["https://scam-shop.com/", true],
  ["https://www.cna.com.tw/", false],
];
for (const [qr, expected] of qrCases) {
  const v = judgeQr([qr], { extraDomains: EXTRA });
  const ok = v.block === expected;
  if (ok) pass++;
  console.log(`${ok ? "✓" : "✗"} ${v.block ? "處理  " : "不處理"}｜QR：${qr}${v.block ? `｜${v.reason}` : ""}`);
}

const total = cases.length + qrCases.length;
console.log(`\n${pass}/${total} 通過`);
process.exit(pass === total ? 0 : 1);
