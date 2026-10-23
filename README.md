# Spendwarden

Spendwarden is an agent that reviews a proposed crypto treasury payout and decides whether to approve, escalate, or block it. This repository is the hackathon scaffold. The decision pipeline is not implemented yet.

## Setup

```bash
npm install
npm run build:sample
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Copy `.env.example` to `.env.local` when later parts need Zetaris, Meterless, or a Sepolia Safe. Leave secrets out of git.

## Sample data

Everything under `data/sample/` is fictional sample data for a demo. It is not a real treasury, vendor list, or payment history.

The architecture diagram and sponsor-tech section come in a later part.
