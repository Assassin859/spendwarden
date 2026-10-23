import { spawnSync } from "node:child_process";
import path from "node:path";

import type { InvestigationOk } from "../src/investigate/run";
import { runInvestigation } from "../src/investigate/run";
import { HmemStore } from "../src/memory/store";

const ORBIT_EXCEPTION = "Orbit Legal may exceed the legal cap in 2026Q4";

function rebuildSample(): void {
  const tsxCli = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  const result = spawnSync(process.execPath, [tsxCli, path.join("scripts", "build-sample-payments.ts")], {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error("Sample parquet build failed");
  }
}

function modelLine(result: InvestigationOk): string {
  return result.trace.find((step) => step.step === "model")?.detail ?? "explanation skipped";
}

function printCase(result: InvestigationOk): void {
  const decision = result.action.decision;
  const memory = decision.memory_used.map((item) => item.id).join(", ");
  console.log(`\n${result.payout.scenario} ${result.payout.id}`);
  console.log(`decision ${decision.decision}`);
  console.log(`confidence ${decision.confidence.toFixed(2)}`);
  console.log(`reasons ${decision.reasons.join(", ")}`);
  console.log(`memory ${memory || "none"}`);
  if (result.action.reviewQuestion) {
    console.log(`review ${result.action.reviewQuestion}`);
  }
  if (result.action.incidentNote) {
    console.log(`incident ${result.action.incidentNote}`);
  }
  if (result.action.safeTxUrl) {
    console.log(`safe ${result.action.safeTxUrl}`);
  }
  if (result.safeError) {
    console.log(`safe-error ${result.safeError}`);
  }
  console.log(`model ${modelLine(result)}`);
}

function expectDecision(
  result: InvestigationOk,
  expected: "APPROVE" | "ESCALATE" | "BLOCK",
  reason: string,
): void {
  const decision = result.action.decision;
  if (decision.decision !== expected || decision.reasons[0] !== reason) {
    throw new Error(`${result.payout.id} decided ${decision.decision} ${decision.reasons[0] ?? ""}`);
  }
}

async function expectOpenSafe(url: string | null): Promise<void> {
  if (!url) {
    throw new Error("Missing Safe URL");
  }
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`Safe service transaction failed: HTTP ${response.status}`);
  }
  const body = (await response.json()) as {
    confirmations?: unknown[];
    confirmationsRequired?: number;
    isExecuted?: boolean;
  };
  const confirmations = body.confirmations?.length ?? 0;
  const threshold = body.confirmationsRequired ?? 0;
  if (body.isExecuted === true) {
    throw new Error("Safe transaction is executed");
  }
  if (!(confirmations < threshold)) {
    throw new Error("Safe transaction already has enough signatures");
  }
}

async function main(): Promise<void> {
  rebuildSample();
  const memory = new HmemStore();

  const helios = await runInvestigation("pay-helios", memory);
  printCase(helios);
  expectDecision(helios, "APPROVE", "within policy");
  if (helios.safeError) {
    throw new Error(helios.safeError);
  }
  await expectOpenSafe(helios.action.safeTxUrl);

  const northline = await runInvestigation("pay-northline-dup", memory);
  printCase(northline);
  expectDecision(northline, "BLOCK", "duplicate invoice");
  if (northline.action.safeTxUrl || northline.action.incidentNote !== "Incident pay-northline-dup: duplicate invoice.") {
    throw new Error("Northline must stay blocked with an incident note and no Safe URL");
  }

  const kite = await runInvestigation("pay-kite-new-wallet", memory);
  printCase(kite);
  expectDecision(kite, "ESCALATE", "new wallet");
  const question = `Approve the new wallet ${kite.payout.wallet} for ${kite.payout.recipient}?`;
  if (kite.action.safeTxUrl || kite.action.reviewQuestion !== question) {
    throw new Error("Kite must escalate with one new-wallet question and no Safe URL");
  }

  const orbit = await runInvestigation("pay-orbit-over-cap", memory);
  printCase(orbit);
  expectDecision(orbit, "ESCALATE", "over per-tx cap");
  if (orbit.action.safeTxUrl || orbit.action.decision.memory_used.length > 0) {
    throw new Error("Orbit must escalate before the exception");
  }

  memory.writeException({
    content: ORBIT_EXCEPTION,
    signerId: "signer-1",
    vendor: orbit.payout.recipient,
    wallet: orbit.payout.wallet,
    category: orbit.payout.category,
  });
  const orbitApproved = await runInvestigation("pay-orbit-over-cap", memory);
  printCase(orbitApproved);
  expectDecision(orbitApproved, "APPROVE", "over per-tx cap");
  const cited = orbitApproved.action.decision.memory_used;
  if (orbitApproved.action.decision.confidence !== 0.8 || cited.length === 0 || cited[0]?.content !== ORBIT_EXCEPTION) {
    throw new Error("Orbit re-run must approve at 0.8 and cite the exception");
  }
  if (orbitApproved.safeError) {
    throw new Error(orbitApproved.safeError);
  }
  await expectOpenSafe(orbitApproved.action.safeTxUrl);

  const pylon = await runInvestigation("pay-pylon-over-cap", memory);
  printCase(pylon);
  expectDecision(pylon, "ESCALATE", "over per-tx cap");
  if (pylon.action.safeTxUrl || pylon.action.decision.memory_used.length > 0) {
    throw new Error("Pylon must stay an escalation with no memory and no Safe URL");
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
