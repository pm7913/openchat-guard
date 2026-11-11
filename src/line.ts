import path from "node:path";
import { loginWithAuthToken, loginWithQR, type Client } from "@evex-dev/linejs";
import { FileStorage } from "@evex-dev/linejs/storage";
import { DATA_DIR, ensureDataDir, readJson, writeJson } from "./config.js";

/** 以 Windows 電腦版身分登入。會擠掉這個帳號原本的電腦版登入（機器人專用帳號沒影響）。 */
const DEVICE = "DESKTOPWIN" as const;

function storage(): FileStorage {
  ensureDataDir();
  return new FileStorage(path.join(DATA_DIR, "line-storage.json"));
}

export function saveAuth(client: Client): void {
  writeJson("auth.json", { authToken: client.authToken, savedAt: new Date().toISOString() });
}

export async function loginByQr(onQrUrl: (url: string) => Promise<void> | void): Promise<Client> {
  const client = await loginWithQR(
    {
      onReceiveQRUrl: onQrUrl,
      onPincodeRequest: (pin) => {
        console.log(`\n請在手機 LINE 上輸入這組認證碼：${pin}\n`);
      },
    },
    { device: DEVICE, storage: storage() },
  );
  saveAuth(client);
  return client;
}

/** 社群身分是否為管理員或副管理員（才能刪訊息、移出成員）。linejs 可能回傳名稱或數字。 */
export function isAdminRole(role: unknown): boolean {
  const r = String(role);
  return r === "ADMIN" || r === "CO_ADMIN" || r === "1" || r === "2";
}

export interface ChatInfo {
  mid: string;
  name: string;
  squareMid: string;
  /** 機器人在這個社群的身分：ADMIN、CO_ADMIN、MEMBER */
  role: string;
  /** 機器人在這個社群的成員 ID（p 開頭） */
  myMemberMid: string;
  /** 機器人是否還在這個社群裡（不是已退出、被踢、被封鎖或還在等審核） */
  joined: boolean;
}

/** 讀取聊天室名稱，以及機器人在所屬社群的身分。聊天室不存在或讀不到時會丟出錯誤。 */
export async function getChatInfo(client: Client, mid: string): Promise<ChatInfo> {
  const chat = await client.getSquareChat(mid);
  const square = await client.base.square.getSquare({ squareMid: chat.raw.squareMid });
  const me = square.myMembership;
  const state = String(me?.membershipState);
  return {
    mid,
    name: chat.raw.name,
    squareMid: chat.raw.squareMid,
    role: me ? String(me.role) : "?",
    myMemberMid: me?.squareMemberMid ?? "",
    joined: state === "JOINED" || state === "2",
  };
}

export async function loginSaved(): Promise<Client> {
  const auth = readJson<{ authToken?: string }>("auth.json", {});
  if (!auth.authToken) {
    throw new Error("還沒登入。請先執行：npm run login");
  }
  const client = await loginWithAuthToken(auth.authToken, { device: DEVICE, storage: storage() });
  saveAuth(client);
  return client;
}
