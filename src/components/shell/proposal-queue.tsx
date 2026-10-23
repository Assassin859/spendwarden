"use client";

import type { PayoutProposal } from "@/domain/payout";

const amountFormat = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export function ProposalQueue({
  proposals,
  selectedId,
  busyId,
  decisions,
  onSelect,
}: {
  proposals: PayoutProposal[];
  selectedId: string | null;
  busyId: string | null;
  decisions: Record<string, string>;
  onSelect: (id: string) => void;
}) {
  return (
    <section aria-label="Payout queue">
      <h2 className="eyebrow">Payout queue</h2>
      {proposals.length === 0 ? (
        <p className="stage-panel mt-3 text-sm text-mist">The queue is empty.</p>
      ) : (
        <ul className="queue-list">
          {proposals.map((proposal, index) => {
            const selected = selectedId === proposal.id;
            const busy = busyId === proposal.id;
            const decision = decisions[proposal.id];
            const chip = busy ? "Reading" : (decision ?? "Open");
            return (
              <li key={proposal.id} className="card-rise" style={{ animationDelay: `${index * 70}ms` }}>
                <button
                  type="button"
                  className={`queue-row ${selected ? "is-selected" : ""} ${busy ? "is-working" : ""}`}
                  aria-pressed={selected}
                  aria-busy={busy}
                  onClick={() => onSelect(proposal.id)}
                >
                  <span className="queue-mark">{proposal.scenario}</span>
                  <span className="min-w-0">
                    <span className="queue-name">{proposal.recipient}</span>
                    <span className="queue-meta">
                      {proposal.category} · {proposal.invoiceId}
                    </span>
                  </span>
                  <span>
                    <span className="queue-amount">{amountFormat.format(proposal.amountUsd)} USDC</span>
                    <span className={`status-chip ${decision ? `is-${decision.toLowerCase()}` : ""}`}>{chip}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
