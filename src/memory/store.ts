import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export type MemoryEntity = {
  name: string;
  type: string;
};

export type MemoryProvenance = {
  origin: "user_explicit";
  learnedAt: number;
  label: string;
};

export type MemoryRecord = {
  id: string;
  content: string;
  type: "factual";
  layer: "long_term";
  timestamp: number;
  lastAccessed: number;
  accessCount: number;
  tags: string[];
  confidence: number;
  source: string;
  provenance: MemoryProvenance;
  entities: MemoryEntity[];
  relatedTo: string[];
  supersededBy?: string;
  derivedFrom: string[];
};

export type LedgerEntry = {
  id: string;
  memoryId: string;
  action: "create";
  actor: string;
  timestamp: number;
  newState: { content: string };
};

export type ExceptionWrite = {
  content: string;
  signerId: string;
  vendor: string;
  wallet: string;
  category: string;
  source?: string;
};

type Snapshot = {
  memories: MemoryRecord[];
  ledger: LedgerEntry[];
  nextId: number;
};

const ENTITY_CAP = 10;

function exceptionSource(input: ExceptionWrite): string {
  const explicit = input.source?.trim() ?? "";
  if (explicit.length > 0) {
    return explicit;
  }
  const signerId = input.signerId.trim();
  if (signerId.length === 0) {
    return "";
  }
  return `signer:${signerId}`;
}

export class HmemStore {
  private memories: MemoryRecord[] = [];
  private ledgerEntries: LedgerEntry[] = [];
  private nextId = 1;
  private readonly clock: () => number;
  private readonly filePath: string | undefined;

  constructor(options?: { clock?: () => number; filePath?: string }) {
    this.clock = options?.clock ?? (() => Date.now());
    this.filePath = options?.filePath;
    if (this.filePath) {
      this.load();
    }
  }

  get ledger(): readonly LedgerEntry[] {
    return this.ledgerEntries;
  }

  writeException(input: ExceptionWrite): MemoryRecord {
    const source = exceptionSource(input);
    if (source.length === 0) {
      throw new Error("Missing source");
    }

    const learnedAt = this.clock();
    const signerId = input.signerId.trim();
    const id = `mem_${this.nextId}`;
    const ledgerId = `led_${this.nextId}`;
    this.nextId += 1;

    const record: MemoryRecord = {
      id,
      content: input.content,
      type: "factual",
      layer: "long_term",
      timestamp: learnedAt,
      lastAccessed: learnedAt,
      accessCount: 0,
      tags: ["exception"],
      confidence: 0.9,
      source,
      provenance: {
        origin: "user_explicit",
        learnedAt,
        label: `Signed by ${signerId} at ${learnedAt}`,
      },
      entities: [
        { name: input.vendor, type: "vendor" },
        { name: input.wallet, type: "wallet" },
        { name: input.category, type: "category" },
      ].slice(0, ENTITY_CAP),
      relatedTo: [],
      derivedFrom: [],
    };

    this.memories.push(record);
    this.ledgerEntries.push({
      id: ledgerId,
      memoryId: id,
      action: "create",
      actor: signerId,
      timestamp: learnedAt,
      newState: { content: input.content },
    });
    this.save();
    return record;
  }

  findException(vendor: string, category: string): MemoryRecord | undefined {
    return this.memories.find(
      (memory) =>
        !memory.supersededBy &&
        hasEntity(memory, "vendor", vendor) &&
        hasEntity(memory, "category", category),
    );
  }

  private load(): void {
    if (!this.filePath) {
      return;
    }
    try {
      const snapshot = JSON.parse(readFileSync(this.filePath, "utf8")) as Snapshot;
      this.memories = snapshot.memories ?? [];
      this.ledgerEntries = snapshot.ledger ?? [];
      this.nextId = snapshot.nextId ?? this.memories.length + 1;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      throw error;
    }
  }

  private save(): void {
    if (!this.filePath) {
      return;
    }
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    const snapshot: Snapshot = {
      memories: this.memories,
      ledger: this.ledgerEntries,
      nextId: this.nextId,
    };
    writeFileSync(this.filePath, JSON.stringify(snapshot));
  }
}

function hasEntity(memory: MemoryRecord, type: string, name: string): boolean {
  return memory.entities.some((entity) => entity.type === type && entity.name === name);
}
