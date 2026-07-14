import { useEffect, useRef, useState } from "react";
import { CITIES_DATA, CSV_VALIDATORS } from "@/lib/constants";
import type { AudienceKind } from "@/lib/auth";
import { CohortSummary } from "./CohortSummary";
import { formatBytes, formatNumber, parseCohortCsv } from "./parser";
import type {
  CohortMode,
  CohortParseProgress,
  CohortResult,
} from "./types";

export interface CohortState {
  general: CohortResult | null;
  byCity: Record<string, CohortResult>;
}

interface CohortUploaderProps {
  country: string;
  selectedCityCodes: string[];
  value: CohortState;
  onChange: (state: CohortState) => void;
  kind: AudienceKind;
}

export function CohortUploader({
  country,
  selectedCityCodes,
  value,
  onChange,
  kind,
}: CohortUploaderProps) {
  const [mode, setMode] = useState<CohortMode>("general");
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [progress, setProgress] = useState<CohortParseProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cityListOpen, setCityListOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cityInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const validator = CSV_VALIDATORS[kind];

  const showPerCityToggle = selectedCityCodes.length > 1;

  useEffect(() => {
    if (!showPerCityToggle && mode === "per-city") {
      setMode("general");
    }
  }, [showPerCityToggle, mode]);

  useEffect(() => {
    if (mode === "general" && activeKey !== null) {
      setActiveKey(null);
      setProgress(null);
    }
  }, [mode, activeKey]);

  if (selectedCityCodes.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
        Selecciona al menos una ciudad para cargar el cohorte.
      </div>
    );
  }

  function handleFileChange(file: File, target: string | null) {
    setError(null);
    setProgress({ processed: 0, total: 0, validCount: 0, duplicateCount: 0, invalidCount: 0, phase: "reading" });
    setActiveKey(target ?? "__general__");

    parseCohortCsv({
      file,
      mode: target ? "per-city" : "general",
      cityCode: target,
      cityName: target ? (CITIES_DATA.find((c) => c.id === target)?.name ?? target) : null,
      regexSource: validator.regex.source,
      onProgress: (p) => setProgress(p),
    })
      .then((result) => {
        if (result.validIds.length === 0) {
          setError(`El archivo no contiene ${validator.label} válidos (${validator.hint}).`);
          setActiveKey(null);
          setProgress(null);
          return;
        }
        if (target) {
          onChange({
            ...value,
            byCity: { ...value.byCity, [target]: result },
          });
        } else {
          onChange({ ...value, general: result });
        }
        setActiveKey(null);
        setProgress(null);
      })
      .catch((err: Error) => {
        setError(err.message);
        setActiveKey(null);
        setProgress(null);
      })
      .finally(() => {
        const input = target
          ? cityInputRefs.current[target]
          : fileInputRef.current;
        if (input) input.value = "";
      });
  }

  function clearGeneral() {
    onChange({ ...value, general: null });
    setError(null);
  }
  function clearCity(code: string) {
    const next = { ...value.byCity };
    delete next[code];
    onChange({ ...value, byCity: next });
  }

  const isLoading = progress !== null;
  const isGeneral = mode === "general";
  const canSwitchMode = !isLoading;

  return (
    <div className="space-y-4">
      {showPerCityToggle && (
        <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 text-sm shadow-sm">
          <ModeButton
            active={isGeneral}
            disabled={!canSwitchMode}
            onClick={() => setMode("general")}
            label="Cohorte general"
          />
          <ModeButton
            active={!isGeneral}
            disabled={!canSwitchMode}
            onClick={() => setMode("per-city")}
            label="Por ciudad"
          />
        </div>
      )}

      {isGeneral ? (
        <div className="space-y-3">
          {value.general ? (
            <CohortSummary result={value.general} onClear={clearGeneral} variant="general" kind={kind} />
          ) : (
            <UploadDropZone
              label="Subir CSV general (un archivo para todas las ciudades)"
              isLoading={isLoading}
              onPickFile={() => fileInputRef.current?.click()}
              disabled={isLoading}
              validatorLabel={validator.label}
              validatorHint={validator.hint}
            />
          )}
          {isLoading && progress && activeKey === "__general__" && (
            <ProgressBar progress={progress} />
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv,text/plain"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileChange(file, null);
            }}
          />
        </div>
      ) : (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setCityListOpen((v) => !v)}
            className="flex items-center gap-1.5 text-xs font-semibold text-brand-600 transition hover:text-brand-700"
          >
            <span
              className={`inline-block text-[10px] transition-transform ${
                cityListOpen ? "rotate-90" : ""
              }`}
            >
              ▶
            </span>
            {cityListOpen ? "Ocultar ciudades" : "Ver ciudades"} (
            {selectedCityCodes.filter((c) => value.byCity[c]).length} de{" "}
            {selectedCityCodes.length} con CSV)
          </button>
          {cityListOpen &&
            selectedCityCodes.map((code) => {
            const city = CITIES_DATA.find((c) => c.id === code);
            const cityName = city?.name ?? code;
            const cohort = value.byCity[code];
            const isActive = activeKey === code;
            return (
              <div key={code} className="space-y-2">
                {cohort ? (
                  <CohortSummary
                    result={cohort}
                    onClear={() => clearCity(code)}
                    variant="per-city"
                    kind={kind}
                  />
                ) : (
                  <UploadDropZone
                    label={`${cityName}`}
                    isLoading={isLoading && isActive}
                    onPickFile={() => cityInputRefs.current[code]?.click()}
                    disabled={isLoading}
                    validatorLabel={validator.label}
                    validatorHint={validator.hint}
                  />
                )}
                {isLoading && isActive && progress && <ProgressBar progress={progress} />}
                <input
                  ref={(el) => {
                    cityInputRefs.current[code] = el;
                  }}
                  type="file"
                  accept=".csv,text/csv,text/plain"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileChange(file, code);
                  }}
                />
              </div>
            );
            })}
          {value.general && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Tienes una cohorte general cargada. Las ciudades con CSV propio la reemplazan; las
              demás usan la general.
            </p>
          )}
        </div>
      )}

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}

      <CohortResolutionPreview
        country={country}
        selectedCityCodes={selectedCityCodes}
        value={value}
      />
    </div>
  );
}

function ModeButton({
  active,
  disabled,
  onClick,
  label,
}: {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg px-4 py-1.5 font-semibold transition disabled:opacity-50 ${
        active ? "bg-brand-500 text-white" : "text-slate-600"
      }`}
    >
      {label}
    </button>
  );
}

function UploadDropZone({
  label,
  isLoading,
  onPickFile,
  disabled,
  validatorLabel,
  validatorHint,
}: {
  label: string;
  isLoading: boolean;
  onPickFile: () => void;
  disabled: boolean;
  validatorLabel: string;
  validatorHint: string;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-xl border border-dashed px-4 py-3 ${
        isLoading ? "border-brand-300 bg-brand-50" : "border-slate-300 bg-slate-50"
      }`}
    >
<div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-700">{label}</p>
          <p className="text-xs text-slate-500">
            {isLoading ? "Procesando archivo…" : `CSV con un ${validatorLabel} (${validatorHint}) por línea.`}
          </p>
        </div>
      <button
        type="button"
        onClick={onPickFile}
        disabled={disabled}
        className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-brand-300 hover:text-brand-600 disabled:opacity-50"
      >
        Subir CSV
      </button>
    </div>
  );
}

function ProgressBar({ progress }: { progress: CohortParseProgress }) {
  const pct = progress.total > 0 ? Math.min(100, Math.round((progress.processed / progress.total) * 100)) : 0;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="mb-1.5 flex items-center justify-between text-xs text-slate-600">
        <span className="font-semibold">Procesando…</span>
        <span>
          {formatNumber(progress.processed)} / {formatNumber(progress.total)} · {pct}%
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full bg-brand-500 transition-all duration-200"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-2 text-[10px] text-slate-500">
        {formatNumber(progress.validCount)} válidos · {formatNumber(progress.duplicateCount)} duplicados ·{" "}
        {formatNumber(progress.invalidCount)} inválidos
      </p>
    </div>
  );
}

function CohortResolutionPreview({
  country: _country,
  selectedCityCodes,
  value,
}: {
  country: string;
  selectedCityCodes: string[];
  value: CohortState;
}) {
  const [detailOpen, setDetailOpen] = useState(false);
  const resolution = selectedCityCodes.map((code) => {
    const city = CITIES_DATA.find((c) => c.id === code);
    const cityName = city?.name ?? code;
    const perCity = value.byCity[code];
    const source: "per-city" | "general" | "none" = perCity ? "per-city" : value.general ? "general" : "none";
    const count = perCity ? perCity.validIds.length : value.general ? value.general.validIds.length : 0;
    return { code, cityName, source, count };
  });

  const totalUnique = new Set(resolution.flatMap((r) => {
    if (r.source === "none") return [];
    const cohort = r.source === "per-city" ? value.byCity[r.code] : value.general;
    return cohort?.validIds ?? [];
  })).size;

  const allResolved = resolution.every((r) => r.source !== "none");

  if (selectedCityCodes.length === 0) return null;

  return (
    <div
      className={`rounded-xl border p-3 text-xs ${
        allResolved ? "border-slate-200 bg-white" : "border-amber-200 bg-amber-50"
      }`}
    >
      <button
        type="button"
        onClick={() => setDetailOpen((v) => !v)}
        className="flex w-full items-center justify-between"
      >
        <span className="flex items-center gap-1.5 font-semibold text-slate-700">
          <span
            className={`inline-block text-[10px] text-slate-400 transition-transform ${
              detailOpen ? "rotate-90" : ""
            }`}
          >
            ▶
          </span>
          Resolución de cohortes ({resolution.length} ciudades)
        </span>
        <span className="text-slate-500">
          {allResolved ? "✓ Completa" : "Faltan cohortes"} · {formatNumber(totalUnique)} DRVs únicos
        </span>
      </button>
      {detailOpen && (
        <ul className="mt-2 space-y-1">
          {resolution.map((r) => (
            <li key={r.code} className="flex items-center justify-between text-slate-600">
              <span>{r.cityName}</span>
              <span className="text-right">
                {r.source === "none" ? (
                  <span className="font-semibold text-amber-700">— sin cohorte</span>
                ) : (
                  <>
                    <span className="text-slate-500">
                      {r.source === "per-city" ? "por ciudad" : "general"} ·{" "}
                    </span>
                    <span className="font-semibold text-slate-700">
                      {formatNumber(r.count)} DRVs
                    </span>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function computeEffectiveDrvIds(
  value: CohortState,
  selectedCityCodes: string[],
): string[] {
  const union = new Set<string>();
  for (const code of selectedCityCodes) {
    const perCity = value.byCity[code];
    const source = perCity ?? value.general;
    if (!source) continue;
    for (const id of source.validIds) {
      union.add(id);
    }
  }
  return Array.from(union);
}

export function formatCohortBytes(bytes: number): string {
  return formatBytes(bytes);
}
