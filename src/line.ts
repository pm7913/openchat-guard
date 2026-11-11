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

export async function loginSaved(): Promise<Client> {
  const auth = readJson<{ authToken?: string }>("auth.json", {});
  if (!auth.authToken) {
    throw new Error("還沒登入。請先執行：npm run login");
  }
  const client = await loginWithAuthToken(auth.authToken, { device: DEVICE, storage: storage() });
  saveAuth(client);
  return client;
}
