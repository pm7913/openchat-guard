import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Jimp } from "jimp";
import jsQRModule from "jsqr";
import { prepareZXingModule, readBarcodes, type ReaderOptions } from "zxing-wasm/reader";

// jsqr 是 CommonJS 套件：在 ESM 下 default 可能多包一層
type JsQR = typeof import("jsqr").default;
const jsQR: JsQR = ((jsQRModule as unknown as { default?: JsQR }).default ?? jsQRModule) as JsQR;

// zxing 預設會從網路 CDN 下載 .wasm；改成讀本機 node_modules 裡的檔案，完全離線
let zxingReady = false;
function ensureZxing() {
  if (zxingReady) return;
  const require = createRequire(import.meta.url);
  const wasm = readFileSync(require.resolve("zxing-wasm/reader/zxing_reader.wasm"));
  prepareZXingModule({
    overrides: { wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer },
    fireImmediately: true,
  });
  zxingReady = true;
}

const ZXING_OPTIONS: ReaderOptions = {
  formats: ["QRCode", "MicroQRCode", "RMQRCode"],
  tryHarder: true,
  tryRotate: true,
  tryInvert: true,
  tryDownscale: true,
  tryDenoise: true,
  maxNumberOfSymbols: 8,
};

export interface QrResult {
  text: string;
  /** 哪個解碼器解出來的 */
  engine: "zxing" | "jsqr";
}

export interface PreparedImage {
  /** 給 AI 看的 JPEG（base64） */
  jpegBase64: string;
  /** 圖片裡 QR Code 解出的內容 */
  qrTexts: string[];
}

type Bitmap = { data: Buffer | Uint8Array; width: number; height: number };
type JimpImage = Awaited<ReturnType<typeof Jimp.read>>;

const MAX_SIDE = 1568;

const rgba = (b: Bitmap) => new Uint8ClampedArray(b.data.buffer, b.data.byteOffset, b.data.byteLength);

async function zxing(b: Bitmap): Promise<string[]> {
  ensureZxing();
  const results = await readBarcodes({ width: b.width, height: b.height, data: rgba(b) } as ImageData, ZXING_OPTIONS);
  return results.filter((r) => r.isValid && r.text).map((r) => r.text);
}

function jsqr(b: Bitmap): string[] {
  const r = jsQR(rgba(b), b.width, b.height, { inversionAttempts: "attemptBoth" });
  return r?.data ? [r.data] : [];
}

/**
 * 找出圖片裡所有 QR Code。純本機影像演算法，不需要網路或 AI。
 * 1. zxing（主力）：一張圖可解多個、會自動試旋轉／反色／縮放／去雜訊
 * 2. 小圖放大 2 倍再用 zxing 掃一次（QR 常被縮得很小塞在角落）
 * 3. 都沒有才用 jsqr 補一次（兩套演算法偶爾互補）
 */
export async function scanQrImage(img: JimpImage): Promise<QrResult[]> {
  const found = new Map<string, QrResult>();
  const add = (texts: string[], engine: QrResult["engine"]) => {
    for (const text of texts) if (!found.has(text)) found.set(text, { text, engine });
  };

  add(await zxing(img.bitmap), "zxing");
  const small = Math.max(img.width, img.height) < 800;
  if (found.size === 0 && small) add(await zxing(img.clone().scale(2).bitmap), "zxing");
  if (found.size === 0) add(jsqr(img.bitmap), "jsqr");
  if (found.size === 0 && small) add(jsqr(img.clone().scale(2).bitmap), "jsqr");
  return [...found.values()];
}

export async function scanQr(buf: Buffer): Promise<QrResult[]> {
  return scanQrImage(await Jimp.read(buf));
}

export async function prepareImage(buf: Buffer): Promise<PreparedImage> {
  const img = await Jimp.read(buf);
  const qrTexts = (await scanQrImage(img)).map((r) => r.text);

  const forAi = img.clone();
  if (Math.max(forAi.width, forAi.height) > MAX_SIDE) {
    if (forAi.width >= forAi.height) forAi.resize({ w: MAX_SIDE });
    else forAi.resize({ h: MAX_SIDE });
  }
  const jpeg = await forAi.getBuffer("image/jpeg", { quality: 85 });
  return { jpegBase64: jpeg.toString("base64"), qrTexts };
}

/** 下載社群圖片原圖（縮圖解析度太低，小 QR 會解不出來）；原圖失敗才退回縮圖。 */
export async function downloadImage(m: { getData(preview?: boolean): Promise<Blob> }): Promise<{ buf: Buffer; preview: boolean }> {
  try {
    return { buf: Buffer.from(await (await m.getData(false)).arrayBuffer()), preview: false };
  } catch {
    return { buf: Buffer.from(await (await m.getData(true)).arrayBuffer()), preview: true };
  }
}
