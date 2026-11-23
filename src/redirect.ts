/**
 * 未知短網址跳轉追蹤：當連結不在靜態清單內、但形態像短網址時，
 * 只發輕量 HEAD 請求（redirect: "manual"，不載入網頁、不帶 Cookie），
 * 檢查 Location 標頭是否跳轉至 LINE／Telegram／WhatsApp／微信／封鎖網域。
 */
import dns from "node:dns/promises";
import net from "node:net";
import { judgeQr, type QrVerdict } from "./qr-policy.js";

/** 常見新聞、股市、影音、社群主站：不是短網址，略過跳轉追蹤。 */
const SKIP_DOMAINS = [
  "cna.com.tw", "udn.com", "ltn.com.tw", "yahoo.com", "ettoday.net",
  "setn.com", "tvbs.com.tw", "chinatimes.com", "storm.mg", "businessweekly.com.tw",
  "cw.com.tw", "bnext.com.tw", "technews.tw", "moneydj.com", "cnyes.com",
  "anue.com", "wantgoo.com", "cmoney.tw", "goodinfo.tw", "twse.com.tw",
  "tpex.org.tw", "tradingview.com", "investing.com", "youtube.com", "youtu.be",
  "google.com", "wikipedia.org", "github.com", "ptt.cc", "dcard.tw",
  "mobile01.com", "facebook.com", "instagram.com", "threads.net", "threads.com",
  "x.com", "twitter.com",
];

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
  for (const d of SKIP_DOMAINS) if (isUnder(host, d)) return null;

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
    try {
      res = await opts.fetcher(current, reqInit("HEAD"));
      if (res.status === 405 || res.status === 403 || res.status === 501) {
        void res.body?.cancel();
        res = await opts.fetcher(current, reqInit("GET"));
      }
    } catch {
      return unknown;
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
