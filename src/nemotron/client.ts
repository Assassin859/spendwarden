import { readFileSync } from "node:fs";
import path from "node:path";

import type { DecisionName, DecisionRecord, Evidence } from "@/domain/decision";
import type { PayoutProposal } from "@/domain/payout";
import type { PayoutSources } from "@/rules/decide";

export type ModelExplanation = {
  decision: DecisionName;
  reasons: string[];
  citations: Evidence[];
};

export type ExplanationRequest = {
  payout: PayoutProposal;
  sources: PayoutSources;
  decision: DecisionRecord;
};

export type ExplanationClient = {
  explain(input: ExplanationRequest): Promise<ModelExplanation | null>;
};

const DECISIONS = new Set<DecisionName>(["APPROVE", "ESCALATE", "BLOCK"]);

function parseEnvFile(contents: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const name = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[name] = value;
  }
  return values;
}

function meterlessConfig(): { baseUrl: string; token: string; model: string } | null {
  let fileValues: Record<string, string> = {};
  try {
    fileValues = parseEnvFile(readFileSync(path.join(process.cwd(), ".env.local"), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  const baseUrl = (process.env.METERLESS_BASE_URL || fileValues.METERLESS_BASE_URL || "").trim().replace(/\/$/, "");
  const token = (process.env.METERLESS_API_TOKEN || fileValues.METERLESS_API_TOKEN || "").trim();
  const model = (process.env.METERLESS_MODEL || fileValues.METERLESS_MODEL || "").trim();
  if (!baseUrl || !token || !model) {
    return null;
  }
  return { baseUrl, token, model };
}

function evidencePack(input: ExplanationRequest): string {
  return JSON.stringify({
    payout: {
      id: input.payout.id,
      recipient: input.payout.recipient,
      wallet: input.payout.wallet,
      amountUsd: input.payout.amountUsd,
      category: input.payout.category,
      invoiceId: input.payout.invoiceId,
    },
    decision: input.decision.decision,
    confidence: input.decision.confidence,
    reasons: input.decision.reasons,
    evidence: input.decision.evidence,
    memory_used: input.decision.memory_used,
    sources: {
      policy: input.sources.policy,
      payments: input.sources.payments,
      vendor: input.sources.vendor,
      budget: input.sources.budget,
      safeHistory: input.sources.safeHistory,
    },
  });
}

export function parseModelExplanation(text: string): ModelExplanation {
  const fenced = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(fenced) as {
    decision?: unknown;
    reasons?: unknown;
    citations?: unknown;
  };
  if (typeof parsed.decision !== "string" || !DECISIONS.has(parsed.decision as DecisionName)) {
    throw new Error("Meterless explanation did not include a decision");
  }
  const reasons = Array.isArray(parsed.reasons) ? parsed.reasons.filter((reason) => typeof reason === "string") : [];
  const citations = Array.isArray(parsed.citations)
    ? parsed.citations.flatMap((citation) => {
        if (!citation || typeof citation !== "object") {
          return [];
        }
        const source = "source" in citation ? citation.source : undefined;
        const ref = "ref" in citation ? citation.ref : undefined;
        if (typeof source !== "string" || typeof ref !== "string") {
          return [];
        }
        return [{ source, ref }];
      })
    : [];
  return { decision: parsed.decision as DecisionName, reasons, citations };
}

export class MeterlessClient implements ExplanationClient {
  async explain(input: ExplanationRequest): Promise<ModelExplanation | null> {
    const config = meterlessConfig();
    if (!config) {
      return null;
    }

    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
        "meterless-app": "spendwarden",
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              'Explain the treasury decision that is already final. Reply with JSON only: {"decision":"APPROVE"|"ESCALATE"|"BLOCK","reasons":[string],"citations":[{"source":string,"ref":string}]}. Give reasons and citations. Do not choose a different decision.',
          },
          { role: "user", content: evidencePack(input) },
        ],
      }),
      signal: AbortSignal.timeout(180_000),
    });

    if (!response.ok) {
      throw new Error(`Meterless explanation failed: HTTP ${response.status}`);
    }

    const body = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = body.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("Meterless explanation was empty");
    }
    return parseModelExplanation(content);
  }
}
