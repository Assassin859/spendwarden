import type { ZetarisEnv } from "./env";
import { querySql, type QueryRows } from "./client";

const VIEW_CONTAINER = "spendwarden";
const VIEW_NAME = "vendor_wallet_payment";

const FILE_TABLES = [
  { table: "treasury_policy", file: "treasury_policy.csv", format: "CSV", header: true },
  { table: "vendors", file: "vendors.csv", format: "CSV", header: true },
  { table: "budgets", file: "budgets.csv", format: "CSV", header: true },
  { table: "payments_history", file: "payments_history.parquet", format: "PARQUET", header: false },
] as const;

function includesName(rows: QueryRows, name: string): boolean {
  const needle = name.toLowerCase();
  return rows.some((row) =>
    Object.values(row).some((value) => value.toLowerCase() === needle),
  );
}

function filePath(prefix: string, fileName: string): string {
  const base = prefix.endsWith("/") ? prefix : `${prefix}/`;
  return `${base}${fileName}`;
}

function alreadyExists(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /already exist/i.test(message);
}

export async function registerSampleSources(env: ZetarisEnv): Promise<void> {
  const one = await querySql("SELECT 1 AS one", env);
  if (!one.some((row) => Object.values(row).some((value) => value === "1"))) {
    throw new Error("SELECT 1 did not return a row");
  }

  const databases = await querySql("SHOW LIGHTNING DATABASES", env);
  if (!includesName(databases, env.database)) {
    await querySql(
      `CREATE LIGHTNING DATABASE ${env.database} DESCRIBE BY "Sample treasury files"`,
      env,
    );
  }

  const tables = await querySql(`SHOW LIGHTNING TABLES ${env.database}`, env);
  for (const source of FILE_TABLES) {
    if (includesName(tables, source.table)) {
      continue;
    }
    const path = filePath(env.dataPathPrefix, source.file).replace(/'/g, "''");
    const options = source.header
      ? `path "${path}", header "true", inferSchema "true"`
      : `path "${path}", inferSchema "true"`;
    await querySql(
      `CREATE LIGHTNING FILESTORE TABLE ${source.table} FROM ${env.database} FORMAT ${source.format} OPTIONS (${options})`,
      env,
    );
  }

  if (env.safeAddress) {
    if (!includesName(tables, "safe_history")) {
      const endpoint =
        `https://safe-transaction-sepolia.safe.global/api/v1/safes/${env.safeAddress}/all-transactions/`;
      await querySql(
        `CREATE LIGHTNING REST TABLE safe_history FROM ${env.database} REQUEST (endpoint "${endpoint}", method "GET", http_encoding "URLENCODED", response_type "JSON", insecure_ssl "false") HEADER () BODY ()`,
        env,
      );
    }
  }

  try {
    await querySql(`CREATE SCHEMASTORE CONTAINER ${VIEW_CONTAINER}`, env);
  } catch (error) {
    if (!alreadyExists(error)) {
      throw error;
    }
  }

  await querySql(
    `CREATE OR REPLACE SCHEMASTORE VIEW ${VIEW_NAME} WITH CONTAINER ${VIEW_CONTAINER} AS SELECT v.vendor AS vendor, v.wallet AS known_wallet, v.flagged AS flagged, v.flag_reason AS flag_reason, v.first_seen AS first_seen, p.payment_id AS payment_id, p.invoice_id AS invoice_id, p.wallet AS payment_wallet, p.amount_usd AS amount_usd, p.category AS category, p.quarter AS quarter, CASE WHEN p.wallet IS NULL THEN 'missing' WHEN lower(v.wallet) = lower(p.wallet) THEN 'known' ELSE 'missing' END AS wallet_status FROM ${env.database}.vendors v LEFT JOIN ${env.database}.payments_history p ON v.vendor = p.vendor AND lower(v.wallet) = lower(p.wallet)`,
    env,
  );
}

export const vendorWalletPayment = `${VIEW_CONTAINER}.${VIEW_NAME}`;
