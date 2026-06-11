import { Check } from "lucide-react";

export interface ScheduledComm {
  id: string;
  name: string;
  actionKey: string;
  date: string;
  time: string;
  types: string[];
  drvCount: number;
  country: string;
}

interface ScheduledCommsPreviewProps {
  items: ScheduledComm[];
}

function formatDateLabel(dateStr: string) {
  const d = new Date(dateStr + "T12:00:00");
  const days = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
  const months = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
}

export function ScheduledCommsPreview({ items }: ScheduledCommsPreviewProps) {
  if (items.length === 0) return null;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="px-5 py-4 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
        <Check size={14} className="text-brand-500" />
        <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide">
          Comunicaciones Programadas ({items.length})
        </h3>
      </div>
      <div className="p-5 space-y-2 max-h-60 overflow-y-auto">
        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-center justify-between bg-slate-50 p-3 rounded-lg border border-slate-100 hover:border-brand-200 transition text-sm"
          >
            <div className="flex items-center gap-3 overflow-hidden">
              <span className="w-2 h-2 rounded-full bg-brand-500 shrink-0" />
              <span className="font-semibold text-slate-800 truncate max-w-[200px]">{item.name}</span>
              <span className="text-slate-300">|</span>
              <span className="text-xs text-slate-500 font-mono">
                {formatDateLabel(item.date)} @ {item.time}
              </span>
              <span className="text-slate-300">|</span>
              <span className="px-2 py-0.5 rounded text-xs font-semibold bg-brand-50 text-brand-600">
                {item.actionKey}
              </span>
              <span className="text-xs text-slate-400">{item.drvCount} DRVs</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}