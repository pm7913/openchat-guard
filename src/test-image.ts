/**
 * QR Code 辨識測試（不需要登入、網路或 API key）。
 *
 *   npm run test:image                 用程式產生的各種刁鑽 QR 圖測試
 *   npm run test:image -- 圖片或資料夾   掃描你自己的圖（例如廣告截圖）
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import QRCode from "qrcode";
import { Jimp } from "jimp";
import { scanQr, scanQrImage } from "./image.js";

const args = process.argv.slice(2);

if (args.length > 0) {
  // ── 掃描指定的圖片／資料夾 ──
  const IMG = /\.(jpe?g|png|gif|bmp|tiff?)$/i;
  const files: string[] = [];
  for (const a of args) {
    if (statSync(a).isDirectory()) for (const f of readdirSync(a)) IMG.test(f) && files.push(path.join(a, f));
    else files.push(a);
  }
  let hit = 0;
  for (const f of files) {
    try {
      const t0 = Date.now();
      const r = await scanQr(readFileSync(f));
      if (r.length) hit++;
      const out = r.length ? r.map((x) => `${x.text}（${x.engine}）`).join("、") : "沒有 QR Code";
      console.log(`${path.basename(f)}｜${Date.now() - t0}ms｜${out}`);
    } catch (e) {
      console.log(`${path.basename(f)}｜讀取失敗：${(e as Error).message}`);
    }
  }
  console.log(`\n共 ${files.length} 張，${hit} 張有 QR Code`);
  process.exit(0);
}

// ── 內建測試：模擬詐騙集團常見的躲避手法 ──
const URL1 = "https://line.me/ti/p/~scam_teacher888";
const URL2 = "https://lin.ee/AbCdEf9";
const qr = async (text: string, width = 300, light = "#ffffff", dark = "#000000") =>
  Jimp.read(await QRCode.toBuffer(text, { width, margin: 2, color: { light, dark } }));
/** 測試只需要能輸出 JPEG；jimp 各操作的回傳型別彼此不相容，這裡用最小介面 */
type Img = { getBuffer(mime: "image/jpeg", opts?: { quality: number }): Promise<Buffer> };
const poster = (w: number, h: number, color = 0xf2c94cff) => new Jimp({ width: w, height: h, color });

const cases: { name: string; expect: string[]; make: () => Promise<Img> }[] = [
  { name: "單純一張 QR", expect: [URL1], make: () => qr(URL1) },
  {
    name: "縮成 60px 塞在海報角落",
    expect: [URL1],
    make: async () => { const b = poster(1080, 1350); const q = await qr(URL1); q.resize({ w: 60 }); b.composite(q, 990, 1260); return b; },
  },
  {
    name: "超大圖（4000px）裡的小 QR",
    expect: [URL1],
    make: async () => { const b = poster(3000, 4000); const q = await qr(URL1); q.resize({ w: 220 }); b.composite(q, 2700, 3700); return b; },
  },
  { name: "黑白反色", expect: [URL1], make: () => qr(URL1, 300, "#000000", "#ffffff") },
  { name: "旋轉 30 度", expect: [URL1], make: async () => (await qr(URL1)).rotate(30) },
  { name: "旋轉 180 度", expect: [URL1], make: async () => (await qr(URL1)).rotate(180) },
  {
    name: "一張圖兩個 QR",
    expect: [URL1, URL2],
    make: async () => { const b = poster(900, 500, 0xffffffff); b.composite(await qr(URL1), 50, 100); b.composite(await qr(URL2), 500, 100); return b; },
  },
  { name: "彩色低對比", expect: [URL1], make: () => qr(URL1, 300, "#f5d76e", "#8a6d1e") },
  { name: "模糊", expect: [URL1], make: async () => (await qr(URL1)).blur(3) },
  {
    name: "雜訊背景",
    expect: [URL1],
    make: async () => {
      const b = poster(800, 800, 0x777777ff);
      b.scan((_x, _y, i) => { const v = Math.random() * 255; b.bitmap.data[i] = b.bitmap.data[i + 1] = b.bitmap.data[i + 2] = v; });
      b.composite(await qr(URL1, 260), 270, 270);
      return b;
    },
  },
  {
    name: "半透明疊在彩色背景",
    expect: [URL1],
    make: async () => { const b = poster(600, 600, 0xc0392bff); const q = await qr(URL1); q.opacity(0.45); b.composite(q, 150, 150); return b; },
  },
  { name: "高度壓縮的 JPEG", expect: [URL1], make: async () => Jimp.read(await (await qr(URL1, 200)).getBuffer("image/jpeg", { quality: 15 })) },
  { name: "壓扁變形", expect: [URL1], make: async () => (await qr(URL1)).resize({ w: 300, h: 150 }) },
  {
    name: "傳到 LINE 後的縮圖（360px）",
    expect: [URL1],
    make: async () => { const b = poster(1080, 1350); const q = await qr(URL1); q.resize({ w: 200 }); b.composite(q, 860, 1130); b.resize({ w: 360 }); return b; },
  },
  { name: "沒有 QR 的圖", expect: [], make: async () => poster(600, 400, 0x336699ff) },
];

let pass = 0;
for (const c of cases) {
  const img = await c.make();
  // 經過一次 JPEG 編碼，模擬 LINE 傳圖
  const reloaded = await Jimp.read(await img.getBuffer("image/jpeg", { quality: 85 }));
  const t0 = Date.now();
  const got = await scanQrImage(reloaded);
  const ms = Date.now() - t0;
  const texts = got.map((g) => g.text).sort();
  const ok = JSON.stringify(texts) === JSON.stringify([...c.expect].sort());
  if (ok) pass++;
  const detail = got.length ? got.map((g) => `${g.engine}`).join("+") : "無";
  console.log(`${ok ? "✓" : "✗"} ${String(ms).padStart(4)}ms  解出 ${got.length} 個（${detail}）｜${c.name}`);
}
console.log(`\n${pass}/${cases.length} 通過`);
process.exit(pass === cases.length ? 0 : 1);
