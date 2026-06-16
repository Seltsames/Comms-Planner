import { Calendar, Download, X, Check, AlertTriangle } from "lucide-react";
import { useMemo } from "react";
import type { ScheduledComm } from "./ScheduledCommsPreview";

interface SaveSuccessModalProps {
  campaignId: string;
  campaignStatus: string;
  campaignName: string;
  scheduledComms: ScheduledComm[];
  onClose: () => void;
}

function formatDateLong(dateStr: string) {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
}

function formatTimeShort(t: string) {
  return t;
}

export function SaveSuccessModal({
  campaignId,
  campaignStatus,
  campaignName,
  scheduledComms,
  onClose,
}: SaveSuccessModalProps) {
  const groupedByDate = useMemo(() => {
    const groups: Record<string, ScheduledComm[]> = {};
    for (const c of scheduledComms) {
      if (!groups[c.date]) groups[c.date] = [];
      groups[c.date].push(c);
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [scheduledComms]);

  const isApproved = campaignStatus === "approved";
  const isPushPending = campaignStatus === "pending";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={`p-6 border-b border-slate-200 flex justify-between items-center ${
            isApproved ? "bg-emerald-50" : isPushPending ? "bg-amber-50" : "bg-slate-50"
          }`}
        >
          <div className="flex items-center gap-3">
            <div
              className={`w-12 h-12 rounded-full flex items-center justify-center ${
                isApproved ? "bg-emerald-100 text-emerald-600" : "bg-amber-100 text-amber-600"
              }`}
            >
              {isApproved ? <Check size={24} /> : <AlertTriangle size={24} />}
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-800">
                {isApproved ? "Campaña aprobada automáticamente" : "Campaña guardada"}
              </h2>
              <p className="text-sm text-slate-600">
                {isApproved
                  ? "Sin conflictos detectados. Tu campaña está activa."
                  : isPushPending
                    ? "Las comunicaciones push requieren aprobación manual del administrador."
                    : "La campaña fue guardada y está pendiente de revisión."}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition p-1"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="font-bold text-slate-800 text-base flex items-center gap-2">
                <Calendar size={18} className="text-brand-500" /> {campaignName}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">ID: {campaignId.slice(0, 8)}…</p>
            </div>
            <span
              className={`inline-block rounded-full px-3 py-1 text-xs font-bold ${
                isApproved
                  ? "bg-emerald-100 text-emerald-700"
                  : isPushPending
                    ? "bg-amber-100 text-amber-700"
                    : "bg-slate-100 text-slate-600"
              }`}
            >
              {isApproved ? "Aprobada" : isPushPending ? "Push · Pendiente" : "Pendiente"}
            </span>
          </div>

          {groupedByDate.length === 0 ? (
            <p className="text-sm text-slate-400 italic text-center py-4">Sin comunicaciones programadas</p>
          ) : (
            <div className="space-y-3">
              {groupedByDate.map(([date, comms]) => (
                <div
                  key={date}
                  className="rounded-xl border border-slate-200 bg-slate-50/50 overflow-hidden"
                >
                  <div className="bg-slate-100 px-4 py-2 border-b border-slate-200">
                    <p className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                      {formatDateLong(date)}
                    </p>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {comms.map((c) => (
                      <div key={c.id} className="px-4 py-2.5 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="text-sm font-mono font-bold text-slate-700 w-20">
                            {formatTimeShort(c.time)}
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-slate-800">{c.actionKey}</p>
                            <p className="text-xs text-slate-500">{c.types.join(", ")}</p>
                          </div>
                        </div>
                        <span className="text-xs text-slate-500 font-medium">
                          {c.drvCount.toLocaleString()} conductores
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-4 sm:p-6 border-t border-slate-200 bg-slate-50 flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-2">
          <p className="text-xs text-slate-500">
            {groupedByDate.length} {groupedByDate.length === 1 ? "día" : "días"} ·{" "}
            {scheduledComms.length} {scheduledComms.length === 1 ? "comunicación" : "comunicaciones"}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => {
                const csv = ["date,action_key,time_slot,drv_count,country,status"];
                for (const c of scheduledComms) {
                  csv.push(
                    `${c.date},${c.actionKey},${c.time},${c.drvCount},${c.country},${campaignStatus}`,
                  );
                }
                const blob = new Blob([csv.join("\n")], { type: "text/csv;charset=utf-8" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `${campaignName.replace(/\s+/g, "_")}_schedule.csv`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-bold text-white transition hover:bg-brand-600"
            >
              <Download size={14} /> Descargar CSV (mock)
            </button>
            <button
              onClick={onClose}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
            >
              Cerrar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}