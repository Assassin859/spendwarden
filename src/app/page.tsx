import { readFileSync } from "node:fs";
import path from "node:path";
import { LivingBackground } from "@/components/shell/living-background";
import { ProposalQueue } from "@/components/shell/proposal-queue";
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
      <main className="relative z-10 mx-auto grid w-full max-w-6xl flex-1 items-start gap-12 px-6 py-16 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:py-24">
        <Wordmark />
        <ProposalQueue proposals={proposals} />
      </main>
    </>
  );
}
