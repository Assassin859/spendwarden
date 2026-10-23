import { readFileSync } from "node:fs";
import path from "node:path";

const REQUIRED = [
  "ZETARIS_REST_URL",
  "ZETARIS_ORG_ID",
  "ZETARIS_API_KEY",
  "ZETARIS_LIGHTNING_DATABASE",
] as const;

export type ZetarisEnv = {
  restUrl: string;
  orgId: string;
  apiKey: string;
  database: string;
  dataPathPrefix: string;
  safeAddress: string;
};

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

export function loadZetarisEnv(options?: { requireDataPath?: boolean }): ZetarisEnv {
  const filePath = path.join(process.cwd(), ".env.local");
  let parsed: Record<string, string> = {};
  try {
    parsed = parseEnvFile(readFileSync(filePath, "utf8"));
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    if (!missing) {
      throw error;
    }
  }

  const values = { ...parsed };
  for (const name of REQUIRED) {
    if (!values[name] && process.env[name]) {
      values[name] = process.env[name] ?? "";
    }
  }
  if (!values.ZETARIS_DATA_PATH_PREFIX && process.env.ZETARIS_DATA_PATH_PREFIX) {
    values.ZETARIS_DATA_PATH_PREFIX = process.env.ZETARIS_DATA_PATH_PREFIX;
  }
  if (!values.SAFE_ADDRESS && process.env.SAFE_ADDRESS) {
    values.SAFE_ADDRESS = process.env.SAFE_ADDRESS;
  }

  const missing: string[] = REQUIRED.filter((name) => !values[name]?.trim());
  if (options?.requireDataPath && !values.ZETARIS_DATA_PATH_PREFIX?.trim()) {
    missing.push("ZETARIS_DATA_PATH_PREFIX");
  }
  if (missing.length > 0) {
    throw new Error(`Missing ${missing.join(", ")}`);
  }

  const orgId = values.ZETARIS_ORG_ID.trim();
  if (!/^[0-9]+$/.test(orgId)) {
    throw new Error("Missing ZETARIS_ORG_ID");
  }

  return {
    restUrl: values.ZETARIS_REST_URL.trim().replace(/\/$/, ""),
    orgId,
    apiKey: values.ZETARIS_API_KEY.trim(),
    database: values.ZETARIS_LIGHTNING_DATABASE.trim(),
    dataPathPrefix: (values.ZETARIS_DATA_PATH_PREFIX ?? "").trim(),
    safeAddress: (values.SAFE_ADDRESS ?? "").trim(),
  };
}
