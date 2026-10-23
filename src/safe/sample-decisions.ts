import { readFileSync } from "node:fs";
import path from "node:path";

import type { DecisionRecord } from "@/domain/decision";
import type { PayoutProposal } from "@/domain/payout";
import { decide, type PayoutSources } from "@/rules/decide";
import type { SourceResult } from "@/zetaris/queries";

const KITE_KNOWN_WALLET = "0x3333333333333333333333333333333333333303";

function proposals(): PayoutProposal[] {
  const filePath = path.join(process.cwd(), "data", "sample", "proposed_payouts.json");
  return JSON.parse(readFileSync(filePath, "utf8")) as PayoutProposal[];
}

function proposal(id: string): PayoutProposal {
  const found = proposals().find((item) => item.id === id);
  if (!found) {
    throw new Error(`Missing proposal ${id}`);
  }
  return found;
}

function ok(source: string, rows: Record<string, string>[]): SourceResult {
  return { source, status: "ok", rows };
}

function missing(source: string): SourceResult {
  return { source, status: "missing" };
}

function sourcesFor(payout: PayoutProposal, walletStatus: "known" | "missing", knownWallet: string, payments: SourceResult): PayoutSources {
  return {
    policy: ok("policy", [
      {
        category: payout.category,
        per_tx_cap_usd: "10000",
        quarter_cap_usd: "40000",
        approved_vendors: payout.recipient,
        required_approvals: "1",
      },
    ]),
    payments,
    vendor: ok("vendor", [
      {
        vendor: payout.recipient,
        known_wallet: knownWallet,
        flagged: "false",
        flag_reason: "",
        payout_wallet: payout.wallet,
        wallet_status: walletStatus,
      },
    ]),
    budget: ok("budget", [
      {
        category: payout.category,
        quarter: "2026Q4",
        allocated_usd: "40000",
        spent_usd: "8000",
      },
    ]),
    safeHistory: missing("safe_history"),
  };
}

export function sampleCase(id: "pay-helios" | "pay-northline-dup" | "pay-kite-new-wallet"): {
  payout: PayoutProposal;
  decision: DecisionRecord;
} {
  const payout = proposal(id);
  if (id === "pay-northline-dup") {
    return {
      payout,
      decision: decide(payout, sourcesFor(payout, "known", payout.wallet, ok("payments", [{ invoice_id: payout.invoiceId }]))),
    };
  }
  if (id === "pay-kite-new-wallet") {
    return {
      payout,
      decision: decide(payout, sourcesFor(payout, "missing", KITE_KNOWN_WALLET, missing("payments"))),
    };
  }
  return {
    payout,
    decision: decide(payout, sourcesFor(payout, "known", payout.wallet, missing("payments"))),
  };
}
