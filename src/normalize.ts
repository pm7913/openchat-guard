/**
 * 把各種「變形寫法」還原成標準文字，讓規則比對不會被繞過。
 * - 全形 → 半形、圈圈數字 → 數字（NFKC）
 * - 刪除零寬字元、方向控制字元
 * - 外文假字母（西里爾、希臘）→ 英文字母
 * - 常見諧音／代稱 → 標準詞（例：賴 → line）
 */

const INVISIBLE = /[­͏؜ᅟᅠ឴឵᠋-᠏​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ]/g;

const HOMOGLYPHS: Record<string, string> = {
  // Cyrillic
  а: "a", в: "b", е: "e", ё: "e", к: "k", м: "m", н: "h", о: "o", р: "p", с: "c", т: "t", у: "y", х: "x",
  і: "i", ї: "i", ј: "j", ӏ: "l", ԁ: "d", ԛ: "q", ԝ: "w", ѕ: "s", ү: "y", һ: "h",
  // Greek
  α: "a", β: "b", ε: "e", η: "n", ι: "i", κ: "k", ν: "v", ο: "o", ρ: "p", τ: "t", υ: "u", χ: "x", ω: "w",
  // 其他常見混淆
  "ı": "i", "ɩ": "i", "ʟ": "l", "ɴ": "n", "ᴇ": "e", "ʀ": "r", "ᴏ": "o", "ꓲ": "i", "ꓡ": "l", "ꓠ": "n", "ꓰ": "e",
};

/** 諧音、代稱 → 標準詞。順序重要：長的放前面。 */
const ALIASES: [RegExp, string][] = [
  [/l[i1l|!ı]n[e3]|ㄌㄞ|賴|赖|籟|癩|瀨|萊恩|lain|來恩/g, "line"],
  [/[vw]信|威信|薇信|徽信|微訫|vx|wx|wechat/g, "wechat"],
  [/telegram|紙飛機|纸飞机|飛機群|电报|電報|\btg\b/g, "telegram"],
  [/飆股|飙股|標股|镖股|彪股|飇股/g, "飆股"],
  [/老師|老师|老溼|老濕|佬師|姥師/g, "老師"],
  [/助理|助裡|助哩|小助手/g, "助理"],
  [/私訊|私信|私聊|私我|私你|私妳|密我|密你|私密我|敲我|私下聯繫|私下联系/g, "私訊"],
  [/穩賺|稳赚|穩賺不賠|穩定獲利|稳定获利/g, "穩賺"],
  [/内線|內線|内线|內幕|内幕/g, "內線"],
  [/帶單|带单|跟單|跟单|喊單|喊单/g, "帶單"],
];

export function normalizeText(input: string): string {
  let s = (input ?? "").normalize("NFKC").replace(INVISIBLE, "").toLowerCase();
  s = Array.from(s, (ch) => HOMOGLYPHS[ch] ?? ch).join("");
  return s;
}

/** 去掉空白、標點、表情符號，只留字母、數字、中日韓文字。用來抓「飆 . 股」「加 😀 賴」這類穿插。 */
export function compactText(normalized: string): string {
  // 符號代字：➕＝加、🆔＝id
  let s = normalized.replace(/[+＋➕✚]/gu, "加").replace(/🆔/gu, "id");
  s = s.replace(/[^\p{L}\p{N}]+/gu, "");
  for (const [re, to] of ALIASES) s = s.replace(re, to);
  return s;
}

/** 名稱比對用：正規化後只留字母、數字、中文。 */
export function nameKey(name: string): string {
  return compactText(normalizeText(name));
}

/** 兩個字串的相似度（0~1），用來抓假冒管理員的暱稱。 */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)] as number[]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return 1 - dp[m][n] / Math.max(m, n);
}
