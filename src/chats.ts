/**
 * 新增或移除要守護的聊天室（config.json 的 watchChatMids）。
 *   npm run chat:add <聊天室 ID> [更多 ID…]
 *   npm run chat:remove <聊天室 ID> [更多 ID…]
 *
 * 新增時會登入確認聊天室存在，並檢查機器人在那個社群的身分。移除不需要登入。
 */
import { findRunningGuard, loadConfig, saveWatchChatMids } from "./config.js";

const [action, ...input] = process.argv.slice(2);
const MID = /^m[0-9a-f]{32}$/;
const ID_HINT = "聊天室 ID 是 m 開頭的 33 個字元，用 npm run list 查。";

function usage(): never {
  console.log("用法：");
  console.log("  npm run chat:add <聊天室 ID>      新增要守護的聊天室");
  console.log("  npm run chat:remove <聊天室 ID>   移除守護的聊天室");
  console.log(ID_HINT);
  process.exit(1);
}

const mids = [...new Set(input.map((s) => s.trim()).filter(Boolean))];
if ((action !== "add" && action !== "remove") || mids.length === 0) usage();

const cfg = loadConfig();
let current = [...cfg.watchChatMids];

if (action === "remove") {
  // 不檢查格式：手動填錯的 ID 也要能移除。比對時忽略前後空白，重複的也一起移除。
  for (const mid of mids) {
    const before = current.length;
    current = current.filter((m) => m.trim() !== mid);
    console.log(current.length < before ? `✓ 已移除 ${mid}` : `－ ${mid} 本來就不在守護清單裡`);
  }
} else {
  const invalid = mids.filter((m) => !MID.test(m));
  if (invalid.length) {
    console.error(`不是聊天室 ID：${invalid.join("、")}`);
    console.error(ID_HINT);
    process.exit(1);
  }

  // 新增要登入確認聊天室；同一個帳號不能跟守衛同時登入
  const running = findRunningGuard();
  if (running) {
    console.error(`守衛正在執行中（${running.script}，PID ${running.pid}），同一個帳號不能同時登入兩個程式。`);
    console.error("請先停止守衛（按 Ctrl+C 或關掉 start-guard.bat 的視窗），新增完再重新啟動。");
    process.exit(1);
  }

  // 只有新增需要登入；移除時不載入 linejs，啟動比較快
  const { getChatInfo, isAdminRole, loginSaved } = await import("./line.js");
  const client = await loginSaved();

  for (const mid of mids) {
    if (current.includes(mid)) {
      console.log(`－ ${mid} 已經在守護清單裡`);
      continue;
    }
    let info: Awaited<ReturnType<typeof getChatInfo>>;
    try {
      info = await getChatInfo(client, mid);
    } catch (e) {
      const err = e as Error & { data?: { errorCode?: string } };
      // ID 不存在或機器人不在裡面時，LINE 回 ILLEGAL_ARGUMENT；伺服器暫時出問題也可能是這個錯誤
      const detail = err.data?.errorCode === "ILLEGAL_ARGUMENT" ? "。" : `：${err.message}`;
      console.log(`✗ ${mid} 找不到或暫時讀不到，沒有加入${detail}`);
      console.log("  請確認 ID 正確、機器人帳號已經加入這個社群；都沒問題的話，請稍後再試一次。");
      continue;
    }
    if (!info.joined) {
      console.log(`✗「${info.name}」：機器人目前不在這個社群裡（已退出、被移出或還在等審核），沒有加入。`);
      continue;
    }
    current.push(mid);
    console.log(`✓ 已加入「${info.name}」｜機器人身分：${info.role}`);
    if (!isAdminRole(info.role)) {
      console.log("  ⚠ 機器人在這個社群不是管理員或副管理員，看得到廣告但刪不掉。");
      console.log("    請群主把它設成副管理員，並給它「刪除訊息」和「刪除成員」的權限。");
    }
  }
}

if (current.length !== cfg.watchChatMids.length) {
  try {
    saveWatchChatMids(current);
  } catch (e) {
    console.error(`\n✗ 沒有存檔：${(e as Error).message}`);
    process.exit(1);
  }
  console.log(`\n已更新 config.json，目前守護 ${current.length} 個聊天室。`);
  console.log(action === "remove" ? "守衛正在執行的話，要重新啟動才會生效。" : "啟動守衛後就會開始守護。");
} else {
  console.log("\nconfig.json 沒有變動。");
}
process.exit(0);
