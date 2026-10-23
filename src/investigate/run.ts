import { readFileSync } from "node:fs";
import path from "node:path";

import type { Evidence } from "@/domain/decision";
import type { PayoutProposal } from "@/domain/payout";
import { HmemStore } from "@/memory/store";
import type { TraceStep } from "@/nemotron/pipeline";
import { investigate } from "@/nemotron/pipeline";
import { MeterlessClient } from "@/nemotron/client";
import type { PayoutAction } from "@/safe/act";
import { act, USDC_SEPOLIA_ADDRESS, type SafeProposer } from "@/safe/act";
import { loadSafeEnv, type SafeEnv } from "@/safe/env";
import { createSepoliaProposer, findOpenUsdcTransfer, readSafeThreshold } from "@/safe/sepolia";
import { loadZetarisEnv } from "@/zetaris/env";
import { payoutSources, type SourceResult } from "@/zetaris/queries";

export type SourceView = {
  source: string;
  status: "ok" | "missing";
  sql: string | null;
  error: string | null;
  rows: Record<string, string>[];
};

export type InvestigationOk = {
  status: "ok";
  payout: PayoutProposal;
  trace: TraceStep[];
  sources: SourceView[];
  action: PayoutAction;
  explanation: { reasons: string[]; citations: Evidence[] } | null;
  safeError: string | null;
};

export type InvestigationResult = InvestigationOk | { status: "error"; message: string };

const MEMORY_PATH = path.join(process.cwd(), "data", "hmem", "store.json");

function loadProposals(): PayoutProposal[] {
  const file = path.join(process.cwd(), "data", "sample", "proposed_payouts.json");
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(parsed)) {
    throw new Error("Sample queue could not be read.");
  }
  return parsed as PayoutProposal[];
}

export function findProposal(id: string): PayoutProposal {
  const found = loadProposals().find((item) => item.id === id);
  if (!found) {
    throw new Error("Missing payout");
  }
  return found;
}

function viewSource(result: SourceResult): SourceView {
  return {
    source: result.source,
    status: result.status,
    sql: result.sql ?? null,
    error: result.status === "missing" ? (result.error ?? null) : null,
    rows: result.status === "ok" ? result.rows : [],
  };
}

function reuseProposer(env: SafeEnv, url: string): SafeProposer {
  return {
    async threshold() {
      const threshold = await readSafeThreshold(env);
      if (!(threshold > 1)) {
        throw new Error("Safe threshold must be greater than 1");
      }
      return threshold;
    },
    async proposeTokenTransfer() {
      return {
        safeTxHash: url.split("/").pop() ?? "",
        url,
        confirmations: 1,
        threshold: 2,
      };
    },
  };
}

async function actOn(payout: PayoutProposal, decision: InvestigationOk["action"]["decision"]): Promise<{
  action: PayoutAction;
  safeError: string | null;
}> {
  if (decision.decision !== "APPROVE") {
    return { action: await act(payout, decision, null), safeError: null };
  }

  try {
    const env = loadSafeEnv({ requireSafe: true, requireKeys: true });
    const openUrl = await findOpenUsdcTransfer(env, {
      to: payout.wallet,
      amountUsd: payout.amountUsd,
      token: USDC_SEPOLIA_ADDRESS,
    });
    const proposer = openUrl ? reuseProposer(env, openUrl) : await createSepoliaProposer(env);
    return { action: await act(payout, decision, proposer), safeError: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      action: {
        decision,
        safeTxUrl: null,
        reviewQuestion: null,
        incidentNote: null,
      },
      safeError: message,
    };
  }
}

export async function runInvestigation(id: string, memory = new HmemStore({ filePath: MEMORY_PATH })): Promise<InvestigationOk> {
  const payout = findProposal(id);
  const env = loadZetarisEnv();
  const sources = await payoutSources(payout, env);
  const result = await investigate(payout, sources, memory, new MeterlessClient());
  const acted = await actOn(payout, result.decision);
  return {
    status: "ok",
    payout,
    trace: result.trace,
    sources: [sources.policy, sources.payments, sources.vendor, sources.budget, sources.safeHistory].map(viewSource),
    action: acted.action,
    explanation: result.explanation,
    safeError: acted.safeError,
  };
}

export async function recordException(id: string, content: string): Promise<InvestigationOk> {
  const sentence = content.trim();
  if (!sentence) {
    throw new Error("Missing exception");
  }
  const payout = findProposal(id);
  const memory = new HmemStore({ filePath: MEMORY_PATH });
  memory.writeException({
    content: sentence,
    signerId: "signer-1",
    vendor: payout.recipient,
    wallet: payout.wallet,
    category: payout.category,
  });
  return runInvestigation(id, memory);
}
