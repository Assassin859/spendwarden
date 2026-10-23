import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import type { DecisionName } from "@/domain/decision";
import type { PayoutProposal } from "@/domain/payout";
import { HmemStore } from "@/memory/store";
import type { ExplanationClient, ModelExplanation } from "@/nemotron/client";
import { investigate } from "@/nemotron/pipeline";
import type { PayoutSources } from "@/rules/decide";
import type { SourceResult } from "@/zetaris/queries";

const proposals = JSON.parse(
  readFileSync(path.join(process.cwd(), "data", "sample", "proposed_payouts.json"), "utf8"),
) as PayoutProposal[];

function proposal(id: string): PayoutProposal {
  const found = proposals.find((item) => item.id === id);
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

function sourcesFor(payout: PayoutProposal, caps: { perTx: number; quarter: number }, spent: number, allocated: number): PayoutSources {
  return {
    policy: ok("policy", [
      {
        category: payout.category,
        per_tx_cap_usd: String(caps.perTx),
        quarter_cap_usd: String(caps.quarter),
        approved_vendors: payout.recipient,
        required_approvals: "1",
      },
    ]),
    payments: missing("payments"),
    vendor: ok("vendor", [
      {
        vendor: payout.recipient,
        known_wallet: payout.wallet,
        flagged: "false",
        flag_reason: "",
        payout_wallet: payout.wallet,
        wallet_status: "known",
      },
    ]),
    budget: ok("budget", [
      {
        category: payout.category,
        quarter: "2026Q4",
        allocated_usd: String(allocated),
        spent_usd: String(spent),
      },
    ]),
    safeHistory: missing("safe_history"),
  };
}

function stub(decision: DecisionName): ExplanationClient {
  return {
    async explain(): Promise<ModelExplanation> {
      return {
        decision,
        reasons: [`model says ${decision}`],
        citations: [{ source: "policy", ref: "model" }],
      };
    },
  };
}

function throwingClient(): ExplanationClient {
  return {
    async explain(): Promise<ModelExplanation> {
      throw new Error("Meterless is down");
    },
  };
}

describe("investigate", () => {
  it("keeps the clean Helios approval and records the model and gate", async () => {
    const payout = proposal("pay-helios");
    const result = await investigate(
      payout,
      sourcesFor(payout, { perTx: 10000, quarter: 40000 }, 8000, 40000),
      new HmemStore(),
      stub("APPROVE"),
    );
    assert.equal(result.decision.decision, "APPROVE");
    assert.equal(result.decision.confidence, 0.9);
    assert.deepEqual(result.decision.reasons, ["within policy"]);
    assert.deepEqual(result.explanation?.reasons, ["model says APPROVE"]);
    assert.ok(result.trace.some((step) => step.step === "model"));
    assert.ok(result.trace.some((step) => step.step === "gate"));
  });

  it("keeps the Northline duplicate blocked when the model says approve", async () => {
    const payout = proposal("pay-northline-dup");
    const sources = sourcesFor(payout, { perTx: 15000, quarter: 30000 }, 12000, 30000);
    sources.payments = ok("payments", [{ invoice_id: payout.invoiceId, vendor: payout.recipient }]);
    const result = await investigate(payout, sources, new HmemStore(), stub("APPROVE"));
    assert.equal(result.decision.decision, "BLOCK");
    assert.equal(result.decision.confidence, 0.99);
    assert.deepEqual(result.decision.reasons, ["duplicate invoice"]);
    assert.equal(result.explanation, null);
    const gate = result.trace.find((step) => step.step === "gate");
    assert.ok(gate?.detail.includes("discarded"));
    assert.ok(result.trace.some((step) => step.step === "model"));
  });

  it("keeps the Helios approval when the explanation is skipped", async () => {
    const payout = proposal("pay-helios");
    const result = await investigate(
      payout,
      sourcesFor(payout, { perTx: 10000, quarter: 40000 }, 8000, 40000),
      new HmemStore(),
      throwingClient(),
    );
    assert.equal(result.decision.decision, "APPROVE");
    assert.deepEqual(result.decision.reasons, ["within policy"]);
    const model = result.trace.find((step) => step.step === "model");
    assert.equal(model?.detail, "explanation skipped");
  });
});
