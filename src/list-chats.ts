/**
 * 列出機器人帳號加入的社群聊天室，以及它在每個社群的身分。
 *   npm run list
 *
 * 註：getJoinedSquareChats 在電腦版登入身分下不支援（NOT_IMPLEMENTED），
 * 所以改用 getJoinedSquares 列社群、從 fetchMyEvents 的「加入聊天室」事件取得聊天室 ID。
 */
import { loadConfig } from "./config.js";
import { getChatInfo, loginSaved } from "./line.js";

// 設定檔壞掉時照樣列出聊天室，方便查 ID 把它修好
let watching = new Set<string>();
try {
  watching = new Set(loadConfig().watchChatMids);
} catch (e) {
  console.log(`⚠ config.json 讀不到（${(e as Error).message}），先不標示守護中的聊天室。`);
}
const client = await loginSaved();
const sq = client.base.square;

// 1. 已加入的社群
const squares = new Map<string, string>();
let token: string | undefined;
do {
  const r = await sq.getJoinedSquares({ limit: 100, continuationToken: token });
  for (const s of r.squares) squares.set(s.mid, s.name);
  token = r.continuationToken || undefined;
} while (token);

// 2. 從帳號事件找出已加入的聊天室
const chats = new Map<string, { name: string; squareMid: string }>();
token = undefined;
for (let page = 0; page < 20; page++) {
  const r = await sq.fetchMyEvents({ limit: 200, continuationToken: token });
  for (const e of r.events) {
    const c = e.payload.notifiedCreateSquareChatMember?.chat;
    if (c?.squareChatMid) chats.set(c.squareChatMid, { name: c.name, squareMid: c.squareMid });
  }
  token = r.continuationToken || undefined;
  if (!token || r.events.length === 0) break;
}

if (squares.size === 0) {
  console.log("這個帳號還沒加入任何社群。請先用手機讓它加入你的社群。");
  process.exit(0);
}

// 守護中的聊天室如果不在上面的事件紀錄裡（例如很久以前加入的），直接查一次
const unreadable: string[] = [];
for (const mid of watching) {
  if (chats.has(mid)) continue;
  try {
    const info = await getChatInfo(client, mid);
    if (info.joined) chats.set(mid, { name: info.name, squareMid: info.squareMid });
    else unreadable.push(mid);
  } catch {
    unreadable.push(mid);
  }
}

// 3. 每個社群裡機器人的身分
const roles = new Map<string, string>();
for (const squareMid of squares.keys()) {
  try {
    const s = await sq.getSquare({ squareMid });
    roles.set(squareMid, String(s.myMembership.role));
  } catch {
    roles.set(squareMid, "?");
  }
}

console.log("\n已加入的社群（✓ = 守護中）：\n");
for (const [squareMid, squareName] of squares) {
  console.log(`社群「${squareName}」｜機器人身分：${roles.get(squareMid)}`);
  const list = [...chats].filter(([, c]) => c.squareMid === squareMid);
  if (list.length === 0) console.log("   （找不到聊天室 ID：請在手機上進入這個社群的聊天室一次，再重新執行）");
  for (const [mid, c] of list) console.log(` ${watching.has(mid) ? "✓" : " "} ${mid}   ${c.name}`);
}
if (unreadable.length) {
  console.log("\n⚠ 守護清單裡的這些聊天室讀不到（ID 打錯，或機器人已經不在裡面），守衛啟動時會出錯：");
  for (const mid of unreadable) console.log(`   「${mid}」`);
  console.log("  確定不要了就用 npm run chat:remove <聊天室 ID> 移除。");
}
console.log("\n新增守護：npm run chat:add <聊天室 ID>　移除守護：npm run chat:remove <聊天室 ID>");
console.log("收訊測試不需要管理員身分；之後要自動刪除和踢人，身分必須是 ADMIN 或 CO_ADMIN。");
process.exit(0);
