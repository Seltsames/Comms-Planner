/// <reference lib="webworker" />

import type { CohortParseMessage, CohortParseRequest } from "./types";

const DRV_REGEX_STRICT = /^6509\d{11}$/;
const PROGRESS_INTERVAL_LINES = 1000;

self.onmessage = async (event: MessageEvent<CohortParseRequest>) => {
  const { file, mode, cityCode, cityName } = event.data;
  const startTime = performance.now();

  try {
    const text = await file.text();
    const lines = text.split(/\r?\n/);
    const total = lines.length;

    const validIds: string[] = [];
    const seen = new Set<string>();
    let invalidCount = 0;
    let duplicateCount = 0;
    let processed = 0;

    const post = (msg: CohortParseMessage) => self.postMessage(msg);

    post({
      type: "progress",
      data: {
        processed: 0,
        total,
        validCount: 0,
        duplicateCount: 0,
        invalidCount: 0,
        phase: "reading",
      },
    });

    for (let i = 0; i < total; i++) {
      const line = lines[i];
      if (line.length === 0) {
        processed++;
        continue;
      }
      const trimmed = line.trim();
      const id = DRV_REGEX_STRICT.exec(trimmed)?.[0];
      if (id) {
        if (seen.has(id)) {
          duplicateCount++;
        } else {
          seen.add(id);
          validIds.push(id);
        }
      } else if (trimmed.length > 0) {
        invalidCount++;
      }

      processed++;
      if (processed % PROGRESS_INTERVAL_LINES === 0) {
        post({
          type: "progress",
          data: {
            processed,
            total,
            validCount: validIds.length,
            duplicateCount,
            invalidCount,
            phase: "validating",
          },
        });
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    post({
      type: "progress",
      data: {
        processed: total,
        total,
        validCount: validIds.length,
        duplicateCount,
        invalidCount,
        phase: "validating",
      },
    });

    const result = {
      mode,
      cityCode,
      cityName,
      fileName: file.name,
      fileSize: file.size,
      totalLines: total,
      validIds,
      invalidCount,
      duplicateCount,
      parsedAt: Date.now(),
      durationMs: Math.round(performance.now() - startTime),
    };

    post({ type: "done", data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido al procesar el CSV";
    self.postMessage({ type: "error", message } satisfies CohortParseMessage);
  }
};

export {};
