import { readFileSync } from "node:fs";
import path from "node:path";
import { ParquetReader, ParquetSchema, ParquetWriter } from "@dsnp/parquetjs";

const csvPath = path.join(process.cwd(), "data", "sample", "payments_history.csv");
const parquetPath = path.join(process.cwd(), "data", "sample", "payments_history.parquet");

const columns = [
  "payment_id",
  "invoice_id",
  "vendor",
  "wallet",
  "amount_usd",
  "token",
  "token_address",
  "category",
  "paid_at",
  "quarter",
  "tx_hash",
] as const;

function textField() {
  return { type: "UTF8" as const, compression: "UNCOMPRESSED" as const };
}

const schema = new ParquetSchema({
  payment_id: textField(),
  invoice_id: textField(),
  vendor: textField(),
  wallet: textField(),
  amount_usd: { type: "DOUBLE", compression: "UNCOMPRESSED" },
  token: textField(),
  token_address: textField(),
  category: textField(),
  paid_at: textField(),
  quarter: textField(),
  tx_hash: textField(),
});

function parsePayments(csv: string): Record<string, string | number>[] {
  const lines = csv.trim().split(/\r?\n/);
  const header = lines[0]?.split(",") ?? [];
  if (header.join(",") !== columns.join(",")) {
    throw new Error(`Unexpected payments_history.csv header: ${header.join(",")}`);
  }

  return lines.slice(1).flatMap((line, index) => {
    if (line.length === 0) {
      return [];
    }
    const cells = line.split(",");
    if (cells.length !== header.length) {
      throw new Error(`Row ${index + 2} has ${cells.length} columns, expected ${header.length}.`);
    }
    const record = Object.fromEntries(header.map((name, cellIndex) => [name, cells[cellIndex] ?? ""]));
    const amount = Number(record.amount_usd);
    if (!Number.isFinite(amount)) {
      throw new Error(`Row ${index + 2} has an invalid amount_usd.`);
    }
    return [{ ...record, amount_usd: amount }];
  });
}

async function countRows(filePath: string): Promise<number> {
  const reader = await ParquetReader.openFile(filePath);
  const cursor = reader.getCursor();
  let count = 0;
  let row: unknown = await cursor.next();
  while (row) {
    count += 1;
    row = await cursor.next();
  }
  await reader.close();
  return count;
}

async function main() {
  const rows = parsePayments(readFileSync(csvPath, "utf8"));
  const writer = await ParquetWriter.openFile(schema, parquetPath);
  for (const row of rows) {
    await writer.appendRow(row);
  }
  await writer.close();

  const count = await countRows(parquetPath);
  if (count !== 6) {
    throw new Error(`Expected 6 parquet rows, wrote ${count}.`);
  }
  console.log(`rows=${count}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
