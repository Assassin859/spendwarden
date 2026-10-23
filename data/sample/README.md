# Sample treasury data

These files are fictional sample data for the Spendwarden hackathon demo. They are not a real DAO treasury, vendor list, invoice history, or set of wallets. Wallet addresses are obviously fake. Transaction hashes are repeated nibbles, not real Sepolia transactions.

Do not put comments inside the CSV files. Zetaris will treat the first row as the header.

`payments_history.csv` is the readable copy. `payments_history.parquet` is built from that CSV with `npm run build:sample`. Register the parquet file later, not the CSV.

`budgets.csv` `spent_usd` for `2026Q4` is the sum of the `2026Q4` rows in the payment history:

- infrastructure 8000
- audit 12000
- operations 4500
- legal 0
- design 0

`USDC` amounts use Circle's Sepolia USDC contract `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`. That testnet token has no financial value.

## Proposed payouts

`proposed_payouts.json` is the intake queue, not payment history. No decision is made from these rows yet.

- A `pay-helios`: known vendor, known wallet, 2500 USDC, under the infrastructure cap, new invoice.
- B `pay-northline-dup`: invoice `INV-2026-0912` already appears in payment history.
- C `pay-kite-new-wallet`: Kite Supplies is a known vendor, but the payout wallet is not the wallet on file.
- D1 `pay-orbit-over-cap`: 8000 USDC against a 5000 legal per-transaction cap.
- D2 `pay-pylon-over-cap`: 7500 USDC against a 4000 design per-transaction cap.

Shadow Relay in `vendors.csv` is flagged. It is not one of the proposed payouts.
