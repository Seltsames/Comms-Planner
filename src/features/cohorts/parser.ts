import type {
  CohortParseMessage,
  CohortParseProgress,
  CohortParseRequest,
  CohortResult,
} from "./types";
import { formatBytes, formatNumber } from "@/lib/format";

export interface ParseCohortOptions extends Omit<CohortParseRequest, "file"> {
  file: File;
  onProgress?: (progress: CohortParseProgress) => void;
}

export function parseCohortCsv({
  file,
  mode,
  cityCode,
  cityName,
  regexSource,
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

    worker.postMessage({ file, mode, cityCode, cityName, regexSource } satisfies CohortParseRequest);
  });
}

export { formatBytes, formatNumber };
