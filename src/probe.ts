/**
 * 診斷：測試哪些社群（Square）讀取功能在目前登入身分下可用。只讀取，不改任何東西。
 *   npx tsx src/probe.ts
 */
import { loginSaved } from "./line.js";

const client = await loginSaved();
const sq = client.base.square;

async function tryCall<T>(name: string, fn: () => Promise<T>, show: (r: T) => string): Promise<T | null> {
  try {
    const r = await fn();
    console.log(`✓ ${name}：${show(r)}`);
    return r;
  } catch (e) {
    const err = e as Error & { data?: unknown };
    console.log(`✗ ${name}：${err.data ? JSON.stringify(err.data) : err.message}`);
    return null;
  }
}

const squares = await tryCall(
  "getJoinedSquares",
  () => sq.getJoinedSquares({ limit: 50 }),
  (r) => `${r.squares.length} 個社群`,
);

const events = await tryCall(
  "fetchMyEvents",
  () => sq.fetchMyEvents({ limit: 100 }),
  (r) => `${r.events.length} 個事件`,
);

let chatMid: string | undefined;
for (const s of squares?.squares ?? []) {
  const my = squares?.members?.[s.mid];
  console.log(`  社群「${s.name}」 squareMid=${s.mid} 我的身分=${my?.role ?? "?"}`);
  const chats = await tryCall(
    `getJoinableSquareChats(${s.name})`,
    () => sq.getJoinableSquareChats({ request: { squareMid: s.mid, limit: 50 } }),
    (r) => `${r.squareChats.length} 個聊天室`,
  );
  for (const c of chats?.squareChats ?? []) {
    console.log(`    聊天室「${c.name}」 squareChatMid=${c.squareChatMid}`);
    chatMid ??= c.squareChatMid;
  }
}

if (events) {
  const fromEvents = events.events
    .map((e) => e.payload.notifiedCreateSquareChatMember?.chat)
    .filter((c): c is NonNullable<typeof c> => !!c);
  for (const c of fromEvents) {
    console.log(`  （事件中的聊天室）「${c.name}」 squareChatMid=${c.squareChatMid}`);
    chatMid ??= c.squareChatMid;
  }
  const types = new Map<string, number>();
  for (const e of events.events) types.set(String(e.type), (types.get(String(e.type)) ?? 0) + 1);
  console.log(`  事件類型：${[...types].map(([t, n]) => `${t}×${n}`).join("、") || "無"}`);
}

if (chatMid) {
  await tryCall(
    "getSquareChat",
    () => sq.getSquareChat({ squareChatMid: chatMid }),
    (r) => `「${r.squareChat.name}」`,
  );
  await tryCall(
    "fetchSquareChatEvents（收訊補漏用）",
    () => sq.fetchSquareChatEvents({ squareChatMid: chatMid, limit: 5 }),
    (r) => `${r.events.length} 個事件，syncToken ${r.syncToken ? "有" : "無"}`,
  );
} else {
  console.log("找不到任何聊天室，無法測試收訊功能。");
}
process.exit(0);
