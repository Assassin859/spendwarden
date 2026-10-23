import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { act, USDC_SEPOLIA_ADDRESS, type SafeProposer, type TokenTransferRequest } from "@/safe/act";
import { sampleCase } from "@/safe/sample-decisions";

const SERVICE_URL = "https://safe-transaction-sepolia.safe.global/api/v1/multisig-transactions/0xabc";

function recordingProposer(threshold: number) {
  const calls = { propose: 0, blocked: 0 };
  let request: TokenTransferRequest | null = null;
  const proposer = new Proxy({} as SafeProposer, {
    get(_target, property) {
      if (property === "threshold") {
        return async () => threshold;
      }
      if (property === "proposeTokenTransfer") {
        return async (value: TokenTransferRequest) => {
          calls.propose += 1;
          request = value;
          return {
            safeTxHash: "0xabc",
            url: SERVICE_URL,
            confirmations: 1,
            threshold,
          };
        };
      }
      if (typeof property === "string") {
        calls.blocked += 1;
        throw new Error(`unexpected Safe call ${property}`);
      }
      return undefined;
    },
  });
  return {
    proposer,
    calls,
    request: () => request,
  };
}

describe("act", () => {
  it("proposes the Helios approval once and never executes", async () => {
    const { payout, decision } = sampleCase("pay-helios");
    const recorder = recordingProposer(2);
    const evidenceBefore = decision.evidence.length;

    const action = await act(payout, decision, recorder.proposer);

    assert.equal(decision.decision, "APPROVE");
    assert.equal(decision.evidence.length, evidenceBefore);
    assert.equal(recorder.calls.propose, 1);
    assert.equal(recorder.calls.blocked, 0);
    assert.equal(action.safeTxUrl, SERVICE_URL);
    assert.equal(action.reviewQuestion, null);
    assert.equal(action.incidentNote, null);
    assert.equal(action.decision.decision, "APPROVE");
    assert.equal(action.decision.confidence, 0.9);
    assert.deepEqual(action.decision.reasons, ["within policy"]);
    assert.deepEqual(action.decision.evidence.at(-1), { source: "safe", ref: SERVICE_URL });
    assert.deepEqual(recorder.request(), {
      to: payout.wallet,
      amountUsd: 2500,
      token: USDC_SEPOLIA_ADDRESS,
    });
  });

  it("writes an incident note for the Northline block and does not propose", async () => {
    const { payout, decision } = sampleCase("pay-northline-dup");
    const recorder = recordingProposer(2);

    const action = await act(payout, decision, recorder.proposer);

    assert.equal(decision.decision, "BLOCK");
    assert.equal(recorder.calls.propose, 0);
    assert.equal(recorder.calls.blocked, 0);
    assert.equal(action.safeTxUrl, null);
    assert.equal(action.reviewQuestion, null);
    assert.equal(action.incidentNote, "Incident pay-northline-dup: duplicate invoice.");
  });

  it("asks one question for the Kite escalation and does not propose", async () => {
    const { payout, decision } = sampleCase("pay-kite-new-wallet");
    const recorder = recordingProposer(2);

    const action = await act(payout, decision, recorder.proposer);

    assert.equal(decision.decision, "ESCALATE");
    assert.equal(recorder.calls.propose, 0);
    assert.equal(recorder.calls.blocked, 0);
    assert.equal(action.safeTxUrl, null);
    assert.equal(action.incidentNote, null);
    assert.equal(action.reviewQuestion, `Approve the new wallet ${payout.wallet} for ${payout.recipient}?`);
  });

  it("refuses a Safe whose threshold is 1 and does not propose", async () => {
    const { payout, decision } = sampleCase("pay-helios");
    const recorder = recordingProposer(1);

    await assert.rejects(act(payout, decision, recorder.proposer), /Safe threshold must be greater than 1/);
    assert.equal(recorder.calls.propose, 0);
    assert.equal(recorder.calls.blocked, 0);
  });
});
