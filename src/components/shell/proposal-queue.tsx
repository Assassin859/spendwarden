import type { PayoutProposal } from "@/domain/payout";

const amountFormat = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export function ProposalQueue({ proposals }: { proposals: PayoutProposal[] }) {
  return (
    <section className="flex flex-col gap-4" aria-label="Payout queue">
      <h2 className="fade-in text-xs font-medium tracking-[0.28em] text-mist uppercase">
        Payout queue
      </h2>
      <ul className="flex flex-col gap-3">
        {proposals.map((proposal, index) => (
          <li
            key={proposal.id}
            className="proposal-card card-rise rounded-2xl px-5 py-4 backdrop-blur-md"
            style={{ animationDelay: `${180 + index * 80}ms` }}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h3 className="text-lg font-medium">
                <span className="mr-2 font-mono text-sm text-gold">{proposal.scenario}</span>
                {proposal.recipient}
              </h3>
              <p className="font-mono text-sm text-gold">
                {amountFormat.format(proposal.amountUsd)} {proposal.token}
              </p>
            </div>
            <dl className="mt-3 grid gap-1 text-sm text-mist sm:grid-cols-2">
              <div>
                <dt className="inline">Category </dt>
                <dd className="inline text-foreground">{proposal.category}</dd>
              </div>
              <div>
                <dt className="inline">Invoice </dt>
                <dd className="inline font-mono text-foreground">{proposal.invoiceId}</dd>
              </div>
            </dl>
            <p className="mt-3 text-xs tracking-wide text-mist uppercase">Awaiting decision</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
