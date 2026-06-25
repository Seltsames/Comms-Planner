import { formatBytes, formatNumber } from "@/lib/format";
import { CSV_VALIDATORS } from "@/lib/constants";
import type { AudienceKind } from "@/lib/auth";
import type { CohortResult } from "./types";

interface CohortSummaryProps {
  result: CohortResult;
  onClear?: () => void;
  variant?: "general" | "per-city";
  kind?: AudienceKind;
}

export function CohortSummary({
  result,
  onClear,
  variant = "general",
  kind = "drv",
}: CohortSummaryProps) {
  const totalUnique = result.validIds.length;
  const totalProcessed = result.totalLines;
  const hasIssues = result.invalidCount > 0 || result.duplicateCount > 0;

  const validator = CSV_VALIDATORS[kind];
  const headerLabel =
    variant === "general"
      ? `Cohorte general (${validator.label})`
      : `Cohorte · ${validator.label} · ${result.cityName ?? result.cityCode ?? "ciudad"}`;

  return (
    <div
      data-testid="cohort-summary"
      className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
            {headerLabel}
          </p>
          <p className="mt-0.5 truncate text-sm font-medium text-slate-900" title={result.fileName}>
            {result.fileName}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {formatBytes(result.fileSize)} · {formatNumber(totalProcessed)} líneas · {result.durationMs} ms
          </p>
        </div>
        {onClear && (
          <button
            type="button"
            onClick={onClear}
            aria-label="Quitar cohorte"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-emerald-600 transition hover:bg-emerald-100 hover:text-emerald-800"
          >
            ×
          </button>
        )}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <Stat label="Válidos (únicos)" value={totalUnique} tone="success" />
        <Stat label="Duplicados" value={result.duplicateCount} tone={result.duplicateCount > 0 ? "warning" : "muted"} />
        <Stat label="Inválidos" value={result.invalidCount} tone={result.invalidCount > 0 ? "danger" : "muted"} />
      </div>

      {hasIssues && (
        <p className="mt-3 text-xs text-slate-600">
          {result.invalidCount > 0 && (
            <>
              <span className="font-semibold text-red-700">{formatNumber(result.invalidCount)}</span>{" "}
              líneas con formato inválido (no son {validator.label} válidos: {validator.hint}).
            </>
          )}
          {result.invalidCount > 0 && result.duplicateCount > 0 && " "}
          {result.duplicateCount > 0 && (
            <>
              <span className="font-semibold text-amber-700">{formatNumber(result.duplicateCount)}</span>{" "}
              duplicados fueron omitidos.
            </>
          )}
        </p>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "success" | "warning" | "danger" | "muted";
}) {
  const tones: Record<string, string> = {
    success: "text-emerald-700",
    warning: "text-amber-700",
    danger: "text-red-700",
    muted: "text-slate-500",
  };
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-bold ${tones[tone]}`}>{formatNumber(value)}</p>
    </div>
  );
}
