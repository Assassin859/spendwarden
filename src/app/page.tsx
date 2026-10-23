import { readFileSync } from "node:fs";
import path from "node:path";
import { LivingBackground } from "@/components/shell/living-background";
import { TreasuryDesk } from "@/components/shell/treasury-desk";
import { Wordmark } from "@/components/shell/wordmark";
import type { PayoutProposal } from "@/domain/payout";

function loadProposals(): PayoutProposal[] {
  const file = path.join(process.cwd(), "data", "sample", "proposed_payouts.json");
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(parsed) || parsed.length !== 5) {
    throw new Error("Sample queue must contain exactly five payout proposals.");
  }
  return parsed as PayoutProposal[];
}

export default function Home() {
  const proposals = loadProposals();

  return (
    <>
      <LivingBackground />
      <main className="desk">
        <Wordmark />
        <TreasuryDesk proposals={proposals} />
      </main>
    </>
  );
}
