import { readFileSync } from "node:fs";
import path from "node:path";

import type { PayoutProposal } from "../src/domain/payout";
import { loadZetarisEnv } from "../src/zetaris/env";
import { payoutSources } from "../src/zetaris/queries";
import { registerSampleSources } from "../src/zetaris/register";

function loadProposals(): PayoutProposal[] {
  const filePath = path.join(process.cwd(), "data", "sample", "proposed_payouts.json");
  const proposals = JSON.parse(readFileSync(filePath, "utf8")) as PayoutProposal[];
  if (!Array.isArray(proposals) || proposals.length !== 5) {
    throw new Error("Expected five sample proposals");
  }
  return proposals;
}

async function main() {
  const register = process.argv.includes("--register");
  let env;
  try {
    env = loadZetarisEnv({ requireDataPath: register });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }

  if (register) {
    await registerSampleSources(env);
  }

  const results = [];
  for (const proposal of loadProposals()) {
    results.push(await payoutSources(proposal, env));
  }
  console.log(JSON.stringify(results, null, 2));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
