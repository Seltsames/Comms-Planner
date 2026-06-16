import { AlertTriangle, Lock } from "lucide-react";

interface Conflict {
  date: string;
  reason: string;
  actionKey: string;
}

interface ChannelConflicts {
  conflicts: Conflict[];
  atRiskCount: number;
  lockedCount: number;
}

interface ConflictsSummaryProps {
  channelConflicts: Record<string, ChannelConflicts>;
}

function formatDateShort(dateStr: string) {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "short" });
}

export function ConflictsSummary({ channelConflicts }: ConflictsSummaryProps) {
  const allConflicts: Array<Conflict & { channel: string }> = [];
  let totalAtRisk = 0;
  let totalLocked = 0;

  for (const [channel, data] of Object.entries(channelConflicts)) {
    for (const c of data.conflicts) {
      allConflicts.push({ ...c, channel });
    }
    totalAtRisk += data.atRiskCount;
    totalLocked += data.lockedCount;
  }

  if (allConflicts.length === 0 && totalAtRisk === 0 && totalLocked === 0) {
    return null;
  }

  return (
    <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50/40 p-4 sm:p-5">
      <div className="flex items-start gap-3 mb-3">
        <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-600 flex items-center justify-center shrink-0">
          <AlertTriangle size={16} />
        </div>
        <div>
          <h3 className="font-bold text-slate-800 text-sm">Conflictos detectados</h3>
          <p className="text-xs text-slate-500">
            {allConflicts.length === 0
              ? "Sin conflictos mayores · "
              : `${allConflicts.length} bloqueo(s) de día · `}
            {totalAtRisk} franja(s) bajo riesgo · {totalLocked} franja(s) no disponible(s)
          </p>
        </div>
      </div>

      {allConflicts.length > 0 && (
        <ul className="space-y-1.5">
          {allConflicts.map((c, idx) => (
            <li
              key={`${c.actionKey}-${c.date}-${idx}`}
              className="flex items-start gap-2 text-xs text-slate-700 bg-white rounded-lg px-3 py-2 border border-amber-100"
            >
              <Lock size={12} className="text-amber-500 mt-0.5 shrink-0" />
              <div>
                <span className="font-semibold">{c.actionKey}</span> · {formatDateShort(c.date)} ·{" "}
                <span className="text-slate-600">{c.reason}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}