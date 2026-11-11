import QRCode from "qrcode";

const WHITE_BG_BLACK_FG = "\x1b[47m\x1b[30m";
const RESET = "\x1b[0m";

/**
 * 把文字畫成可以在終端機（SSH）直接用手機掃的 QR Code。
 * 一個字元代表上下兩格，並明確指定白底黑字，所以深色背景的終端機也掃得到。
 * margin 是四周留白的格數；手機至少需要 2 格才好對焦。
 */
export function terminalQr(text: string, margin = 2): string {
  const { size, data } = QRCode.create(text, { errorCorrectionLevel: "M" }).modules;
  const dark = (x: number, y: number) => x >= 0 && y >= 0 && x < size && y < size && !!data[y * size + x];
  const lines: string[] = [];
  for (let y = -margin; y < size + margin; y += 2) {
    let line = WHITE_BG_BLACK_FG;
    for (let x = -margin; x < size + margin; x++) {
      const top = dark(x, y);
      const bottom = dark(x, y + 1);
      line += top && bottom ? "█" : top ? "▀" : bottom ? "▄" : " ";
    }
    lines.push(line + RESET);
  }
  return lines.join("\n");
}
