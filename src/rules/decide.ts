import type { DecisionRecord } from "@/domain/decision";
import type { PayoutProposal } from "@/domain/payout";
import type { SourceResult } from "@/zetaris/queries";

export type PayoutSources = {
  policy: SourceResult;
  payments: SourceResult;
  vendor: SourceResult;
  budget: SourceResult;
  safeHistory: SourceResult;
};

const QUARTER = "2026Q4";

function rows(result: SourceResult): Record<string, string>[] {
  return result.status === "ok" ? result.rows : [];
}

function numberValue(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function record(
  decision: DecisionRecord["decision"],
  confidence: number,
  reason: string,
  evidence: DecisionRecord["evidence"],
): DecisionRecord {
  return {
    decision,
    confidence,
    reasons: [reason],
    evidence,
    memory_used: [],
  };
}

export function decide(payout: PayoutProposal, sources: PayoutSources): DecisionRecord {
  const vendorRows = rows(sources.vendor);
  if (vendorRows.some((row) => row.flagged?.toLowerCase() === "true")) {
    return record("BLOCK", 0.99, "flagged wallet", [{ source: "vendor", ref: payout.wallet }]);
  }

  const vendor = vendorRows[0];
  const knownWallet = vendor?.known_wallet?.trim() ?? "";
  if (!vendor || knownWallet.length === 0) {
    return record("BLOCK", 0.95, "unknown recipient", [{ source: "vendor", ref: payout.recipient }]);
  }

  const policy = rows(sources.policy)[0];
  const perTxCap = numberValue(policy?.per_tx_cap_usd);
  const quarterCap = numberValue(policy?.quarter_cap_usd);
  if (
    !policy ||
    policy.approved_vendors.trim() !== payout.recipient ||
    !Number.isFinite(perTxCap) ||
    !Number.isFinite(quarterCap)
  ) {
    return record("BLOCK", 0.95, "no policy path", [{ source: "policy", ref: payout.category }]);
  }

  if (sources.payments.status === "ok" && sources.payments.rows.length > 0) {
    return record("BLOCK", 0.99, "duplicate invoice", [{ source: "payments", ref: payout.invoiceId }]);
  }

  if (vendor.wallet_status === "missing") {
    return record("ESCALATE", 0.85, "new wallet", [
      { source: "vendor", ref: payout.wallet },
      { source: "vendor", ref: knownWallet },
    ]);
  }

  const budget = rows(sources.budget).find((row) => row.quarter === QUARTER);
  const spent = numberValue(budget?.spent_usd);
  if (payout.amountUsd > perTxCap) {
    return record("ESCALATE", 0.8, "over per-tx cap", [{ source: "policy", ref: String(perTxCap) }]);
  }
  if (Number.isFinite(spent) && payout.amountUsd + spent > quarterCap) {
    return record("ESCALATE", 0.8, "over quarter cap", [{ source: "policy", ref: String(quarterCap) }]);
  }

  const allocated = numberValue(budget?.allocated_usd);
  if (!budget || !Number.isFinite(spent) || !Number.isFinite(allocated)) {
    return record("ESCALATE", 0.8, "budget missing", [{ source: "budget", ref: QUARTER }]);
  }
  if (spent + payout.amountUsd > allocated) {
    return record("ESCALATE", 0.8, "budget exhausted", [
      { source: "budget", ref: `${spent} of ${allocated}` },
    ]);
  }

  return record("APPROVE", 0.9, "within policy", [{ source: "policy", ref: payout.category }]);
}
