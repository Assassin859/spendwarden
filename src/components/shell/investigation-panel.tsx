"use client";

import { useEffect, useRef, useState } from "react";

import type { PayoutProposal } from "@/domain/payout";
import type { InvestigationOk } from "@/investigate/run";

const STEP_LABEL: Record<string, string> = {
  intake: "Intake",
  plan: "Plan",
  zetaris: "Zetaris",
  rules: "Rules",
  memory: "Memory",
  model: "Model",
  gate: "Gate",
};

const SOURCE_LABEL: Record<string, string> = {
  policy: "Policy",
  payments: "Payments",
  vendor: "Vendor",
  budget: "Budget",
  safe_history: "Safe history",
};

const CHECKS = [
  ["Policy", "Caps and approved vendors"],
  ["Payments", "Invoice history"],
  ["Vendor", "Wallet and flag"],
  ["Budget", "Quarter remaining"],
  ["Safe history", "Open transfers"],
] as const;

const amountFormat = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

function confidenceOffset(confidence: number): { ring: number; target: number } {
  const ring = 2 * Math.PI * 26;
  const clamped = Math.min(1, Math.max(0, confidence));
  return { ring, target: ring * (1 - clamped) };
}

function fieldLabel(key: string): string {
  return key.replace(/_/g, " ");
}

function presentValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "—";
  }
  if (/^0x[a-fA-F0-9]{12,}$/.test(trimmed)) {
    return `${trimmed.slice(0, 6)}…${trimmed.slice(-4)}`;
  }
  if (/^https?:\/\//.test(trimmed)) {
    const hash = trimmed.split("/").pop() ?? trimmed;
    return hash.length > 18 ? `${hash.slice(0, 10)}…${hash.slice(-4)}` : hash;
  }
  return trimmed;
}

function PayoutBar({ payout }: { payout: PayoutProposal }) {
  return (
    <header className="payout-bar">
      <div>
        <p className="eyebrow">Scenario {payout.scenario}</p>
        <h2>{payout.recipient}</h2>
        <p className="payout-meta">
          {payout.category} · {payout.invoiceId} · <span title={payout.wallet}>{presentValue(payout.wallet)}</span>
        </p>
      </div>
      <p className="payout-amount">
        {amountFormat.format(payout.amountUsd)} {payout.token}
      </p>
    </header>
  );
}

export function InvestigationPanel({
  phase,
  result,
  error,
  playId,
  selected,
  onException,
}: {
  phase: "idle" | "loading" | "error" | "ready";
  result: InvestigationOk | null;
  error: string | null;
  playId: number;
  selected: PayoutProposal | null;
  onException: (content: string) => void;
}) {
  const frame = useRef<HTMLElement>(null);

  useEffect(() => {
    if (phase !== "ready" || playId === 0) {
      return;
    }
    const node = frame.current;
    if (!node) {
      return;
    }
    const top = node.getBoundingClientRect().top;
    if (top >= 0 && top < window.innerHeight * 0.45) {
      return;
    }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    node.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }, [phase, playId]);

  if (phase === "idle") {
    return (
      <section className="stage-panel" aria-label="Investigation">
        <p className="eyebrow">Investigation</p>
        <h2 className="stage-title">Choose a payout.</h2>
        <p className="stage-lead">
          Spendwarden reads five ledger sources, applies the rules, and writes a decision with citations. An approval proposes a Safe transfer. It does not execute one.
        </p>
        <ol className="ledger-index">
          {CHECKS.map(([name, note]) => (
            <li key={name}>
              {name}
              <span>{note}</span>
            </li>
          ))}
        </ol>
      </section>
    );
  }

  if (phase === "error") {
    return (
      <section className="stage-panel" role="alert">
        <p className="eyebrow">Zetaris</p>
        <h2 className="stage-title">The ledger could not be read.</h2>
        <p className="stage-lead">{error ?? "The investigation stopped before a decision."}</p>
      </section>
    );
  }

  if (phase === "loading" || !result) {
    return (
      <section className="stage-panel" aria-busy="true" aria-label="Investigation">
        {selected ? <PayoutBar payout={selected} /> : <p className="eyebrow">Investigation</p>}
        <p className="reading-line">Reading the ledger.</p>
      </section>
    );
  }

  const decision = result.action.decision;
  const tone =
    decision.decision === "APPROVE"
      ? "text-gold"
      : decision.decision === "ESCALATE"
        ? "decision-escalate text-teal"
        : "decision-block";
  const ring = confidenceOffset(decision.confidence);

  return (
    <section key={playId} ref={frame} className="stage-panel" aria-label="Investigation">
      <PayoutBar payout={result.payout} />

      <div className="verdict trace-step" style={{ animationDelay: "80ms" }}>
        <div>
          <p className="eyebrow">Decision</p>
          <h2 className={`verdict-word ${tone}`}>{decision.decision}</h2>
          <p className="verdict-reason">{decision.reasons.join(" · ")}</p>
        </div>
        <div className="verdict-meter">
          <svg viewBox="0 0 64 64" className="h-14 w-14 shrink-0" aria-hidden="true">
            <circle cx="32" cy="32" r="26" fill="none" stroke="rgba(244,241,234,0.16)" strokeWidth="2" />
            <circle
              className="confidence-ring"
              cx="32"
              cy="32"
              r="26"
              fill="none"
              stroke="var(--gold)"
              strokeWidth="2"
              strokeLinecap="round"
              style={{
                ["--ring" as string]: String(ring.ring),
                ["--target" as string]: String(ring.target),
              }}
            />
          </svg>
          <p>{decision.confidence.toFixed(2)}</p>
        </div>
      </div>

      {result.action.reviewQuestion ? <p className="callout">{result.action.reviewQuestion}</p> : null}
      {result.action.incidentNote ? <p className="callout font-mono text-sm">{result.action.incidentNote}</p> : null}
      {result.action.safeTxUrl ? (
        <a className="safe-link" href={result.action.safeTxUrl} target="_blank" rel="noreferrer">
          Open Safe transaction
        </a>
      ) : null}
      {result.safeError ? <p className="reading-line">{result.safeError}</p> : null}

      <div className="fact-grid">
        <div>
          <h3>Citations</h3>
          <ul>
            {decision.evidence.map((item) => (
              <li key={`${item.source}-${item.ref}`} title={item.ref}>
                <span className="text-mist">{item.source} </span>
                <span className="font-mono">{presentValue(item.ref)}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3>Memory</h3>
          {decision.memory_used.length === 0 ? (
            <p className="text-mist">No exception cited.</p>
          ) : (
            <ul>
              {decision.memory_used.map((item) => (
                <li key={item.id}>
                  <span className="font-mono text-gold">{item.id}</span> {item.content}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {result.explanation ? (
        <div className="fact-grid">
          <div>
            <h3>Explanation</h3>
            <ul>
              {result.explanation.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      <ExceptionForm
        payoutId={result.payout.id}
        recipient={result.payout.recipient}
        category={result.payout.category}
        playId={playId}
        onException={onException}
      />

      <div className="trace">
        <h3 className="trace-heading">Trace</h3>
        <ol className="trace-list">
          {result.trace.map((step, index) => (
            <li key={step.step} className="trace-step" style={{ animationDelay: `${220 + index * 140}ms` }}>
              <span className="trace-index">{String(index + 1).padStart(2, "0")}</span>
              <div className="min-w-0">
                <p className="trace-label">{STEP_LABEL[step.step] ?? step.step}</p>
                <p className="trace-detail">{step.detail}</p>
                {step.step === "zetaris" ? (
                  <div className="source-list">
                    {result.sources.map((source, sourceIndex) => (
                      <article
                        key={source.source}
                        className="source-card"
                        style={{ ["--enter" as string]: `${360 + sourceIndex * 90}ms`, animationDelay: `${360 + sourceIndex * 90}ms` }}
                      >
                        <div className="source-head">
                          <strong>{SOURCE_LABEL[source.source] ?? source.source}</strong>
                          <span className={`status-chip ${source.status === "ok" ? "is-approve" : ""}`}>{source.status}</span>
                        </div>
                        {source.rows.length > 0 ? (
                          <dl className="source-rows">
                            {source.rows.flatMap((row, rowIndex) =>
                              Object.entries(row).map(([key, value]) => (
                                <div key={`${rowIndex}-${key}`}>
                                  <dt>{fieldLabel(key)}</dt>
                                  <dd title={value || undefined}>{presentValue(value)}</dd>
                                </div>
                              )),
                            )}
                          </dl>
                        ) : null}
                        {source.error ? (
                          <p className="source-error">{source.error.length > 180 ? `${source.error.slice(0, 180)}…` : source.error}</p>
                        ) : null}
                        {source.sql ? (
                          <details className="source-sql">
                            <summary>Statement</summary>
                            <pre>{source.sql}</pre>
                          </details>
                        ) : null}
                      </article>
                    ))}
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function ExceptionForm({
  payoutId,
  recipient,
  category,
  playId,
  onException,
}: {
  payoutId: string;
  recipient: string;
  category: string;
  playId: number;
  onException: (content: string) => void;
}) {
  const [sentence, setSentence] = useState(`${recipient} may exceed the ${category} cap in 2026Q4`);

  useEffect(() => {
    setSentence(`${recipient} may exceed the ${category} cap in 2026Q4`);
  }, [payoutId, recipient, category, playId]);

  return (
    <form
      className="exception-form"
      onSubmit={(event) => {
        event.preventDefault();
        onException(sentence);
      }}
    >
      <label htmlFor="exception-sentence">Signer exception</label>
      <textarea
        id="exception-sentence"
        className="exception-input"
        rows={3}
        value={sentence}
        onChange={(event) => setSentence(event.target.value)}
      />
      <button type="submit" className="record-button">
        Record exception
      </button>
    </form>
  );
}
