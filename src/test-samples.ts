/**
 * 用範例訊息測試偵測準確度，不需要登入 LINE。
 *   npm run test:rules              只測規則（免費）
 *   npm run test:ai                 規則 + AI（需要 ANTHROPIC_API_KEY，會產生少量費用）
 *   npm run test:ai -- --model claude-haiku-5-5   換模型比較
 *   npm run test:ai -- --file samples/my-samples.jsonl
 */
import fs from "node:fs";
import { ScamClassifier } from "./classifier.js";
import { loadConfig } from "./config.js";
import { decide } from "./engine.js";

interface Sample {
  label: "scam" | "ok";
  text: string;
  name?: string;
  days?: number;
}

const args = process.argv.slice(2);
const useAi = args.includes("--ai");
const file = args.includes("--file") ? args[args.indexOf("--file") + 1] : "samples/samples.jsonl";
const cfg = loadConfig();
if (args.includes("--model")) cfg.model = args[args.indexOf("--model") + 1];

const samples = fs
  .readFileSync(file, "utf-8")
  .split(/\r?\n/)
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l) as Sample);

const adminNames = ["阿忠", "管理員"];
const classifier = useAi ? new ScamClassifier(cfg.model) : null;

let tp = 0, fp = 0, fn = 0, tn = 0, flagged = 0;
const started = Date.now();
console.log(`測試 ${samples.length} 則｜${useAi ? `規則 + AI（${cfg.model}）` : "只用規則"}\n`);

for (const s of samples) {
  const d = await decide(
    {
      text: s.text,
      contentType: "NONE",
      displayName: s.name ?? "成員",
      memberDays: s.days ?? null,
      duplicateSenders: 1,
      qrTexts: [],
      context: [],
    },
    cfg,
    adminNames,
    classifier,
  );
  const predictedScam = d.verdict === "scam";
  if (d.verdict === "suspicious") flagged++;
  if (s.label === "scam" && predictedScam) tp++;
  else if (s.label === "ok" && predictedScam) fp++;
  else if (s.label === "scam") fn++;
  else tn++;

  const correct = (s.label === "scam") === predictedScam;
  const act = d.actions.length ? d.actions.join("+") : "-";
  console.log(
    `${correct ? "✓" : "✗"} [答案 ${s.label.padEnd(4)}] → ${d.verdict.padEnd(10)} ${d.confidence.toFixed(2)} ` +
      `規則${d.ruleScore.toFixed(2)} ${d.source.padEnd(14)} 動作:${act.padEnd(20)} ${s.text.slice(0, 36)}`,
  );
  if (!correct || args.includes("--verbose")) {
    console.log(`     跡象：${d.signals.join("；") || "無"}${d.reason ? `｜理由：${d.reason}` : ""}`);
  }
}

const scams = tp + fn;
const oks = tn + fp;
console.log(`\n抓到詐騙：${tp}/${scams}（漏掉 ${fn}）`);
console.log(`誤判正常訊息為詐騙：${fp}/${oks}`);
console.log(`標記「可疑、交給人工」：${flagged} 則`);
console.log(`耗時 ${((Date.now() - started) / 1000).toFixed(1)} 秒`);
