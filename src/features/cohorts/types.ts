export type CohortMode = "general" | "per-city";

export interface CohortResult {
  mode: CohortMode;
  cityCode: string | null;
  cityName: string | null;
  fileName: string;
  fileSize: number;
  totalLines: number;
  validIds: string[];
  invalidCount: number;
  duplicateCount: number;
  parsedAt: number;
  durationMs: number;
}

export interface CohortParseProgress {
  processed: number;
  total: number;
  validCount: number;
  duplicateCount: number;
  invalidCount: number;
  phase: "reading" | "validating" | "done";
}

export type CohortParseMessage =
  | { type: "progress"; data: CohortParseProgress }
  | { type: "done"; data: CohortResult }
  | { type: "error"; message: string };

export type CohortParseRequest = {
  file: File;
  mode: CohortMode;
  cityCode: string | null;
  cityName: string | null;
};
