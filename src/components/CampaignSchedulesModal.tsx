import { useEffect, useMemo, useState } from "react";
import { X, Clock } from "lucide-react";
import { fetchCampaignSchedules } from "@/lib/queries";
import { getChannelColor, channelLabel } from "@/lib/channelStyles";
import type { AudienceKind } from "@/lib/auth";

const WEEKDAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

// A stored time_slot becomes a human label.
function formatSlot(timeSlot: string): string {
  if (timeSlot === "TRIGGER") return "Trigger (al cumplir la función)";
  if (timeSlot === "FULL_DAY" || timeSlot === "07:00-22:00" || timeSlot === "06:00-22:00")
    return "Día completo";
  return timeSlot; // "HH:MM" or "HH:MM-HH:MM"
}

type Row = { action_key: string; schedule_date: string; time_slot: string };

export function CampaignSchedulesModal({
  campaign,
  onClose,
}: {
  campaign: { id: string; kind: AudienceKind; name: string };
  onClose: () => void;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // fetchCampaignSchedules returns every schedule for the platform; keep only
    // this campaign's rows.
    fetchCampaignSchedules(campaign.kind)
      .then((all) => {
        if (cancelled) return;
        setRows(
          (all ?? [])
            .filter((r) => (r as { campaign_id?: string }).campaign_id === campaign.id)
            .map((r) => ({
              action_key: r.action_key,
              schedule_date: r.schedule_date,
              time_slot: r.time_slot,
            })),
        );
      })
      .catch(() => {
        if (!cancelled) setError("No se pudieron cargar los horarios.");
      });
    return () => {
      cancelled = true;
    };
  }, [campaign.id, campaign.kind]);

  // channel -> sorted list of {date, slot}
  const byChannel = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const r of rows ?? []) {
      const list = map.get(r.action_key) ?? [];
      list.push(r);
      map.set(r.action_key, list);
    }
    for (const list of map.values()) {
      list.sort(
        (a, b) =>
          a.schedule_date.localeCompare(b.schedule_date) ||
          a.time_slot.localeCompare(b.time_slot),
      );
    }
    return map;
  }, [rows]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <h3 className="truncate font-bold text-slate-800" title={campaign.name}>
              {campaign.name}
            </h3>
            <p className="text-xs text-slate-500">Canales y horarios programados</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {error ? (
            <p className="text-sm text-red-600">{error}</p>
          ) : rows === null ? (
            <p className="text-sm italic text-slate-400">Cargando horarios…</p>
          ) : byChannel.size === 0 ? (
            <p className="text-sm italic text-slate-400">Esta campaña no tiene horarios programados.</p>
          ) : (
            Array.from(byChannel.entries()).map(([channel, list]) => {
              const cc = getChannelColor(channel);
              return (
                <div key={channel} className="rounded-xl border border-slate-200">
                  <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${cc.dot}`} />
                    <span className="font-bold text-slate-800">{channelLabel(channel)}</span>
                    <span className="ml-auto text-xs text-slate-400">
                      {list.length} {list.length === 1 ? "día" : "días"}
                    </span>
                  </div>
                  <ul className="divide-y divide-slate-50">
                    {list.map((r, i) => (
                      <li key={i} className="flex items-center gap-3 px-4 py-2 text-sm">
                        <span className="w-28 shrink-0 text-slate-500">{formatDate(r.schedule_date)}</span>
                        <span className="flex items-center gap-1.5 font-medium text-slate-700">
                          <Clock size={13} className="text-slate-400" />
                          {formatSlot(r.time_slot)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })
          )}
        </div>

        <div className="border-t border-slate-200 px-5 py-3 text-right">
          <button
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-500 hover:text-slate-700"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
