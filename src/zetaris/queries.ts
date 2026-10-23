import type { PayoutProposal } from "@/domain/payout";

import { quoteLiteral, querySql, type QueryRows } from "./client";
import type { ZetarisEnv } from "./env";
import { vendorWalletPayment } from "./register";

export type SourceResult =
  | { source: string; status: "missing"; sql?: string; error?: string }
  | { source: string; status: "ok"; rows: QueryRows; sql?: string };

function present(source: string, rows: QueryRows, sql: string): SourceResult {
  if (rows.length === 0) {
    return { source, status: "missing", sql };
  }
  return { source, status: "ok", rows, sql };
}

async function lookup(source: string, sql: string, env: ZetarisEnv): Promise<SourceResult> {
  try {
    return present(source, await querySql(sql, env), sql);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { source, status: "missing", sql, error: message };
  }
}

function policySql(payout: PayoutProposal, env: ZetarisEnv): string {
  return `SELECT category, per_tx_cap_usd, quarter_cap_usd, approved_vendors, required_approvals FROM ${env.database}.treasury_policy WHERE category = ${quoteLiteral(payout.category)}`;
}

function paymentsSql(payout: PayoutProposal, env: ZetarisEnv): string {
  return `SELECT payment_id, invoice_id, vendor, wallet, amount_usd, token, category, paid_at, quarter FROM ${env.database}.payments_history WHERE invoice_id = ${quoteLiteral(payout.invoiceId)}`;
}

function vendorSql(payout: PayoutProposal, env: ZetarisEnv): string {
  return `SELECT q.recipient AS vendor, v.known_wallet, v.flagged, v.flag_reason, q.wallet AS payout_wallet, CASE WHEN v.known_wallet IS NULL THEN 'missing' WHEN lower(v.known_wallet) = lower(q.wallet) THEN 'known' ELSE 'missing' END AS wallet_status FROM (SELECT ${quoteLiteral(payout.recipient)} AS recipient, ${quoteLiteral(payout.wallet)} AS wallet) q LEFT JOIN (SELECT DISTINCT vendor, known_wallet, flagged, flag_reason FROM ${vendorWalletPayment}) v ON v.vendor = q.recipient`;
}

function budgetSql(payout: PayoutProposal, env: ZetarisEnv): string {
  return `SELECT category, quarter, allocated_usd, spent_usd FROM ${env.database}.budgets WHERE category = ${quoteLiteral(payout.category)} AND quarter = '2026Q4'`;
}

function safeHistorySql(payout: PayoutProposal, env: ZetarisEnv): string {
  return `SELECT * FROM ${env.database}.safe_history WHERE lower(cast(to AS string)) = lower(${quoteLiteral(payout.wallet)}) OR lower(cast(recipient AS string)) = lower(${quoteLiteral(payout.wallet)})`;
}

export async function policyFor(payout: PayoutProposal, env: ZetarisEnv): Promise<SourceResult> {
  return lookup("policy", policySql(payout, env), env);
}

export async function paymentsFor(payout: PayoutProposal, env: ZetarisEnv): Promise<SourceResult> {
  return lookup("payments", paymentsSql(payout, env), env);
}

export async function vendorFor(payout: PayoutProposal, env: ZetarisEnv): Promise<SourceResult> {
  return lookup("vendor", vendorSql(payout, env), env);
}

export async function budgetFor(payout: PayoutProposal, env: ZetarisEnv): Promise<SourceResult> {
  return lookup("budget", budgetSql(payout, env), env);
}

export async function safeHistoryFor(payout: PayoutProposal, env: ZetarisEnv): Promise<SourceResult> {
  if (!env.safeAddress) {
    return { source: "safe_history", status: "missing" };
  }
  return lookup("safe_history", safeHistorySql(payout, env), env);
}

export async function payoutSources(payout: PayoutProposal, env: ZetarisEnv) {
  const [policy, payments, vendor, budget, safeHistory] = await Promise.all([
    policyFor(payout, env),
    paymentsFor(payout, env),
    vendorFor(payout, env),
    budgetFor(payout, env),
    safeHistoryFor(payout, env),
  ]);
  if (policy.status === "missing" && policy.error) {
    throw new Error(policy.error);
  }
  return {
    id: payout.id,
    scenario: payout.scenario,
    policy,
    payments,
    vendor,
    budget,
    safeHistory,
  };
}
