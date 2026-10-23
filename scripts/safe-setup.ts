import { generatePrivateKey } from "viem/accounts";

import { loadSafeEnv, readEnvFile, upsertEnv } from "../src/safe/env";
import { addressForPrivateKey, deployThresholdSafe, proposerBalanceWei, readSafeThreshold } from "../src/safe/sepolia";

function ensureKeys(): { proposer: string; cosigner: string } {
  const file = readEnvFile();
  const updates: Record<string, string> = {};
  let proposerKey = file.SAFE_PROPOSER_PRIVATE_KEY?.trim() ?? "";
  let cosignerKey = file.SAFE_COSIGNER_PRIVATE_KEY?.trim() ?? "";
  if (!proposerKey) {
    proposerKey = generatePrivateKey();
    updates.SAFE_PROPOSER_PRIVATE_KEY = proposerKey;
  }
  if (!cosignerKey) {
    cosignerKey = generatePrivateKey();
    updates.SAFE_COSIGNER_PRIVATE_KEY = cosignerKey;
  }
  if (!file.SAFE_THRESHOLD?.trim()) {
    updates.SAFE_THRESHOLD = "2";
  }
  if (Object.keys(updates).length > 0) {
    upsertEnv(updates);
  }
  return {
    proposer: addressForPrivateKey(proposerKey, "SAFE_PROPOSER_PRIVATE_KEY"),
    cosigner: addressForPrivateKey(cosignerKey, "SAFE_COSIGNER_PRIVATE_KEY"),
  };
}

async function main() {
  const addresses = ensureKeys();
  console.log(`Proposer address: ${addresses.proposer}`);
  console.log(`Cosigner address: ${addresses.cosigner}`);

  const env = loadSafeEnv({ requireKeys: true });
  if (env.safeAddress) {
    const threshold = await readSafeThreshold(env);
    if (!(threshold > 1)) {
      throw new Error("Safe threshold must be greater than 1");
    }
    console.log(`Safe ${env.safeAddress} threshold ${threshold}`);
    return;
  }

  const { address, balance } = await proposerBalanceWei(env);
  if (balance === BigInt(0)) {
    console.log(
      `Proposer ${address} has 0 Sepolia ETH. Fund this address from a Sepolia faucet, then rerun npm run safe:setup.`,
    );
    process.exitCode = 1;
    return;
  }

  const deployed = await deployThresholdSafe(env);
  upsertEnv({ SAFE_ADDRESS: deployed.safeAddress });
  const threshold = await readSafeThreshold({ ...env, safeAddress: deployed.safeAddress });
  if (!(threshold > 1)) {
    throw new Error("Safe threshold must be greater than 1");
  }
  if (deployed.deploymentHash) {
    console.log(`Deployment transaction ${deployed.deploymentHash}`);
  }
  console.log(`Safe ${deployed.safeAddress} threshold ${threshold}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
