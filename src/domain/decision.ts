export type DecisionName = "APPROVE" | "ESCALATE" | "BLOCK";

export type Evidence = {
  source: string;
  ref: string;
};

export type MemoryUse = {
  id: string;
  content: string;
  source: string;
};

export type DecisionRecord = {
  decision: DecisionName;
  confidence: number;
  reasons: string[];
  evidence: Evidence[];
  memory_used: MemoryUse[];
};
