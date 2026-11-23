/**
 * 文字連結判斷測試：哪些文字訊息會被當成導流連結。不需要登入。
 *   npm run test:links
 */
import { judgeQr, judgeText } from "./qr-policy.js";
import { isPrivateHost, isShortLinkCandidate, resolveBlockedRedirect, type FetchLike, type LookupLike } from "./redirect.js";

/** 測試用的自訂封鎖網域（config.json 的 extraBlockDomains） */
const EXTRA = ["https://scam-shop.com/", "*.evil.example"];

const cases: [text: string, shouldBlock: boolean][] = [
  // 會處理
  ["https://url.kr/qlzmri", true],
  ["https://url.asia/ut2mzt", true],
  ["看這裡 myppt.cc/abc123", true],
  ["https://lurl.cc/xyz99", true],
  ["https://risu.io/AbCd", true],
  ["https://supr.link/AbCd", true],
  ["https://ssur.cc/AbCd", true],
  ["https://linktr.ee/stock_guru", true],
  ["https://portaly.cc/stock_guru", true],
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
  // LINE TODAY 新聞（網域跟 LINE 小程式一樣，但不是導流）
  ["https://liff.line.me/1454987169-1WAXAP3K/v3/article/j7pDOrx?utm_source=lineshare", false],
  ["https://today.line.me/tw/v2/article/j7pDOrx", false],
  // 新聞連結旁邊夾帶導流連結還是要處理
  ["https://liff.line.me/1454987169-1WAXAP3K/v3/article/abc 想賺錢加 https://line.me/ti/g2/AbCd", true],
  ["https://liff.line.me/1454987169x-AbCd/v3/article/abc", true], // 頻道 ID 不完全一樣
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
  ["https://liff.line.me/1454987169-1WAXAP3K/v3/article/j7pDOrx", false],
];
for (const [qr, expected] of qrCases) {
  const v = judgeQr([qr], { extraDomains: EXTRA });
  const ok = v.block === expected;
  if (ok) pass++;
  console.log(`${ok ? "✓" : "✗"} ${v.block ? "處理  " : "不處理"}｜QR：${qr}${v.block ? `｜${v.reason}` : ""}`);
}

let total = cases.length + qrCases.length;

// ── 未知短網址跳轉追蹤（純離線模擬，不連網） ──
const publicLookup: LookupLike = async (host) => (host === "internal.test" ? ["10.0.0.5"] : ["93.184.216.34"]);
const mockTable: Record<string, { status: number; location?: string; rejectHead?: boolean }> = {
  "https://foo.bz/x9k2": { status: 302, location: "https://line.me/ti/g2/AbCdEf" },
  "https://foo.bz/hop1": { status: 301, location: "https://bar.bz/hop2" },
  "https://bar.bz/hop2": { status: 302, location: "https://lin.ee/ZxYvWu" },
  "https://foo.bz/nohead": { status: 302, location: "https://t.me/vip_group", rejectHead: true },
  "https://foo.bz/news": { status: 302, location: "https://www.cna.com.tw/news/1" },
};
let fetchedUrls: string[] = [];
const mockFetch: FetchLike = async (url, init) => {
  fetchedUrls.push(`${init?.method ?? "GET"} ${url}`);
  const row = mockTable[url];
  if (!row) return new Response(null, { status: 404 });
  if (row.rejectHead && init?.method === "HEAD") return new Response(null, { status: 405 });
  return new Response(null, { status: row.status, headers: row.location ? { location: row.location } : {} });
};

const redirectChecks: [name: string, fn: () => Promise<boolean>][] = [
  ["候選連結：未知短網址納入", async () => isShortLinkCandidate("https://foo.bz/x9k2") === "https://foo.bz/x9k2"],
  ["候選連結：知名新聞站略過", async () => isShortLinkCandidate("https://www.cna.com.tw/news/1") === null],
  ["候選連結：內網位址拒絕", async () => isPrivateHost("127.0.0.1") && isPrivateHost("localhost") && isShortLinkCandidate("http://127.0.0.1/abc") === null],
  [
    "1 跳短網址跳轉至 LINE 群組 → 處理",
    async () => {
      const v = await resolveBlockedRedirect(["https://foo.bz/x9k2"], { fetcher: mockFetch, lookup: publicLookup, useCache: false });
      return Boolean(v?.block && v.text?.includes("line.me/ti/g2/AbCdEf"));
    },
  ],
  [
    "2 跳短網址跳轉至 lin.ee → 處理",
    async () => {
      const v = await resolveBlockedRedirect(["https://foo.bz/hop1"], { fetcher: mockFetch, lookup: publicLookup, useCache: false });
      return Boolean(v?.block && v.text?.includes("lin.ee/ZxYvWu"));
    },
  ],
  [
    "HEAD 回 405 改 GET 追到 Telegram → 處理",
    async () => {
      const v = await resolveBlockedRedirect(["https://foo.bz/nohead"], { fetcher: mockFetch, lookup: publicLookup, useCache: false });
      return Boolean(v?.block && v.text?.includes("t.me/vip_group"));
    },
  ],
  [
    "短網址跳轉至一般新聞 → 不處理",
    async () => {
      const v = await resolveBlockedRedirect(["https://foo.bz/news"], { fetcher: mockFetch, lookup: publicLookup, useCache: false });
      return v === null;
    },
  ],
  [
    "DNS 解析為內網 IP → 不發請求（防 SSRF）",
    async () => {
      fetchedUrls = [];
      const v = await resolveBlockedRedirect(["https://internal.test/abc"], { fetcher: mockFetch, lookup: publicLookup, useCache: false });
      return v === null && fetchedUrls.length === 0;
    },
  ],
  [
    "第一次逾時不快取成安全，第二次追到 LINE → 處理",
    async () => {
      let calls = 0;
      const flaky: FetchLike = async (url, init) => {
        calls++;
        if (calls === 1) throw new Error("timeout");
        return mockFetch(url === "https://foo.bz/flaky" ? "https://foo.bz/x9k2" : url, init);
      };
      const first = await resolveBlockedRedirect(["https://foo.bz/flaky"], { fetcher: flaky, lookup: publicLookup });
      const second = await resolveBlockedRedirect(["https://foo.bz/flaky"], { fetcher: flaky, lookup: publicLookup });
      return first === null && Boolean(second?.block);
    },
  ],
  [
    "確定沒跳轉的結果會快取，不重複發請求",
    async () => {
      let calls = 0;
      const counting: FetchLike = async (url, init) => {
        calls++;
        return mockFetch(url, init);
      };
      await resolveBlockedRedirect(["https://foo.bz/cached"], { fetcher: counting, lookup: publicLookup });
      await resolveBlockedRedirect(["https://foo.bz/cached"], { fetcher: counting, lookup: publicLookup });
      return calls === 1;
    },
  ],
];

for (const [name, fn] of redirectChecks) {
  total++;
  const ok = await fn();
  if (ok) pass++;
  console.log(`${ok ? "✓" : "✗"} 跳轉測試｜${name}`);
}

console.log(`\n${pass}/${total} 通過`);
process.exit(pass === total ? 0 : 1);
