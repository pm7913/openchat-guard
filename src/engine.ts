import type { GuardConfig } from "./config.js";
import type { ScamClassifier, Verdict } from "./classifier.js";
import { evaluateRules } from "./rules.js";

export interface MessageInput {
  text: string;
  contentType: string;
  displayName: string;
  memberDays: number | null;
  duplicateSenders: number;
  qrTexts: string[];
  imageJpegBase64?: string;
  context: { name: string; text: string }[];
}

export type Action = "delete" | "remove" | "notify";

export interface Decision {
  verdict: Verdict["verdict"];
  confidence: number;
  actions: Action[];
  tactic: string;
  reason: string;
  signals: string[];
  ruleScore: number;
  source: "rules" | "ai" | "rules-fallback" | "skipped";
  isNewMember: boolean;
}

export async function decide(
  input: MessageInput,
  cfg: GuardConfig,
  adminNames: string[],
  classifier: ScamClassifier | null,
): Promise<Decision> {
  const rules = evaluateRules({
    text: input.text,
    contentType: input.contentType,
    qrTexts: input.qrTexts,
    displayName: input.displayName,
    memberDays: input.memberDays,
    newMemberDays: cfg.newMemberDays,
    adminNames,
    duplicateSenders: input.duplicateSenders,
    extraKeywords: cfg.extraKeywords,
    ignoreKeywords: cfg.ignoreKeywords,
  });
  const base = { signals: rules.signals, ruleScore: rules.score, isNewMember: rules.isNewMember };

  let verdict: Verdict;
  let source: Decision["source"];

  if (rules.score >= cfg.ruleOnlyScore) {
    verdict = { verdict: "scam", confidence: rules.score, tactic: "規則直接判定", reason: rules.signals.join("；") };
    source = "rules";
  } else {
    const shouldAsk =
      cfg.llmGate === "all" ||
      rules.score >= cfg.llmScoreGate ||
      rules.hasUrl ||
      !!input.imageJpegBase64 ||
      input.contentType === "CONTACT" ||
      (rules.isNewMember && input.text.length >= 15) ||
      input.text.length >= cfg.llmMinLengthForReview;

    const ai = shouldAsk && classifier
      ? await classifier.classify({
          text: input.text,
          normalizedText: rules.normalized,
          contentType: input.contentType,
          displayName: input.displayName,
          memberDays: input.memberDays,
          ruleSignals: rules.signals,
          qrTexts: input.qrTexts,
          context: input.context,
          imageJpegBase64: input.imageJpegBase64,
        })
      : null;

    if (ai) {
      verdict = ai;
      source = "ai";
      // AI 說正常但規則分數很高：不自動處理，交給人工
      if (ai.verdict === "ok" && rules.score >= 0.7) {
        verdict = { ...ai, verdict: "suspicious", confidence: 0.5, reason: `AI 判斷正常，但規則分數 ${rules.score.toFixed(2)}：${ai.reason}` };
      }
    } else if (shouldAsk && classifier) {
      // AI 失敗：規則分數夠高就通知人工，不自動處理
      verdict = rules.score >= 0.5
        ? { verdict: "suspicious", confidence: rules.score, tactic: "AI 無法判斷", reason: rules.signals.join("；") }
        : { verdict: "ok", confidence: 0, tactic: "無", reason: "AI 無法判斷，規則分數低" };
      source = "rules-fallback";
    } else if (!classifier && rules.score >= cfg.llmScoreGate) {
      // 未設定 AI（例如離線測試規則）：用規則分數當結果
      verdict = {
        verdict: rules.score >= 0.6 ? "scam" : "suspicious",
        confidence: rules.score,
        tactic: "僅規則",
        reason: rules.signals.join("；"),
      };
      source = "rules";
    } else {
      return { ...base, verdict: "ok", confidence: 0, actions: [], tactic: "無", reason: "", source: "skipped" };
    }
  }

  const actions: Action[] = [];
  if (verdict.verdict === "scam") {
    if (verdict.confidence >= cfg.thresholds.delete) actions.push("delete");
    const removeAt = rules.isNewMember ? cfg.thresholds.removeNewMember : cfg.thresholds.remove;
    if (verdict.confidence >= removeAt) actions.push("remove");
  }
  if (verdict.verdict !== "ok") actions.push("notify");

  return { ...base, verdict: verdict.verdict, confidence: verdict.confidence, actions, tactic: verdict.tactic, reason: verdict.reason, source };
}
