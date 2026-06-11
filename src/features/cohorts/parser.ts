import type {
  CohortParseMessage,
  CohortParseProgress,
  CohortParseRequest,
  CohortResult,
} from "./types";

export interface ParseCohortOptions extends Omit<CohortParseRequest, "file"> {
  file: File;
  onProgress?: (progress: CohortParseProgress) => void;
}

export function parseCohortCsv({
  file,
  mode,
  cityCode,
  cityName,
  onProgress,
}: ParseCohortOptions): Promise<CohortResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./csvParser.worker.ts", import.meta.url), {
      type: "module",
    });

    worker.onmessage = (event: MessageEvent<CohortParseMessage>) => {
      const msg = event.data;
      if (msg.type === "progress") {
        onProgress?.(msg.data);
      } else if (msg.type === "done") {
        worker.terminate();
        resolve(msg.data);
      } else if (msg.type === "error") {
        worker.terminate();
        reject(new Error(msg.message));
      }
    };

    worker.onerror = (err) => {
      worker.terminate();
      reject(new Error(err.message || "Worker error"));
    };

    worker.postMessage({ file, mode, cityCode, cityName } satisfies CohortParseRequest);
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatNumber(n: number): string {
  return n.toLocaleString("es-MX");
}
