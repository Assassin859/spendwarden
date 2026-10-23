import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import type { PayoutProposal } from "@/domain/payout";
import { decide, type PayoutSources } from "@/rules/decide";
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

function policyRow(input: {
  category: string;
  perTx: number;
  quarter: number;
  approved: string;
}): Record<string, string> {
  return {
    category: input.category,
    per_tx_cap_usd: String(input.perTx),
    quarter_cap_usd: String(input.quarter),
    approved_vendors: input.approved,
    required_approvals: "1",
  };
}

function vendorRow(input: {
  vendor: string;
  knownWallet: string;
  payoutWallet: string;
  flagged?: string;
  walletStatus: "known" | "missing";
}): Record<string, string> {
  return {
    vendor: input.vendor,
    known_wallet: input.knownWallet,
    flagged: input.flagged ?? "false",
    flag_reason: input.flagged === "true" ? "sample flagged wallet" : "",
    payout_wallet: input.payoutWallet,
    wallet_status: input.walletStatus,
  };
}

function budgetRow(spent: number, allocated: number): Record<string, string> {
  return {
    category: "infrastructure",
    quarter: "2026Q4",
    allocated_usd: String(allocated),
    spent_usd: String(spent),
  };
}

function sources(input: Partial<PayoutSources> & Pick<PayoutSources, "policy" | "vendor" | "budget"> & {
  payments?: SourceResult;
}): PayoutSources {
  return {
    policy: input.policy,
    payments: input.payments ?? missing("payments"),
    vendor: input.vendor,
    budget: input.budget,
    safeHistory: input.safeHistory ?? missing("safe_history"),
  };
}

function knownVendor(payout: PayoutProposal, caps: { perTx: number; quarter: number }, spent: number, allocated: number) {
  return sources({
    policy: ok("policy", [
      policyRow({
        category: payout.category,
        perTx: caps.perTx,
        quarter: caps.quarter,
        approved: payout.recipient,
      }),
    ]),
    vendor: ok("vendor", [
      vendorRow({
        vendor: payout.recipient,
        knownWallet: payout.wallet,
        payoutWallet: payout.wallet,
        walletStatus: "known",
      }),
    ]),
    budget: ok("budget", [budgetRow(spent, allocated)]),
  });
}

describe("decide", () => {
  it("approves the clean Helios payout", () => {
    const payout = proposal("pay-helios");
    const result = decide(payout, knownVendor(payout, { perTx: 10000, quarter: 40000 }, 8000, 40000));
    assert.equal(result.decision, "APPROVE");
    assert.equal(result.confidence, 0.9);
    assert.deepEqual(result.reasons, ["within policy"]);
    assert.deepEqual(result.memory_used, []);
  });

  it("blocks the Northline invoice that is already paid", () => {
    const payout = proposal("pay-northline-dup");
    const result = decide(
      payout,
      sources({
        ...knownVendor(payout, { perTx: 15000, quarter: 30000 }, 12000, 30000),
        payments: ok("payments", [
          {
            payment_id: "pay_hist_002",
            invoice_id: "INV-2026-0912",
            vendor: "Northline Audit",
          },
        ]),
      }),
    );
    assert.equal(result.decision, "BLOCK");
    assert.equal(result.confidence, 0.99);
    assert.deepEqual(result.reasons, ["duplicate invoice"]);
    assert.deepEqual(result.evidence, [{ source: "payments", ref: "INV-2026-0912" }]);
  });

  it("escalates Kite's new wallet and keeps the known wallet", () => {
    const payout = proposal("pay-kite-new-wallet");
    const known = "0x3333333333333333333333333333333333333303";
    const result = decide(
      payout,
      sources({
        policy: ok("policy", [
          policyRow({
            category: "operations",
            perTx: 5000,
            quarter: 20000,
            approved: "Kite Supplies",
          }),
        ]),
        vendor: ok("vendor", [
          vendorRow({
            vendor: "Kite Supplies",
            knownWallet: known,
            payoutWallet: payout.wallet,
            walletStatus: "missing",
          }),
        ]),
        budget: ok("budget", [budgetRow(4500, 20000)]),
      }),
    );
    assert.equal(result.decision, "ESCALATE");
    assert.equal(result.confidence, 0.85);
    assert.deepEqual(result.reasons, ["new wallet"]);
    assert.deepEqual(result.evidence, [
      { source: "vendor", ref: payout.wallet },
      { source: "vendor", ref: known },
    ]);
  });

  it("escalates Orbit and Pylon for the per-tx cap", () => {
    const orbit = proposal("pay-orbit-over-cap");
    const pylon = proposal("pay-pylon-over-cap");
    const orbitResult = decide(orbit, knownVendor(orbit, { perTx: 5000, quarter: 20000 }, 0, 20000));
    const pylonResult = decide(pylon, knownVendor(pylon, { perTx: 4000, quarter: 15000 }, 0, 15000));
    assert.equal(orbitResult.decision, "ESCALATE");
    assert.deepEqual(orbitResult.reasons, ["over per-tx cap"]);
    assert.equal(orbitResult.confidence, 0.8);
    assert.equal(pylonResult.decision, "ESCALATE");
    assert.deepEqual(pylonResult.reasons, ["over per-tx cap"]);
  });

  it("blocks a flagged wallet before any other check", () => {
    const payout = proposal("pay-helios");
    const flagged = {
      ...payout,
      recipient: "Shadow Relay",
      wallet: "0x6666666666666666666666666666666666666606",
    };
    const result = decide(
      flagged,
      sources({
        policy: ok("policy", [
          policyRow({
            category: "infrastructure",
            perTx: 10000,
            quarter: 40000,
            approved: "Shadow Relay",
          }),
        ]),
        vendor: ok("vendor", [
          vendorRow({
            vendor: "Shadow Relay",
            knownWallet: flagged.wallet,
            payoutWallet: flagged.wallet,
            flagged: "true",
            walletStatus: "known",
          }),
        ]),
        budget: ok("budget", [budgetRow(0, 40000)]),
      }),
    );
    assert.equal(result.decision, "BLOCK");
    assert.equal(result.confidence, 0.99);
    assert.deepEqual(result.reasons, ["flagged wallet"]);
    assert.deepEqual(result.evidence, [{ source: "vendor", ref: flagged.wallet }]);
  });

  it("blocks an unknown recipient", () => {
    const payout = { ...proposal("pay-helios"), recipient: "Nobody Ltd", invoiceId: "INV-2026-2001" };
    const result = decide(
      payout,
      sources({
        policy: ok("policy", [
          policyRow({
            category: "infrastructure",
            perTx: 10000,
            quarter: 40000,
            approved: "Helios Cloud",
          }),
        ]),
        vendor: missing("vendor"),
        budget: ok("budget", [budgetRow(0, 40000)]),
      }),
    );
    assert.equal(result.decision, "BLOCK");
    assert.equal(result.confidence, 0.95);
    assert.deepEqual(result.reasons, ["unknown recipient"]);
  });

  it("blocks a recipient who is outside the approved vendor", () => {
    const payout = { ...proposal("pay-helios"), category: "audit", invoiceId: "INV-2026-2002" };
    const result = decide(
      payout,
      sources({
        policy: ok("policy", [
          policyRow({
            category: "audit",
            perTx: 15000,
            quarter: 30000,
            approved: "Northline Audit",
          }),
        ]),
        vendor: ok("vendor", [
          vendorRow({
            vendor: payout.recipient,
            knownWallet: payout.wallet,
            payoutWallet: payout.wallet,
            walletStatus: "known",
          }),
        ]),
        budget: ok("budget", [budgetRow(0, 30000)]),
      }),
    );
    assert.equal(result.decision, "BLOCK");
    assert.equal(result.confidence, 0.95);
    assert.deepEqual(result.reasons, ["no policy path"]);
  });

  it("escalates a quarter-cap breach that is still under the per-tx cap", () => {
    const payout = { ...proposal("pay-helios"), amountUsd: 3000, invoiceId: "INV-2026-2003" };
    const result = decide(payout, knownVendor(payout, { perTx: 10000, quarter: 20000 }, 18000, 50000));
    assert.equal(result.decision, "ESCALATE");
    assert.equal(result.confidence, 0.8);
    assert.deepEqual(result.reasons, ["over quarter cap"]);
  });

  it("escalates an exhausted budget when the amount is under both caps", () => {
    const payout = { ...proposal("pay-helios"), amountUsd: 2000, invoiceId: "INV-2026-2004" };
    const result = decide(payout, knownVendor(payout, { perTx: 5000, quarter: 40000 }, 19000, 20000));
    assert.equal(result.decision, "ESCALATE");
    assert.equal(result.confidence, 0.8);
    assert.deepEqual(result.reasons, ["budget exhausted"]);
  });

  it("keeps a duplicate invoice blocked when the wallet is also new", () => {
    const payout = proposal("pay-kite-new-wallet");
    const base = sources({
      policy: ok("policy", [
        policyRow({ category: "operations", perTx: 5000, quarter: 20000, approved: "Kite Supplies" }),
      ]),
      vendor: ok("vendor", [
        vendorRow({
          vendor: "Kite Supplies",
          knownWallet: "0x3333333333333333333333333333333333333303",
          payoutWallet: payout.wallet,
          walletStatus: "missing",
        }),
      ]),
      budget: ok("budget", [budgetRow(4500, 20000)]),
      payments: ok("payments", [{ invoice_id: payout.invoiceId }]),
    });
    const result = decide(payout, base);
    assert.deepEqual(result.reasons, ["duplicate invoice"]);
    assert.equal(result.decision, "BLOCK");
  });

  it("keeps the over-cap reason when the budget would also fail", () => {
    const payout = proposal("pay-orbit-over-cap");
    const result = decide(payout, knownVendor(payout, { perTx: 5000, quarter: 20000 }, 19000, 20000));
    assert.deepEqual(result.reasons, ["over per-tx cap"]);
  });

  it("returns the same JSON on a second run", () => {
    const payout = proposal("pay-helios");
    const input = knownVendor(payout, { perTx: 10000, quarter: 40000 }, 8000, 40000);
    assert.deepEqual(decide(payout, input), decide(payout, input));
  });
});
