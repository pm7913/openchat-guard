/**
 * 接收社群訊息：推播為主、慢速補漏。正式機器人（bot.ts）和收訊測試（watch.ts）共用。
 *
 * 推播：跟 LINE 維持一條長連線，有新訊息時伺服器主動推過來（跟官方 App 一樣）。
 * 補漏：每個聊天室每隔一段隨機時間主動抓一次，補上推播漏掉的訊息、
 *       新成員加入、改暱稱等事件。同一則訊息以 ID 去重，只交出去一次。
 */
import { SquareMessage, type Client } from "@evex-dev/linejs";

type SquareService = Client["base"]["square"];
type ChatEvent = Awaited<ReturnType<SquareService["fetchSquareChatEvents"]>>["events"][number];
type Member = NonNullable<ChatEvent["payload"]["notifiedJoinSquareChat"]>["joinedMember"];

export type Via = "push" | "poll";

export interface ReceiverOptions {
  client: Client;
  chatMids: string[];
  /** 補漏間隔（秒），每次在範圍內隨機 */
  pollIntervalSec: [number, number];
  /** 上次的書籤；沒有的聊天室第一次只會把書籤移到最新，不處理舊訊息 */
  syncTokens: Record<string, string>;
  /** 書籤更新時呼叫，用來存檔 */
  onSyncToken: (chatMid: string, token: string) => void;
  onMessage: (chatMid: string, message: SquareMessage, info: { via: Via; senderDisplayName?: string }) => void;
  onJoin?: (chatMid: string, member: Member) => void;
  onProfileUpdate?: (chatMid: string, member: Member) => void;
  /** 同時接收一對一私訊（正式機器人用來綁定通知） */
  listenTalk?: boolean;
  /** 幾分鐘回報一次推播／補漏統計 */
  statsEveryMin?: number;
  log: (msg: string) => void;
}

export interface ReceiverStats {
  push: number;
  poll: number;
  duplicate: number;
  polls: number;
  pollErrors: number;
}

export async function startReceiver(opts: ReceiverOptions): Promise<ReceiverStats> {
  const sq = opts.client.base.square;
  const watched = new Set(opts.chatMids);
  const fetching = new Set<string>();
  const stats: ReceiverStats = { push: 0, poll: 0, duplicate: 0, polls: 0, pollErrors: 0 };

  const seen = new Set<string>();
  const firstTime = (id: string): boolean => {
    if (seen.has(id)) return false;
    seen.add(id);
    if (seen.size > 5000) {
      const oldest = seen.values().next().value;
      if (oldest !== undefined) seen.delete(oldest);
    }
    return true;
  };

  const dispatch = (chatMid: string, m: SquareMessage, via: Via, senderDisplayName?: string) => {
    const id = m.raw.message?.id;
    if (!id) return;
    if (!firstTime(id)) {
      stats.duplicate++;
      return;
    }
    stats[via]++;
    try {
      opts.onMessage(chatMid, m, { via, senderDisplayName });
    } catch (e) {
      opts.log(`處理訊息失敗：${(e as Error).message}`);
    }
  };

  const handleChatEvent = (chatMid: string, ev: ChatEvent) => {
    const p = ev.payload;
    if (ev.type === "RECEIVE_MESSAGE" && p.receiveMessage?.squareMessage) {
      const m = new SquareMessage({ client: opts.client, raw: p.receiveMessage.squareMessage });
      dispatch(chatMid, m, "poll", p.receiveMessage.senderDisplayName);
    } else if (ev.type === "NOTIFIED_JOIN_SQUARE_CHAT" && p.notifiedJoinSquareChat?.joinedMember) {
      opts.onJoin?.(chatMid, p.notifiedJoinSquareChat.joinedMember);
    } else if (ev.type === "NOTIFIED_UPDATE_SQUARE_MEMBER_PROFILE" && p.notifiedUpdateSquareMemberProfile?.squareMember) {
      opts.onProfileUpdate?.(chatMid, p.notifiedUpdateSquareMemberProfile.squareMember);
    }
  };

  /** 從書籤抓到最新。skipOld=true 時只移動書籤，不處理事件。 */
  const catchUp = async (chatMid: string, skipOld = false): Promise<void> => {
    if (fetching.has(chatMid)) return;
    fetching.add(chatMid);
    try {
      let token = opts.syncTokens[chatMid];
      for (let page = 0; page < 20; page++) {
        const r = await sq.fetchSquareChatEvents({ squareChatMid: chatMid, syncToken: token, limit: 100 });
        stats.polls++;
        if (!skipOld) for (const ev of r.events) handleChatEvent(chatMid, ev);
        const advanced = !!r.syncToken && r.syncToken !== token;
        if (r.syncToken) token = r.syncToken;
        if (r.events.length === 0 || !advanced) break;
      }
      if (token && token !== opts.syncTokens[chatMid]) {
        opts.syncTokens[chatMid] = token;
        opts.onSyncToken(chatMid, token);
      }
    } catch (e) {
      stats.pollErrors++;
      opts.log(`補漏失敗（${chatMid.slice(0, 10)}…）：${(e as Error).message}`);
    } finally {
      fetching.delete(chatMid);
    }
  };

  const schedule = (chatMid: string) => {
    const [min, max] = opts.pollIntervalSec;
    const delayMs = (min + Math.random() * Math.max(0, max - min)) * 1000;
    setTimeout(async () => {
      await catchUp(chatMid);
      schedule(chatMid);
    }, delayMs);
  };

  // 推播：所有已加入社群的事件都會推過來，只處理有監看的聊天室
  opts.client.on("square:event", (ev) => {
    if (ev.type !== "NOTIFICATION_MESSAGE") return;
    const n = ev.payload?.notificationMessage;
    if (!n || !watched.has(n.squareChatMid)) return;
    if (n.squareMessage) {
      const m = new SquareMessage({ client: opts.client, raw: n.squareMessage });
      dispatch(n.squareChatMid, m, "push", n.senderDisplayName);
    }
    // 伺服器表示這次推播不完整、需要另外抓：立刻補漏
    if (n.requiredToFetchChatEvents) void catchUp(n.squareChatMid);
  });

  // 第一次執行：把書籤移到最新，不處理舊訊息；之後重開：補上停機期間的訊息
  for (const chatMid of opts.chatMids) {
    await catchUp(chatMid, !opts.syncTokens[chatMid]);
    schedule(chatMid);
  }

  opts.client.listen({ talk: !!opts.listenTalk, square: true });
  opts.log(`接收方式：推播＋每 ${opts.pollIntervalSec[0]}～${opts.pollIntervalSec[1]} 秒補漏`);

  const everyMin = opts.statsEveryMin ?? 60;
  setInterval(() => {
    opts.log(
      `過去 ${everyMin} 分鐘：推播 ${stats.push} 則、補漏才抓到 ${stats.poll} 則、` +
        `兩邊重複 ${stats.duplicate} 則｜補漏請求 ${stats.polls} 次、失敗 ${stats.pollErrors} 次`,
    );
    if (stats.poll > 5 && stats.poll > stats.push) {
      opts.log("⚠ 大部分訊息是補漏抓到的，推播可能沒收到。請確認機器人帳號有開啟該社群的通知。");
    }
    stats.push = stats.poll = stats.duplicate = stats.polls = stats.pollErrors = 0;
  }, everyMin * 60 * 1000).unref();

  return stats;
}
