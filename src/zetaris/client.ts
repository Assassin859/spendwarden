import { randomUUID } from "node:crypto";

import { loadZetarisEnv, type ZetarisEnv } from "./env";

export type QueryRows = Record<string, string>[];

const QUERY_PATH = "/sql-editor/sqls/run-query";

function asRows(payload: unknown): QueryRows {
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const body = payload as Record<string, unknown>;
  const headers = Array.isArray(body.headers)
    ? body.headers.map((header) => String(header))
    : Array.isArray(body.columns)
      ? body.columns.map((column) => String(column))
      : [];
  const data = body.data ?? body.rows ?? body.result;

  if (Array.isArray(data) && data.length > 0 && Array.isArray(data[0]) && headers.length > 0) {
    return data.map((row) => {
      const record: Record<string, string> = {};
      headers.forEach((header, index) => {
        const value = (row as unknown[])[index];
        record[header] = value == null ? "" : String(value);
      });
      return record;
    });
  }

  if (Array.isArray(data)) {
    return data
      .filter((row) => row && typeof row === "object" && !Array.isArray(row))
      .map((row) => {
        const record: Record<string, string> = {};
        for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
          record[key] = value == null ? "" : String(value);
        }
        return record;
      });
  }

  return [];
}

export function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function isOneStatement(sql: string): boolean {
  let inSingle = false;
  let inDouble = false;
  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    if (char === "'" && !inDouble) {
      if (inSingle && sql[index + 1] === "'") {
        index += 1;
        continue;
      }
      inSingle = !inSingle;
      continue;
    }
    if (char === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (char === ";" && !inSingle && !inDouble) {
      return false;
    }
  }
  return !inSingle && !inDouble;
}

export async function querySql(sql: string, env: ZetarisEnv = loadZetarisEnv()): Promise<QueryRows> {
  const statement = sql.trim();
  if (!statement || !isOneStatement(statement)) {
    throw new Error("Zetaris accepts one SQL statement per call");
  }

  const response = await fetch(`${env.restUrl}${QUERY_PATH}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.apiKey}`,
      "X-Org-ID": env.orgId,
      "X-Request-ID": randomUUID(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sql: statement, limit: 1000 }),
    signal: AbortSignal.timeout(180_000),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Zetaris query failed: HTTP ${response.status} ${text.slice(0, 400)}`);
  }

  let payload: unknown = {};
  if (text.trim()) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      throw new Error(`Zetaris query returned non-JSON: ${text.slice(0, 200)}`);
    }
  }

  if (payload && typeof payload === "object" && "error" in payload && (payload as { error?: unknown }).error) {
    throw new Error(`Zetaris query failed: ${JSON.stringify((payload as { error: unknown }).error).slice(0, 400)}`);
  }

  return asRows(payload);
}
