"use client";

import { useRef, useState } from "react";

import type { PayoutProposal } from "@/domain/payout";
import type { InvestigationOk, InvestigationResult } from "@/investigate/run";
import { InvestigationPanel } from "@/components/shell/investigation-panel";
import { ProposalQueue } from "@/components/shell/proposal-queue";

export function TreasuryDesk({ proposals }: { proposals: PayoutProposal[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "loading" | "error" | "ready">("idle");
  const [result, setResult] = useState<InvestigationOk | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Record<string, string>>({});
  const [playId, setPlayId] = useState(0);
  const request = useRef(0);
  const selected = proposals.find((item) => item.id === selectedId) ?? null;

  async function readInvestigation(url: string, id: string, body: Record<string, string>) {
    const token = request.current + 1;
    request.current = token;
    setSelectedId(id);
    setBusyId(id);
    setPhase("loading");
    setError(null);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as InvestigationResult;
      if (token !== request.current) {
        return;
      }
      if (payload.status === "error") {
        setResult(null);
        setError(payload.message);
        setPhase("error");
        return;
      }
      setResult(payload);
      setDecisions((current) => ({ ...current, [id]: payload.action.decision.decision }));
      setPlayId((current) => current + 1);
      setPhase("ready");
    } catch (caught) {
      if (token !== request.current) {
        return;
      }
      setResult(null);
      setError(caught instanceof Error ? caught.message : "The investigation could not be read.");
      setPhase("error");
    } finally {
      if (token === request.current) {
        setBusyId(null);
      }
    }
  }

  return (
    <div className="desk-grid">
      <div className="desk-queue">
        <ProposalQueue
          proposals={proposals}
          selectedId={selectedId}
          busyId={busyId}
          decisions={decisions}
          onSelect={(id) => {
            void readInvestigation("/api/investigate", id, { id });
          }}
        />
      </div>
      <InvestigationPanel
        phase={phase}
        result={result}
        error={error}
        playId={playId}
        selected={selected}
        onException={(content) => {
          if (!selectedId) {
            return;
          }
          void readInvestigation("/api/exception", selectedId, { id: selectedId, content });
        }}
      />
    </div>
  );
}
