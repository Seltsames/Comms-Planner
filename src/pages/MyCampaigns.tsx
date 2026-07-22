import { useState, useMemo } from "react";
import { Card, PageHeader } from "@/components/Ui";
import { useAuth, type AudienceKind } from "@/lib/auth";
import {
  fetchUserCampaigns,
  fetchCampaignSchedules,
  cancelCampaignRpc,
  setCampaignEventIdsRpc,
} from "@/lib/queries";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import { formatNumber } from "@/lib/format";
import { buildNomenclature } from "@/lib/nomenclature";
import { ACTION_KEYS_BY_KIND, COMM_TYPES } from "@/lib/constants";
import { EventIdsEditor, parseEventIds, type EventIdEntry } from "@/components/EventIdsEditor";

// Day headers in the calendar export follow the ops template: "Fri 17 jul".
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function formatDayHeader(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export default function MyCampaigns({ kind }: { kind: AudienceKind }) {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const { data: campaigns, loading, error, refresh } = useAutoRefresh(
    () => (userId ? fetchUserCampaigns(userId, kind) : Promise.resolve(null)),
    60_000,
    [userId, kind],
  );

  const sorted = useMemo(() => {
    if (!campaigns) return [];
    return [...campaigns].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
  }, [campaigns]);

  /**
   * Download the approved campaign calendar as XLSX in calendar layout:
   * one row per channel, one column per approved day (weekday + date),
   * with the approved hours in each cell. Titled with the campaign
   * nomenclature; the push approval Plan ID is shown when the campaign
   * includes push channels.
   */
  async function handleDownload(campaign: {
    id: string;
    name: string;
    team: string;
    sub_team: string | null;
    country: string;
    plan_id: string | null;
  }) {
    setDownloadingId(campaign.id);
    try {
      const all = await fetchCampaignSchedules(kind);
      const rows = (all ?? []).filter((s) => s.campaign_id === campaign.id);
      if (rows.length === 0) {
        alert("Esta campaña no tiene comunicaciones programadas.");
        return;
      }

      const nomenclature = buildNomenclature(
        kind,
        campaign.country,
        campaign.team,
        campaign.sub_team,
        campaign.name,
      );

      // Calendar grid following the ops template:
      //   Campaign name | <nomenclatura>
      //   User          | <usuario>
      //
      //                 |          |         | Calendar (merged over dates)
      //   Platform      | Channel  | Plan ID | Fri 17 jul | Sat 18 jul | ...
      //   Pope          | Push ... | 12345   | 13:00      | ...
      //   Ad placement  | Pop Up   |         | 00:00-23:59| ...
      const dates = [...new Set(rows.map((s) => s.schedule_date))].sort();
      const popeChannels: readonly string[] = ACTION_KEYS_BY_KIND[kind][COMM_TYPES.POPE];
      const adChannels: readonly string[] = ACTION_KEYS_BY_KIND[kind][COMM_TYPES.AD_PLACEMENT];
      const canonicalOrder = [...popeChannels, ...adChannels];
      const channels = [...new Set(rows.map((s) => s.action_key))].sort((a, b) => {
        const ia = canonicalOrder.indexOf(a);
        const ib = canonicalOrder.indexOf(b);
        return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib) || a.localeCompare(b);
      });
      const platformOf = (ch: string) =>
        popeChannels.includes(ch) ? "Pope" : adChannels.includes(ch) ? "Ad placement" : "";
      const isPush = (actionKey: string) => actionKey.toLowerCase().includes("push");

      const hoursByCell = new Map<string, string[]>();
      for (const s of rows) {
        const key = `${s.action_key}|${s.schedule_date}`;
        const list = hoursByCell.get(key) ?? [];
        list.push(s.time_slot);
        hoursByCell.set(key, list);
      }

      const username = user?.email?.split("@")[0] ?? "";
      const aoa: string[][] = [
        ["Campaign name", nomenclature],
        ["User", username],
        [],
        ["", "", "", "Calendar"],
        ["Platform", "Channel", "Plan ID", ...dates.map(formatDayHeader)],
        ...channels.map((ch) => [
          platformOf(ch),
          ch,
          isPush(ch) ? (campaign.plan_id ?? "") : "",
          ...dates.map((d) =>
            (hoursByCell.get(`${ch}|${d}`) ?? [])
              .sort()
              .map((t) => (t === "TRIGGER" ? "Trigger" : t))
              .join(", "),
          ),
        ]),
      ];

      const XLSX = await import("xlsx");
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws["!merges"] = [
        // User value spans B2:C2; "Calendar" spans the date columns (D4...).
        { s: { r: 1, c: 1 }, e: { r: 1, c: 2 } },
        { s: { r: 3, c: 3 }, e: { r: 3, c: 3 + dates.length - 1 } },
      ];
      ws["!cols"] = [
        { wch: 15 },
        { wch: 12 },
        { wch: 14 },
        ...dates.map(() => ({ wch: 12 })),
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Calendario");
      XLSX.writeFile(wb, `calendario_${nomenclature}.xlsx`);
    } catch (e: unknown) {
      const msg =
        typeof e === "object" && e !== null && "message" in e
          ? String((e as { message: unknown }).message)
          : "Error descargando el calendario";
      alert(msg);
    } finally {
      setDownloadingId(null);
    }
  }

  async function handleCancel(campaignId: string) {
    if (!confirm("¿Cancelar esta campaña? Esta acción no se puede deshacer.")) return;
    setCancellingId(campaignId);
    try {
      await cancelCampaignRpc(campaignId, kind);
      await refresh();
    } catch (e: unknown) {
      alert("Error al cancelar: " + (e as Error).message);
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <PageHeader
        title="Mis campañas programadas"
        subtitle={`Historial de las comunicaciones que has creado · ${user?.email ?? ""}`}
        action={
          <span className="text-xs text-slate-500">
            {loading && <span className="animate-pulse">Actualizando…</span>}
            {!loading && campaigns && (
              <span>{formatNumber(campaigns.length)} campañas</span>
            )}
          </span>
        }
      />

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Error cargando campañas: {error}
        </div>
      )}

      <div className="space-y-4">
        {sorted.length === 0 && !loading ? (
          <Card>
            <div className="py-8 text-center">
              <p className="text-sm font-semibold text-slate-600">Aún no hay campañas</p>
              <p className="mt-1 text-xs text-slate-400">
                Las campañas creadas desde el Builder aparecerán aquí.
              </p>
            </div>
          </Card>
        ) : (
          <div className="space-y-3">
            {sorted.map((campaign) => (
              <CampaignCard
                key={campaign.id}
                campaign={campaign}
                onCancel={handleCancel}
                cancellingId={cancellingId}
                onDownload={handleDownload}
                downloadingId={downloadingId}
                onSaveEventIds={async (entries) => {
                  await setCampaignEventIdsRpc(campaign.id, kind, entries);
                  await refresh();
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface CampaignCardProps {
  campaign: {
    id: string;
    name: string;
    team: string;
    sub_team: string | null;
    types: string[];
    country: string;
    city_codes: string[];
    start_date: string;
    end_date: string;
    status: string;
    action_keys: string[];
    csv_file_name: string | null;
    event_id: string | null;
    event_ids: unknown;
    plan_id: string | null;
    created_at: string;
    updated_at: string;
  };
  onCancel: (id: string) => void;
  cancellingId: string | null;
  onDownload: (campaign: {
    id: string;
    name: string;
    team: string;
    sub_team: string | null;
    country: string;
    plan_id: string | null;
  }) => void;
  downloadingId: string | null;
  onSaveEventIds: (entries: EventIdEntry[]) => Promise<void>;
}

function CampaignCard({
  campaign,
  onCancel,
  cancellingId,
  onDownload,
  downloadingId,
  onSaveEventIds,
}: CampaignCardProps) {
  const start = new Date(campaign.start_date + "T12:00:00");
  const end = new Date(campaign.end_date + "T12:00:00");
  const dateRange =
    campaign.start_date === campaign.end_date
      ? start.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" })
      : `${start.toLocaleDateString("es-MX", { day: "numeric", month: "short" })} – ${end.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" })}`;

  return (
    <Card subtitle={dateRange}>
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <span className="font-semibold text-slate-800">{campaign.name}</span>
          {/* One Event ID per comm type (Pope / Ad Placement), plus "+". */}
          <div className="mt-2">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">
              Event IDs
            </p>
            <EventIdsEditor
              value={parseEventIds(campaign.event_ids, campaign.event_id)}
              types={campaign.types}
              onSave={onSaveEventIds}
            />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {campaign.status === "approved" && (
            <button
              onClick={() => onDownload(campaign)}
              disabled={downloadingId === campaign.id}
              className="rounded border border-brand-200 bg-brand-50 px-2 py-1 text-xs font-semibold text-brand-700 transition hover:border-brand-300 disabled:opacity-50"
            >
              {downloadingId === campaign.id ? "Descargando…" : "⬇ Descargar calendario"}
            </button>
          )}
          {campaign.status !== "cancelled" && (
            <button
              onClick={() => onCancel(campaign.id)}
              disabled={cancellingId === campaign.id}
              className="rounded border border-red-200 bg-white px-2 py-1 text-xs text-red-600 transition hover:bg-red-50 disabled:opacity-50"
            >
              {cancellingId === campaign.id ? "Cancelando…" : "Cancelar"}
            </button>
          )}
          <StatusBadge status={campaign.status} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs text-slate-600">
        <div>
          <span className="font-medium text-slate-500">Equipo:</span> {campaign.team}
          {campaign.sub_team && ` / ${campaign.sub_team}`}
        </div>
        <div>
          <span className="font-medium text-slate-500">País:</span> {campaign.country}
        </div>
        <div>
          <span className="font-medium text-slate-500">Tipo:</span> {campaign.types.join(", ")}
        </div>
        <div>
          <span className="font-medium text-slate-500">Ciudades:</span>{" "}
          {campaign.city_codes.length} ciudad{campaign.city_codes.length !== 1 ? "es" : ""}
        </div>
        <div>
          <span className="font-medium text-slate-500">Canales:</span>{" "}
          {campaign.action_keys.length > 0 ? campaign.action_keys.join(", ") : "—"}
        </div>
        <div>
          <span className="font-medium text-slate-500">Creada:</span>{" "}
          {new Date(campaign.created_at).toLocaleDateString("es-MX", {
            day: "numeric",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>
      </div>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: "bg-amber-100 text-amber-700",
    approved: "bg-green-100 text-green-700",
    rejected: "bg-red-100 text-red-700",
    draft: "bg-slate-100 text-slate-600",
    cancelled: "bg-slate-200 text-slate-500",
  };
  const labels: Record<string, string> = {
    pending: "Pendiente",
    approved: "Aprobada",
    rejected: "Rechazada",
    draft: "Borrador",
    cancelled: "Cancelada",
  };
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${
        styles[status] ?? "bg-slate-100 text-slate-600"
      }`}
    >
      {labels[status] ?? status}
    </span>
  );
}