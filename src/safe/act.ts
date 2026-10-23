import type { DecisionRecord } from "@/domain/decision";
import type { PayoutProposal } from "@/domain/payout";

export const USDC_SEPOLIA_ADDRESS = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";

export type TokenTransferRequest = {
  to: string;
  amountUsd: number;
  token: string;
};

export type ProposedTransfer = {
  safeTxHash: string;
  url: string;
  confirmations: number;
  threshold: number;
};

export type SafeProposer = {
  threshold: () => Promise<number>;
  proposeTokenTransfer: (request: TokenTransferRequest) => Promise<ProposedTransfer>;
};

export type PayoutAction = {
  decision: DecisionRecord;
  safeTxUrl: string | null;
  reviewQuestion: string | null;
  incidentNote: string | null;
};

export function reviewQuestion(payout: PayoutProposal, reason: string): string {
  if (reason === "new wallet") {
    return `Approve the new wallet ${payout.wallet} for ${payout.recipient}?`;
  }
  if (reason === "over per-tx cap") {
    return `Approve ${payout.recipient} above the ${payout.category} per-transaction cap?`;
  }
  if (reason === "over quarter cap") {
    return `Approve ${payout.recipient} above the ${payout.category} quarter cap?`;
  }
  if (reason === "budget exhausted") {
    return `Approve ${payout.recipient} after the ${payout.category} budget is exhausted?`;
  }
  if (reason === "budget missing") {
    return `Approve ${payout.recipient} without a ${payout.category} budget?`;
  }
  return `Approve this ${payout.category} payout to ${payout.recipient}?`;
}

function copyDecision(decision: DecisionRecord): DecisionRecord {
  return {
    decision: decision.decision,
    confidence: decision.confidence,
    reasons: [...decision.reasons],
    evidence: decision.evidence.map((item) => ({ ...item })),
    memory_used: decision.memory_used.map((item) => ({ ...item })),
  };
}

export async function act(
  payout: PayoutProposal,
  decision: DecisionRecord,
  proposer: SafeProposer | null,
): Promise<PayoutAction> {
  const copied = copyDecision(decision);

  if (copied.decision === "BLOCK") {
    const reason = copied.reasons[0] ?? "blocked";
    return {
      decision: copied,
      safeTxUrl: null,
      reviewQuestion: null,
      incidentNote: `Incident ${payout.id}: ${reason}.`,
    };
  }

  if (copied.decision === "ESCALATE") {
    return {
      decision: copied,
      safeTxUrl: null,
      reviewQuestion: reviewQuestion(payout, copied.reasons[0] ?? ""),
      incidentNote: null,
    };
  }

  if (!proposer) {
    throw new Error("Missing SAFE_ADDRESS");
  }

  const threshold = await proposer.threshold();
  if (!(threshold > 1)) {
    throw new Error("Safe threshold must be greater than 1");
  }

  const proposed = await proposer.proposeTokenTransfer({
    to: payout.wallet,
    amountUsd: payout.amountUsd,
    token: USDC_SEPOLIA_ADDRESS,
  });

  copied.evidence.push({ source: "safe", ref: proposed.url });
  return {
    decision: copied,
    safeTxUrl: proposed.url,
    reviewQuestion: null,
    incidentNote: null,
  };
}
