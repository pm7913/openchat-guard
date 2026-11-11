/**
 * 列出機器人帳號加入的社群聊天室，以及它在每個社群的身分。
 *   npm run list
 *
 * 註：getJoinedSquareChats 在電腦版登入身分下不支援（NOT_IMPLEMENTED），
 * 所以改用 getJoinedSquares 列社群、從 fetchMyEvents 的「加入聊天室」事件取得聊天室 ID。
 */
import { loginSaved } from "./line.js";

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

console.log("\n把要監看的聊天室 ID（m 開頭）填進 config.json 的 watchChatMids：\n");
for (const [squareMid, squareName] of squares) {
  console.log(`社群「${squareName}」｜機器人身分：${roles.get(squareMid)}`);
  const list = [...chats].filter(([, c]) => c.squareMid === squareMid);
  if (list.length === 0) console.log("   （找不到聊天室 ID：請在手機上進入這個社群的聊天室一次，再重新執行）");
  for (const [mid, c] of list) console.log(`   ${mid}   ${c.name}`);
}
console.log("\n收訊測試不需要管理員身分；之後要自動刪除和踢人，身分必須是 ADMIN 或 CO_ADMIN。");
process.exit(0);
