export type PayoutProposal = {
  id: string;
  scenario: "A" | "B" | "C" | "D1" | "D2";
  recipient: string;
  wallet: string;
  amountUsd: number;
  token: "USDC";
  category: string;
  reason: string;
  invoiceId: string;
};
