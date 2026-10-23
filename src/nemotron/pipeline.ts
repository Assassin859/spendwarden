import type { DecisionRecord, Evidence } from "@/domain/decision";
import type { PayoutProposal } from "@/domain/payout";
import type { HmemStore } from "@/memory/store";
import type { ExplanationClient, ModelExplanation } from "@/nemotron/client";
import { applyMemory } from "@/rules/apply-memory";
import { decide, type PayoutSources } from "@/rules/decide";

export type TraceStepName = "intake" | "plan" | "zetaris" | "rules" | "memory" | "model" | "gate";

export type TraceStep = {
  step: TraceStepName;
  detail: string;
};

export type Investigation = {
  decision: DecisionRecord;
  explanation: { reasons: string[]; citations: Evidence[] } | null;
  trace: TraceStep[];
};

const CHECK_ORDER =
  "flagged wallet, unknown recipient, duplicate invoice, new wallet, over cap, budget";

function sourceStatus(sources: PayoutSources): string {
  const names = ["policy", "payments", "vendor", "budget", "safeHistory"] as const;
  return names.map((name) => `${name} ${sources[name].status === "ok" ? "present" : "missing"}`).join(", ");
}

function summary(decision: DecisionRecord): string {
  return `${decision.decision} ${decision.confidence} ${decision.reasons[0] ?? ""}`.trim();
}

export async function investigate(
  payout: PayoutProposal,
  sources: PayoutSources,
  store: HmemStore,
  client: ExplanationClient | null,
): Promise<Investigation> {
  const ruled = decide(payout, sources);
  const decision = applyMemory(ruled, payout, store);
  const trace: TraceStep[] = [
    { step: "intake", detail: `${payout.id} ${payout.recipient} ${payout.amountUsd}` },
    { step: "plan", detail: CHECK_ORDER },
    { step: "zetaris", detail: sourceStatus(sources) },
    { step: "rules", detail: summary(ruled) },
    {
      step: "memory",
      detail:
        decision.memory_used.length > 0
          ? `cited ${decision.memory_used.map((item) => item.id).join(", ")}`
          : `kept ${ruled.decision}`,
    },
  ];

  let model: ModelExplanation | null = null;
  if (!client) {
    trace.push({ step: "model", detail: "explanation skipped" });
  } else {
    try {
      model = await client.explain({ payout, sources, decision });
      trace.push({
        step: "model",
        detail: model ? `explanation ${model.decision}` : "explanation skipped",
      });
    } catch {
      model = null;
      trace.push({ step: "model", detail: "explanation skipped" });
    }
  }

  if (!model) {
    trace.push({ step: "gate", detail: `kept ${decision.decision}` });
    return { decision, explanation: null, trace };
  }

  if (model.decision !== decision.decision) {
    trace.push({
      step: "gate",
      detail: `discarded model decision ${model.decision}; kept ${decision.decision}`,
    });
    return { decision, explanation: null, trace };
  }

  trace.push({ step: "gate", detail: `kept ${decision.decision}` });
  return {
    decision,
    explanation: { reasons: model.reasons, citations: model.citations },
    trace,
  };
}
