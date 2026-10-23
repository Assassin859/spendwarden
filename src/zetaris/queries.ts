import type { PayoutProposal } from "@/domain/payout";

import { quoteLiteral, querySql, type QueryRows } from "./client";
import type { ZetarisEnv } from "./env";
import { vendorWalletPayment } from "./register";

export type SourceResult =
  | { source: string; status: "missing" }
  | { source: string; status: "ok"; rows: QueryRows };

function present(source: string, rows: QueryRows): SourceResult {
  if (rows.length === 0) {
    return { source, status: "missing" };
  }
  return { source, status: "ok", rows };
}

export async function policyFor(payout: PayoutProposal, env: ZetarisEnv): Promise<SourceResult> {
  const rows = await querySql(
    `SELECT category, per_tx_cap_usd, quarter_cap_usd, approved_vendors, required_approvals FROM ${env.database}.treasury_policy WHERE category = ${quoteLiteral(payout.category)}`,
    env,
  );
  return present("policy", rows);
}

export async function paymentsFor(payout: PayoutProposal, env: ZetarisEnv): Promise<SourceResult> {
  const rows = await querySql(
    `SELECT payment_id, invoice_id, vendor, wallet, amount_usd, token, category, paid_at, quarter FROM ${env.database}.payments_history WHERE invoice_id = ${quoteLiteral(payout.invoiceId)}`,
    env,
  );
  return present("payments", rows);
}

export async function vendorFor(payout: PayoutProposal, env: ZetarisEnv): Promise<SourceResult> {
  const rows = await querySql(
    `SELECT q.recipient AS vendor, v.known_wallet, v.flagged, v.flag_reason, q.wallet AS payout_wallet, CASE WHEN v.known_wallet IS NULL THEN 'missing' WHEN lower(v.known_wallet) = lower(q.wallet) THEN 'known' ELSE 'missing' END AS wallet_status FROM (SELECT ${quoteLiteral(payout.recipient)} AS recipient, ${quoteLiteral(payout.wallet)} AS wallet) q LEFT JOIN (SELECT DISTINCT vendor, known_wallet, flagged, flag_reason FROM ${vendorWalletPayment}) v ON v.vendor = q.recipient`,
    env,
  );
  return present("vendor", rows);
}

export async function budgetFor(payout: PayoutProposal, env: ZetarisEnv): Promise<SourceResult> {
  const rows = await querySql(
    `SELECT category, quarter, allocated_usd, spent_usd FROM ${env.database}.budgets WHERE category = ${quoteLiteral(payout.category)} AND quarter = '2026Q4'`,
    env,
  );
  return present("budget", rows);
}

export async function safeHistoryFor(
  payout: PayoutProposal,
  env: ZetarisEnv,
): Promise<SourceResult> {
  if (!env.safeAddress) {
    return { source: "safe_history", status: "missing" };
  }
  const rows = await querySql(
    `SELECT * FROM ${env.database}.safe_history WHERE lower(cast(to AS string)) = lower(${quoteLiteral(payout.wallet)}) OR lower(cast(recipient AS string)) = lower(${quoteLiteral(payout.wallet)})`,
    env,
  );
  return present("safe_history", rows);
}

export async function payoutSources(payout: PayoutProposal, env: ZetarisEnv) {
  return {
    id: payout.id,
    scenario: payout.scenario,
    policy: await policyFor(payout, env),
    payments: await paymentsFor(payout, env),
    vendor: await vendorFor(payout, env),
    budget: await budgetFor(payout, env),
    safeHistory: await safeHistoryFor(payout, env),
  };
}
