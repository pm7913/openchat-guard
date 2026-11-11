/**
 * 第一次登入：用機器人專用帳號的手機掃 QR Code。
 *   npm run login
 *
 * QR Code 會直接畫在終端機上，透過 SSH 在 VPS 登入也能掃；同時存成 data/login-qr.png。
 * Windows 上還會自動打開那張圖。
 */
import path from "node:path";
import { execFile } from "node:child_process";
import QRCode from "qrcode";
import { DATA_DIR, ensureDataDir } from "./config.js";
import { loginByQr } from "./line.js";
import { terminalQr } from "./terminal-qr.js";

ensureDataDir();
const qrFile = path.join(DATA_DIR, "login-qr.png");

console.log("正在向 LINE 取得登入 QR Code……");
const client = await loginByQr(async (url) => {
  await QRCode.toFile(qrFile, url, { width: 420, margin: 2 });
  console.log("\n請用「機器人專用帳號」的手機 LINE 掃描下面的 QR Code（主頁 → 右上角掃描）：\n");
  console.log(terminalQr(url));
  console.log(`\nQR Code 也存成圖片：${qrFile}`);
  console.log("掃不到的話：把終端機視窗放大或縮小字型，讓 QR Code 完整顯示、不要折行。");
  console.log("QR Code 幾分鐘內有效，過期請重新執行 npm run login。\n");
  if (process.platform === "win32") execFile("explorer.exe", [qrFile], () => {});
});

const profile = client.base.profile;
console.log(`登入成功：${profile?.displayName ?? "(未知暱稱)"}`);
console.log("登入資料已存在 data/ 資料夾（請勿外傳）。下一步：npm run list");
process.exit(0);
