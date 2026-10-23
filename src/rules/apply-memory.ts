import type { DecisionRecord } from "@/domain/decision";
import type { PayoutProposal } from "@/domain/payout";
import type { HmemStore } from "@/memory/store";

const OVER_CAP = new Set(["over per-tx cap", "over quarter cap"]);

export function applyMemory(
  decision: DecisionRecord,
  payout: PayoutProposal,
  store: HmemStore,
): DecisionRecord {
  if (decision.decision !== "ESCALATE" || !decision.reasons.some((reason) => OVER_CAP.has(reason))) {
    return decision;
  }

  const memory = store.findException(payout.recipient, payout.category);
  if (!memory) {
    return decision;
  }

  return {
    ...decision,
    decision: "APPROVE",
    confidence: 0.8,
    memory_used: [{ id: memory.id, content: memory.content, source: memory.source }],
  };
}
