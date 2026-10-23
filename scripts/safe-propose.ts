import type { SafeProposer } from "../src/safe/act";
import { act } from "../src/safe/act";
import { loadSafeEnv } from "../src/safe/env";
import { sampleCase } from "../src/safe/sample-decisions";
import { createSepoliaProposer } from "../src/safe/sepolia";

const throwingProposer: SafeProposer = {
  async threshold() {
    throw new Error("propose called");
  },
  async proposeTokenTransfer() {
    throw new Error("propose called");
  },
};

async function serviceStatus(url: string): Promise<{ confirmations: number; threshold: number; executed: boolean }> {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`Safe service transaction failed: HTTP ${response.status}`);
  }
  const body = (await response.json()) as {
    confirmations?: unknown[];
    confirmationsRequired?: number;
    isExecuted?: boolean;
  };
  return {
    confirmations: body.confirmations?.length ?? 0,
    threshold: body.confirmationsRequired ?? 0,
    executed: body.isExecuted === true,
  };
}

async function main() {
  let env;
  try {
    env = loadSafeEnv({ requireSafe: true, requireKeys: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }

  const northline = sampleCase("pay-northline-dup");
  const kite = sampleCase("pay-kite-new-wallet");
  const blocked = await act(northline.payout, northline.decision, throwingProposer);
  const escalated = await act(kite.payout, kite.decision, throwingProposer);
  if (blocked.safeTxUrl || escalated.safeTxUrl) {
    throw new Error("Scenarios B and C must not propose");
  }
  if (blocked.incidentNote !== "Incident pay-northline-dup: duplicate invoice.") {
    throw new Error("Scenario B did not write the incident note");
  }
  if (!escalated.reviewQuestion) {
    throw new Error("Scenario C did not write a review question");
  }

  const helios = sampleCase("pay-helios");
  if (helios.decision.decision !== "APPROVE") {
    throw new Error("Scenario A is not APPROVE");
  }
  const proposer = await createSepoliaProposer(env);
  const approved = await act(helios.payout, helios.decision, proposer);
  if (!approved.safeTxUrl) {
    throw new Error("Scenario A did not return a Safe service URL");
  }

  const status = await serviceStatus(approved.safeTxUrl);
  if (status.confirmations !== 1 || status.threshold !== 2 || status.executed) {
    throw new Error(
      `Expected 1 confirmation and threshold 2. confirmations ${status.confirmations} threshold ${status.threshold} executed ${status.executed}`,
    );
  }

  console.log(
    JSON.stringify(
      {
        B: { decision: blocked.decision.decision, safeTxUrl: blocked.safeTxUrl, incidentNote: blocked.incidentNote },
        C: {
          decision: escalated.decision.decision,
          safeTxUrl: escalated.safeTxUrl,
          reviewQuestion: escalated.reviewQuestion,
        },
        A: {
          decision: approved.decision.decision,
          safeTxUrl: approved.safeTxUrl,
          confirmations: status.confirmations,
          threshold: status.threshold,
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
