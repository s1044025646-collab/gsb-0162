export type Matrix = number[][];

export interface SolveParams {
  tolerance: number;
  budget: number;
  reduceStrictDom?: boolean;
  requestId?: string;
}

export interface BestResponses {
  rowPlayer: number[];
  columnPlayer: number[];
  rowPayoffs: number[];
  columnPayoffs: number[];
}

export interface DominanceEvidence {
  role: "row" | "column";
  removedIndex: number;
  keptIndex: number;
  payoffDifferences: number[];
}

export interface SolveResult {
  status: "equilibrium" | "unproven";
  stopReason: "optimal" | "budget_exhausted" | "infeasible_numerical";
  algorithm: "deterministic-active-constraint-vertex-enumeration";
  tolerance: number;
  budget: number;
  candidatesExamined: number;
  value: number | null;
  rowStrategy: number[];
  columnStrategy: number[];
  rowSupport: number[];
  columnSupport: number[];
  bestResponses: BestResponses | null;
  lowerBound: number | null;
  upperBound: number | null;
  dualityGap: number | null;
  optimalVertexCount: number;
  uniqueAtVertices: boolean;
  reduction: {
    used: boolean;
    originalRows: number;
    originalColumns: number;
    reducedRows: number;
    reducedColumns: number;
    rowMap: number[];
    columnMap: number[];
    evidence: DominanceEvidence[];
  };
}

export interface StrategyValidation {
  valid: boolean;
  errorCode?: string;
  message?: string;
  rowStrategy?: number[];
  columnStrategy?: number[];
  expectedPayoffsByColumn: number[];
  expectedPayoffsByRow: number[];
  guaranteedLowerBound: number;
  guaranteedUpperBound: number;
  rowBestResponses: number[];
  columnBestResponses: number[];
  gap: number;
  isEquilibrium: boolean;
}
