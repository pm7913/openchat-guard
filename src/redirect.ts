/**
 * 未知短網址跳轉追蹤：當連結不在靜態清單內、但形態像短網址時，
 * 只發輕量 HEAD 請求（redirect: "manual"，不帶 Cookie），
 * 檢查 Location 標頭是否跳轉至 LINE／Telegram／WhatsApp／微信／封鎖網域。
 * 停在一般網頁時，再讀網頁開頭 32KB，看標題是否偽裝成 LINE 加好友頁（不執行 JavaScript）。
 */
import dns from "node:dns/promises";
import net from "node:net";
import { judgeQr, KNOWN_SITES, type QrVerdict } from "./qr-policy.js";

const STATIC_EXT = /\.(?:jpe?g|png|gif|webp|svg|ico|pdf|mp4|mov|mp3|zip|html?|aspx|jsp|css|js)$/i;

const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 500;
const cache = new Map<string, { at: number; verdict: QrVerdict | null }>();

function isUnder(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** 檢查 IP 是否為內網、本機或保留位址（防 SSRF）。 */
export function isPrivateIp(ip: string): boolean {
  const clean = ip.replace(/^\[|\]$/g, "").toLowerCase();
  if (clean.startsWith("::ffff:")) return isPrivateIp(clean.slice(7));

  const kind = net.isIP(clean);
  if (kind === 4) {
    const [a, b] = clean.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a === 169 && b === 254) return true; // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  if (kind === 6) {
    if (clean === "::" || clean === "::1") return true;
    const first = clean.split(":")[0] || "0";
    const head = Number.parseInt(first, 16);
    if ((head & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
    if ((head & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((head & 0xff00) === 0xff00) return true; // multicast
    return false;
  }
  return true;
}

/** 檢查 hostname 是否為本機、內網名稱或私有 IP。 */
export function isPrivateHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
  if (!h || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".home.arpa")) {
    return true;
  }
  if (net.isIP(h)) return isPrivateIp(h);
  return false;
}

/**
 * 判斷一條連結是否值得做跳轉追蹤。回傳標準化後的 URL，不值得追就回傳 null。
 * 只針對「網域較短、路徑精簡、非已知大型內容站」的連結，避免無謂請求。
 */
export function isShortLinkCandidate(rawLink: string): string | null {
  let trimmed = rawLink.trim().replace(/[),.;!?'"】」》）。，、]+$/, "");
  if (!trimmed) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    if (!/^https?:\/\//i.test(trimmed)) return null;
  } else {
    trimmed = `https://${trimmed}`;
  }

  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username || u.password) return null;

  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host.includes(".") || host.length > 28) return null;
  if (isPrivateHost(host)) return null;
  for (const d of KNOWN_SITES) if (isUnder(host, d)) return null;

  if (u.pathname.length <= 1) return null;
  if (u.pathname.length + u.search.length > 48) return null;
  const segments = u.pathname.split("/").filter(Boolean);
  if (segments.length === 0 || segments.length > 2) return null;
  if (STATIC_EXT.test(u.pathname)) return null;

  return u.href;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export type LookupLike = (hostname: string) => Promise<string[]>;

const defaultLookup: LookupLike = async (hostname) => {
  const rows = await dns.lookup(hostname, { all: true });
  return rows.map((r) => r.address);
};

export interface ResolveOptions {
  extraDomains?: string[];
  maxHops?: number;
  timeoutMs?: number;
  maxLinks?: number;
  useCache?: boolean;
  fetcher?: FetchLike;
  lookup?: LookupLike;
}

/** 網頁標題自稱 LINE 加好友頁（例：「Add LINE friend …」「加入好友」），但網域不是 LINE。 */
const LINE_LANDING_TITLE = /add\s*line\s*friend|line\s*(add\s*)?friend|加入?\s*line|line\s*好友|加入?好友/i;
const PAGE_READ_LIMIT = 32 * 1024;

/** 讀網頁開頭一段（夠看到 <head>），讀完就斷線，不下載整頁。 */
async function readHead(res: Response, limit = PAGE_READ_LIMIT): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < limit) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      size += value.byteLength;
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks).subarray(0, limit).toString("utf8");
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&hellip;/g, "…")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * 跳轉追到最後停在一般網頁時，讀網頁開頭檢查：
 *   - 標題／og:title 自稱 LINE 加好友頁
 *   - <meta refresh> 或寫死的 location = "..." 指向導流連結
 *   - 加密跳轉頁：頁面沒什麼文字、全是混淆程式（標題被換成「opening …」也抓得到）
 * 不執行 JavaScript。讀不到就當沒事（回傳 null）。
 */
async function inspectLanding(
  url: string,
  res: Response,
  method: "HEAD" | "GET",
  getInit: () => RequestInit,
  opts: { fetcher: FetchLike; extraDomains?: string[] },
): Promise<{ reason: string; target?: string } | null> {
  const type = res.headers.get("content-type") ?? "";
  if (type && !/html/i.test(type)) {
    void res.body?.cancel();
    return null;
  }
  let html: string;
  try {
    if (method === "HEAD") {
      void res.body?.cancel();
      const page = await opts.fetcher(url, getInit());
      if (page.status < 200 || page.status >= 300) {
        void page.body?.cancel();
        return null;
      }
      html = await readHead(page);
    } else {
      html = await readHead(res);
    }
  } catch {
    return null;
  }

  const titles = [
    html.match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i)?.[1],
    ...[...html.matchAll(/<meta\b[^>]*(?:property|name)\s*=\s*["'](?:og:title|twitter:title)["'][^>]*>/gi)].map(
      (m) => m[0].match(/content\s*=\s*["']([^"']*)["']/i)?.[1],
    ),
  ]
    .filter((t): t is string => Boolean(t))
    .map((t) => decodeEntities(t).trim());
  const fake = titles.find((t) => LINE_LANDING_TITLE.test(t));
  if (fake) return { reason: `網頁偽裝成 LINE 加好友頁（標題「${fake.slice(0, 40)}」）` };

  const targets = [
    html.match(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*content\s*=\s*["'][^"']*?url\s*=\s*([^"'\s>]+)/i)?.[1],
    ...[...html.matchAll(/location(?:\.href)?\s*=\s*["']([^"']{4,300})["']/gi)].map((m) => m[1]),
  ].filter((t): t is string => Boolean(t));
  for (const raw of targets) {
    let target: string;
    try {
      target = new URL(decodeEntities(raw), url).href;
    } catch {
      continue;
    }
    const v = judgeQr([target], { extraDomains: opts.extraDomains });
    if (v.block) return { reason: `網頁會跳轉至${v.reason}`, target };
  }

  if (isObfuscatedCloak(html)) return { reason: "網頁是加密跳轉頁（真正的連結藏在混淆程式裡）" };
  return null;
}

/**
 * javascript-obfuscator 產生的程式碼特徵：字串陣列輪轉迴圈 while(!![]) 搭配 parseInt。
 * 正常網站很少把這種程式直接寫在頁面裡，詐騙跳轉頁常用它藏住目的地、擋掉分析。
 */
const OBFUSCATOR_MARK = /while\s*\(\s*!!\s*\[\s*\]\s*\)/;

/**
 * 加密跳轉頁：頁面上幾乎沒有文字（只有「opening …」「Add LINE friend …」這類載入字樣），
 * 內容全是寫在頁面裡的混淆程式。標題怎麼換都一樣抓得到。
 */
function isObfuscatedCloak(html: string): boolean {
  const scripts = [...html.matchAll(/<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)(?:<\/script>|$)/gi)].map((m) => m[1]);
  const inline = scripts.join("\n");
  if (inline.length < 3000 || !OBFUSCATOR_MARK.test(inline) || !/parseInt\s*\(/.test(inline)) return false;
  const visible = decodeEntities(
    html
      .replace(/<script\b[\s\S]*?(?:<\/script>|$)/gi, " ")
      .replace(/<style\b[\s\S]*?(?:<\/style>|$)/gi, " ")
      .replace(/<head\b[\s\S]*?<\/head>/i, " ")
      .replace(/<[^>]*>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
  return visible.length < 200;
}

/**
 * 追一條連結的跳轉。verdict＝攔截判決（沒跳到導流就是 null）；
 * definitive＝有確實讀到結果。逾時、DNS 或連線失敗時是 false，這種結果不能快取成「安全」，
 * 不然詐騙連結只要剛好逾時一次，接下來 10 分鐘都會被放過。
 */
async function probeOne(startUrl: string, opts: Required<Pick<ResolveOptions, "maxHops" | "timeoutMs" | "fetcher" | "lookup">> & { extraDomains?: string[] }): Promise<{ verdict: QrVerdict | null; definitive: boolean }> {
  const safe = { verdict: null, definitive: true };
  const unknown = { verdict: null, definitive: false };
  let current = startUrl;
  const visited = new Set<string>([current]);

  for (let hop = 0; hop < opts.maxHops; hop++) {
    let u: URL;
    try {
      u = new URL(current);
    } catch {
      return safe;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") return safe;
    if (isPrivateHost(u.hostname)) return safe;

    if (!net.isIP(u.hostname.replace(/^\[|\]$/g, ""))) {
      let ips: string[];
      try {
        ips = await opts.lookup(u.hostname);
      } catch {
        return unknown;
      }
      if (ips.length === 0) return unknown;
      if (ips.some(isPrivateIp)) return safe;
    }

    const reqInit = (method: "HEAD" | "GET"): RequestInit => ({
      method,
      redirect: "manual",
      credentials: "omit",
      signal: AbortSignal.timeout(opts.timeoutMs),
      headers: { "user-agent": "Mozilla/5.0 (compatible; OpenChatGuard/1.0)" },
    });

    let res: Response;
    let method: "HEAD" | "GET" = "HEAD";
    try {
      res = await opts.fetcher(current, reqInit("HEAD"));
      if (res.status === 405 || res.status === 403 || res.status === 501) {
        void res.body?.cancel();
        method = "GET";
        res = await opts.fetcher(current, reqInit("GET"));
      }
    } catch {
      return unknown;
    }

    if (res.status >= 200 && res.status < 300) {
      // 停在一般網頁：看看是不是偽裝成 LINE 加好友頁（真正的連結藏在 JavaScript 裡，靠跳轉追不到）
      const page = await inspectLanding(current, res, method, () => reqInit("GET"), opts);
      if (!page) return safe;
      const via = current === startUrl ? startUrl : `${startUrl} → ${current}`;
      return {
        verdict: { block: true, reason: page.reason, text: page.target ? `${via} → ${page.target}` : via, learnHost: u.hostname.toLowerCase().replace(/\.$/, "") },
        definitive: true,
      };
    }
    void res.body?.cancel();

    if (res.status >= 500) return unknown;
    if (res.status < 300 || res.status >= 400) return safe;
    const loc = res.headers.get("location");
    if (!loc) return safe;

    let nextUrl: string;
    try {
      nextUrl = new URL(loc, current).href;
    } catch {
      return safe;
    }

    const v = judgeQr([nextUrl], { extraDomains: opts.extraDomains });
    if (v.block) {
      return {
        verdict: { block: true, reason: `短網址跳轉至${v.reason}`, text: `${startUrl} → ${nextUrl}` },
        definitive: true,
      };
    }

    if (visited.has(nextUrl)) return safe;
    visited.add(nextUrl);
    current = nextUrl;
  }

  // 跳超過 maxHops 次還沒到終點：不確定，不快取
  return unknown;
}

/**
 * 追蹤一組連結裡的疑似短網址，只要任何一條跳轉到導流目標就回傳攔截判決。
 * 失敗或逾時時安靜回傳 null，不影響正常訊息處理。
 */
export async function resolveBlockedRedirect(links: string[], opts: ResolveOptions = {}): Promise<QrVerdict | null> {
  const maxHops = opts.maxHops ?? 3;
  const timeoutMs = opts.timeoutMs ?? 2000;
  const maxLinks = opts.maxLinks ?? 3;
  const useCache = opts.useCache ?? true;
  const fetcher = opts.fetcher ?? fetch;
  const lookup = opts.lookup ?? defaultLookup;

  const candidates: string[] = [];
  const seen = new Set<string>();
  for (const raw of links) {
    const url = isShortLinkCandidate(raw);
    if (url && !seen.has(url)) {
      seen.add(url);
      candidates.push(url);
      if (candidates.length >= maxLinks) break;
    }
  }

  for (const url of candidates) {
    if (useCache) {
      const hit = cache.get(url);
      if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
        if (hit.verdict?.block) return hit.verdict;
        continue;
      }
    }

    const { verdict, definitive } = await probeOne(url, {
      extraDomains: opts.extraDomains,
      maxHops,
      timeoutMs,
      fetcher,
      lookup,
    });

    if (useCache && definitive) {
      if (cache.size >= CACHE_MAX) {
        const oldest = cache.keys().next().value;
        if (oldest) cache.delete(oldest);
      }
      cache.set(url, { at: Date.now(), verdict });
    }

    if (verdict?.block) return verdict;
  }

  return null;
}
