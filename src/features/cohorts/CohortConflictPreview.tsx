import { useEffect, useState } from "react";
import { checkCohortConflictsRpc } from "@/lib/queries";
import { formatNumber } from "@/features/cohorts/parser";

export interface ConflictEntry {
  campaign_id: string;
  campaign_name: string;
  schedule_date: string;
  time_slot: string;
  action_key: string;
  conflicting_drv_count: number;
}

interface CohortConflictPreviewProps {
  drvIds: string[];
  country: string;
  startDate: string;
  endDate: string;
}

export function CohortConflictPreview({
  drvIds,
  country,
  startDate,
  endDate,
}: CohortConflictPreviewProps) {
  const [conflicts, setConflicts] = useState<ConflictEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (drvIds.length === 0) {
      setConflicts([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    checkCohortConflictsRpc(drvIds, country, startDate, endDate)
      .then((result) => {
        if (!cancelled) setConflicts(result);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Error consultando conflictos");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [drvIds.join(","), country, startDate, endDate]);

  if (drvIds.length === 0) return null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">Conflicto de cohortes</h3>
        {loading && (
          <span className="text-xs text-slate-400 animate-pulse">Consultando…</span>
        )}
        {!loading && conflicts.length === 0 && (
          <span className="flex items-center gap-1 text-xs font-semibold text-green-600">
            ✓ Sin conflictos
          </span>
        )}
      </div>

      {error && (
        <p className="text-xs text-red-600">{error}</p>
      )}

      {!loading && conflicts.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-slate-500">
            {conflicts.length} franja{conflicts.length > 1 ? "s" : ""} con DRVs superpuestos:
          </p>
          <div className="space-y-1.5">
            {conflicts.slice(0, 10).map((c, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs"
              >
                <div className="min-w-0 flex-1">
                  <span className="font-semibold text-slate-800">{c.campaign_name}</span>
                  <span className="ml-2 text-slate-500">
                    {c.schedule_date} · {c.time_slot} · {c.action_key}
                  </span>
                </div>
                <span className="ml-2 shrink-0 rounded-full bg-red-500 px-2.5 py-0.5 text-xs font-bold text-white">
                  {formatNumber(c.conflicting_drv_count)} DRVs
                </span>
              </div>
            ))}
          </div>
          {conflicts.length > 10 && (
            <p className="text-xs text-slate-500">
              +{conflicts.length - 10} franjas más
            </p>
          )}
        </div>
      )}
    </div>
  );
}