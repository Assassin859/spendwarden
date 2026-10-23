import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import type { PayoutProposal } from "@/domain/payout";
import { HmemStore } from "@/memory/store";
import { applyMemory } from "@/rules/apply-memory";
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

function withinPolicy(payout: PayoutProposal, caps: { perTx: number; quarter: number }, spent: number, allocated: number): PayoutSources {
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

const SIGNER = "signer-1";
const ORBIT_SENTENCE = "Orbit Legal may exceed cap in 2026Q4";

function store(): HmemStore {
  return new HmemStore({ clock: () => 1_700_000_000_000 });
}

describe("exceptions", () => {
  it("escalates Orbit while the store is empty", () => {
    const payout = proposal("pay-orbit-over-cap");
    const decision = applyMemory(
      decide(payout, withinPolicy(payout, { perTx: 5000, quarter: 20000 }, 0, 20000)),
      payout,
      store(),
    );
    assert.equal(decision.decision, "ESCALATE");
    assert.deepEqual(decision.reasons, ["over per-tx cap"]);
    assert.deepEqual(decision.memory_used, []);
  });

  it("approves Orbit after a signer exception and still escalates Pylon", () => {
    const orbit = proposal("pay-orbit-over-cap");
    const pylon = proposal("pay-pylon-over-cap");
    const memory = store();
    const written = memory.writeException({
      content: ORBIT_SENTENCE,
      signerId: SIGNER,
      vendor: orbit.recipient,
      wallet: orbit.wallet,
      category: orbit.category,
    });

    const orbitDecision = applyMemory(
      decide(orbit, withinPolicy(orbit, { perTx: 5000, quarter: 20000 }, 0, 20000)),
      orbit,
      memory,
    );
    assert.equal(orbitDecision.decision, "APPROVE");
    assert.equal(orbitDecision.confidence, 0.8);
    assert.deepEqual(orbitDecision.reasons, ["over per-tx cap"]);
    assert.deepEqual(orbitDecision.memory_used, [
      { id: written.id, content: ORBIT_SENTENCE, source: `signer:${SIGNER}` },
    ]);
    assert.equal(memory.ledger.length, 1);
    assert.equal(memory.ledger[0]?.action, "create");
    assert.equal(memory.ledger[0]?.actor, SIGNER);
    assert.equal(memory.ledger[0]?.memoryId, written.id);
    assert.equal(memory.ledger[0]?.newState.content, ORBIT_SENTENCE);

    const pylonDecision = applyMemory(
      decide(pylon, withinPolicy(pylon, { perTx: 4000, quarter: 15000 }, 0, 15000)),
      pylon,
      memory,
    );
    assert.equal(pylonDecision.decision, "ESCALATE");
    assert.deepEqual(pylonDecision.memory_used, []);
  });

  it("keeps a duplicate invoice blocked when that vendor has an exception", () => {
    const payout = proposal("pay-northline-dup");
    const memory = store();
    memory.writeException({
      content: "Northline Audit may exceed cap in 2026Q4",
      signerId: SIGNER,
      vendor: payout.recipient,
      wallet: payout.wallet,
      category: payout.category,
    });
    const sources = withinPolicy(payout, { perTx: 15000, quarter: 30000 }, 12000, 30000);
    sources.payments = ok("payments", [{ invoice_id: payout.invoiceId, vendor: payout.recipient }]);
    const decision = applyMemory(decide(payout, sources), payout, memory);
    assert.equal(decision.decision, "BLOCK");
    assert.deepEqual(decision.reasons, ["duplicate invoice"]);
    assert.deepEqual(decision.memory_used, []);
  });

  it("rejects a write with no source", () => {
    assert.throws(
      () =>
        store().writeException({
          content: ORBIT_SENTENCE,
          signerId: "",
          vendor: "Orbit Legal",
          wallet: "0x4444444444444444444444444444444444444404",
          category: "legal",
          source: "",
        }),
      /Missing source/,
    );
  });
});
