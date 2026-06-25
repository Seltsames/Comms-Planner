import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const DRV_REGEX_STRICT = /^6509\d{11}$/;

const argPath = process.argv[2];
const defaultPath = resolve("..", "CAP_PROSP_MX_W21.csv");
const csvPath = argPath ? resolve(argPath) : defaultPath;

if (!existsSync(csvPath)) {
  console.error(`CSV not found: ${csvPath}`);
  console.error("Usage: node scripts/test-cohort.mjs <path/to/cohort.csv>");
  process.exit(1);
}

const text = readFileSync(csvPath, "utf8");
const lines = text.split(/\r?\n/);

const validIds = [];
const seen = new Set();
let invalidCount = 0;
let duplicateCount = 0;
const start = performance.now();

for (const line of lines) {
  if (line.length === 0) continue;
  const trimmed = line.trim();
  const id = DRV_REGEX_STRICT.exec(trimmed)?.[0];
  if (id) {
    if (seen.has(id)) duplicateCount++;
    else {
      seen.add(id);
      validIds.push(id);
    }
  } else if (trimmed.length > 0) invalidCount++;
}

const dur = Math.round(performance.now() - start);
console.log(JSON.stringify({
  totalLines: lines.length,
  validUnique: validIds.length,
  invalidCount,
  duplicateCount,
  durationMs: dur,
  firstId: validIds[0],
  lastId: validIds[validIds.length - 1],
  sample: validIds.slice(0, 5),
  allIdsHave15Digits: validIds.every((id) => id.length === 15),
  allIdsStartWith6509: validIds.every((id) => id.startsWith("6509")),
}, null, 2));
