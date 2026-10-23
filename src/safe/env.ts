import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ENV_PATH = path.join(process.cwd(), ".env.local");

export type SafeEnv = {
  rpcUrl: string;
  txServiceUrl: string;
  chainId: number;
  safeAddress: string;
  proposerPrivateKey: string;
  cosignerPrivateKey: string;
  threshold: number;
  usdcAddress: string;
};

const DEFAULTS: Record<string, string> = {
  SEPOLIA_RPC_URL: "https://ethereum-sepolia-rpc.publicnode.com",
  SAFE_TX_SERVICE_URL: "https://safe-transaction-sepolia.safe.global",
  SAFE_CHAIN_ID: "11155111",
  SAFE_THRESHOLD: "2",
  USDC_SEPOLIA_ADDRESS: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
};

export function readEnvFile(): Record<string, string> {
  try {
    return parseEnvFile(readFileSync(ENV_PATH, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

export function upsertEnv(updates: Record<string, string>): void {
  const original = (() => {
    try {
      return readFileSync(ENV_PATH, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return "";
      }
      throw error;
    }
  })();

  const seen = new Set<string>();
  const lines = original.split(/\r?\n/).map((line) => {
    const separator = line.indexOf("=");
    if (separator === -1 || line.trim().startsWith("#")) {
      return line;
    }
    const name = line.slice(0, separator).trim();
    if (!Object.prototype.hasOwnProperty.call(updates, name)) {
      return line;
    }
    seen.add(name);
    return `${name}=${updates[name]}`;
  });

  for (const [name, value] of Object.entries(updates)) {
    if (!seen.has(name)) {
      lines.push(`${name}=${value}`);
    }
  }

  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  writeFileSync(ENV_PATH, `${lines.join("\n")}\n`);
}

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

function valueOf(name: string, file: Record<string, string>): string {
  const fromFile = file[name]?.trim() ?? "";
  if (fromFile) {
    return fromFile;
  }
  const fromProcess = process.env[name]?.trim() ?? "";
  if (fromProcess) {
    return fromProcess;
  }
  return DEFAULTS[name] ?? "";
}

export function loadSafeEnv(options?: { requireSafe?: boolean; requireKeys?: boolean }): SafeEnv {
  const file = readEnvFile();
  const rpcUrl = valueOf("SEPOLIA_RPC_URL", file);
  const txServiceUrl = valueOf("SAFE_TX_SERVICE_URL", file).replace(/\/$/, "");
  const chainIdText = valueOf("SAFE_CHAIN_ID", file);
  const safeAddress = valueOf("SAFE_ADDRESS", file);
  const proposerPrivateKey = valueOf("SAFE_PROPOSER_PRIVATE_KEY", file);
  const cosignerPrivateKey = valueOf("SAFE_COSIGNER_PRIVATE_KEY", file);
  const thresholdText = valueOf("SAFE_THRESHOLD", file);
  const usdcAddress = valueOf("USDC_SEPOLIA_ADDRESS", file);

  const missing: string[] = [];
  if (!rpcUrl) missing.push("SEPOLIA_RPC_URL");
  if (!txServiceUrl) missing.push("SAFE_TX_SERVICE_URL");
  if (!chainIdText) missing.push("SAFE_CHAIN_ID");
  if (!usdcAddress) missing.push("USDC_SEPOLIA_ADDRESS");
  if (options?.requireSafe && !safeAddress) missing.push("SAFE_ADDRESS");
  if (options?.requireKeys && !proposerPrivateKey) missing.push("SAFE_PROPOSER_PRIVATE_KEY");
  if (options?.requireKeys && !cosignerPrivateKey) missing.push("SAFE_COSIGNER_PRIVATE_KEY");
  if (missing.length > 0) {
    throw new Error(`Missing ${missing.join(", ")}`);
  }

  const chainId = Number(chainIdText);
  const threshold = Number(thresholdText);
  if (!Number.isInteger(chainId) || chainId !== 11155111) {
    throw new Error("SAFE_CHAIN_ID must be 11155111");
  }
  if (!Number.isInteger(threshold) || threshold <= 1) {
    throw new Error("Safe threshold must be greater than 1");
  }

  return {
    rpcUrl,
    txServiceUrl,
    chainId,
    safeAddress,
    proposerPrivateKey,
    cosignerPrivateKey,
    threshold,
    usdcAddress,
  };
}
