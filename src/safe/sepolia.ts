import SafeApiKit from "@safe-global/api-kit";
import Safe from "@safe-global/protocol-kit";
import {
  createPublicClient,
  encodeFunctionData,
  getAddress,
  http,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

import type { ProposedTransfer, SafeProposer, TokenTransferRequest } from "@/safe/act";
import type { SafeEnv } from "@/safe/env";

const USDC_TRANSFER = [
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export function normalizePrivateKey(value: string, name: string): Hex {
  const trimmed = value.trim();
  const hex = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(`Missing ${name}`);
  }
  return hex as Hex;
}

export function addressForPrivateKey(value: string, name: string): Address {
  return privateKeyToAccount(normalizePrivateKey(value, name)).address;
}

export function safeServiceTransactionUrl(txServiceUrl: string, safeTxHash: string): string {
  const base = txServiceUrl.replace(/\/$/, "");
  return `${base}/api/v1/multisig-transactions/${safeTxHash}`;
}

function serviceApiBase(txServiceUrl: string): string {
  const base = txServiceUrl.replace(/\/$/, "");
  return base.endsWith("/api") ? base : `${base}/api`;
}

function publicClient(rpcUrl: string) {
  return createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
}

function encodeUsdcTransfer(request: TokenTransferRequest): Hex {
  return encodeFunctionData({
    abi: USDC_TRANSFER,
    functionName: "transfer",
    args: [getAddress(request.to), parseUnits(String(request.amountUsd), 6)],
  });
}

async function readServiceTransaction(url: string): Promise<{ confirmations: number; threshold: number; executed: boolean }> {
  let lastStatus = 0;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    lastStatus = response.status;
    if (response.ok) {
      const body = (await response.json()) as {
        confirmations?: unknown[];
        confirmationsRequired?: number;
        isExecuted?: boolean;
      };
      return {
        confirmations: body.confirmations?.length ?? 0,
        threshold: body.confirmationsRequired ?? 0,
        executed: body.isExecuted === true,
      };
    }
    if (response.status !== 404 && response.status !== 429) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
  }
  throw new Error(`Safe service transaction failed: HTTP ${lastStatus}`);
}

export async function proposerBalanceWei(
  env: Pick<SafeEnv, "rpcUrl" | "proposerPrivateKey">,
): Promise<{ address: Address; balance: bigint }> {
  const address = addressForPrivateKey(env.proposerPrivateKey, "SAFE_PROPOSER_PRIVATE_KEY");
  const balance = await publicClient(env.rpcUrl).getBalance({ address });
  return { address, balance };
}

export async function readSafeThreshold(
  env: Pick<SafeEnv, "rpcUrl" | "safeAddress" | "proposerPrivateKey">,
): Promise<number> {
  const protocolKit = await Safe.init({
    provider: env.rpcUrl,
    signer: normalizePrivateKey(env.proposerPrivateKey, "SAFE_PROPOSER_PRIVATE_KEY"),
    safeAddress: getAddress(env.safeAddress),
  });
  return protocolKit.getThreshold();
}

export async function deployThresholdSafe(env: SafeEnv): Promise<{ safeAddress: Address; deploymentHash: Hex | null }> {
  if (env.threshold <= 1) {
    throw new Error("Safe threshold must be greater than 1");
  }
  if (env.threshold !== 2) {
    throw new Error("Safe threshold must be 2");
  }

  const proposerKey = normalizePrivateKey(env.proposerPrivateKey, "SAFE_PROPOSER_PRIVATE_KEY");
  const proposer = privateKeyToAccount(proposerKey);
  const cosigner = addressForPrivateKey(env.cosignerPrivateKey, "SAFE_COSIGNER_PRIVATE_KEY");
  if (proposer.address.toLowerCase() === cosigner.toLowerCase()) {
    throw new Error("Safe owners must be two different addresses");
  }

  const owners = [proposer.address, cosigner].sort((left, right) => left.toLowerCase().localeCompare(right.toLowerCase()));
  const protocolKit = await Safe.init({
    provider: env.rpcUrl,
    signer: proposerKey,
    predictedSafe: {
      safeAccountConfig: {
        owners,
        threshold: env.threshold,
      },
      safeDeploymentConfig: {
        saltNonce: "1",
      },
    },
  });

  const predicted = getAddress(await protocolKit.getAddress());
  const client = publicClient(env.rpcUrl);
  const code = await client.getBytecode({ address: predicted });
  if (code && code !== "0x") {
    const connected = await protocolKit.connect({ safeAddress: predicted });
    const threshold = await connected.getThreshold();
    if (!(threshold > 1)) {
      throw new Error("Safe threshold must be greater than 1");
    }
    return { safeAddress: predicted, deploymentHash: null };
  }

  const deployment = await protocolKit.createSafeDeploymentTransaction();
  const signer = await protocolKit.getSafeProvider().getExternalSigner();
  if (!signer) {
    throw new Error("Missing SAFE_PROPOSER_PRIVATE_KEY");
  }

  const hash = await signer.sendTransaction({
    account: proposer,
    chain: sepolia,
    to: getAddress(deployment.to),
    value: BigInt(deployment.value || 0),
    data: deployment.data as Hex,
  });
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (receipt.status !== "success") {
    throw new Error("Safe deployment failed");
  }

  const connected = await protocolKit.connect({ safeAddress: predicted });
  if (!(await connected.isSafeDeployed())) {
    throw new Error("Safe deployment failed");
  }
  const threshold = await connected.getThreshold();
  if (!(threshold > 1)) {
    throw new Error("Safe threshold must be greater than 1");
  }
  return { safeAddress: predicted, deploymentHash: hash };
}

export async function findOpenUsdcTransfer(
  env: Pick<SafeEnv, "txServiceUrl" | "chainId" | "safeAddress">,
  request: TokenTransferRequest,
): Promise<string | null> {
  try {
    const apiKit = new SafeApiKit({
      chainId: BigInt(env.chainId),
      txServiceUrl: serviceApiBase(env.txServiceUrl),
    });
    const list = await apiKit.getPendingTransactions(getAddress(env.safeAddress));
    const expected = encodeUsdcTransfer(request).toLowerCase();
    const token = getAddress(request.token).toLowerCase();
    const results = Array.isArray(list.results) ? list.results : [];
    for (const tx of results) {
      if (tx.isExecuted) {
        continue;
      }
      if ((tx.to ?? "").toLowerCase() !== token) {
        continue;
      }
      if ((tx.data ?? "").toLowerCase() !== expected) {
        continue;
      }
      return safeServiceTransactionUrl(env.txServiceUrl, tx.safeTxHash);
    }
    return null;
  } catch {
    return null;
  }
}

export async function createSepoliaProposer(
  env: Pick<SafeEnv, "rpcUrl" | "txServiceUrl" | "chainId" | "safeAddress" | "proposerPrivateKey">,
): Promise<SafeProposer> {
  const proposerKey = normalizePrivateKey(env.proposerPrivateKey, "SAFE_PROPOSER_PRIVATE_KEY");
  const proposer = privateKeyToAccount(proposerKey);
  const safeAddress = getAddress(env.safeAddress);
  const protocolKit = await Safe.init({
    provider: env.rpcUrl,
    signer: proposerKey,
    safeAddress,
  });
  const apiKit = new SafeApiKit({
    chainId: BigInt(env.chainId),
    txServiceUrl: serviceApiBase(env.txServiceUrl),
  });

  return {
    async threshold() {
      return protocolKit.getThreshold();
    },
    async proposeTokenTransfer(request: TokenTransferRequest): Promise<ProposedTransfer> {
      const threshold = await protocolKit.getThreshold();
      if (!(threshold > 1)) {
        throw new Error("Safe threshold must be greater than 1");
      }

      const safeTransaction = await protocolKit.createTransaction({
        transactions: [
          {
            to: getAddress(request.token),
            value: "0",
            data: encodeUsdcTransfer(request),
          },
        ],
      });
      const safeTxHash = await protocolKit.getTransactionHash(safeTransaction);
      const signature = await protocolKit.signHash(safeTxHash);
      await apiKit.proposeTransaction({
        safeAddress,
        safeTransactionData: safeTransaction.data,
        safeTxHash,
        senderAddress: proposer.address,
        senderSignature: signature.data,
      });

      const url = safeServiceTransactionUrl(env.txServiceUrl, safeTxHash);
      const posted = await readServiceTransaction(url);
      return {
        safeTxHash,
        url,
        confirmations: posted.confirmations,
        threshold: posted.threshold,
      };
    },
  };
}
