import { useState, useMemo } from "react";
import { Card, PageHeader } from "@/components/Ui";
import { useAuth, type AudienceKind } from "@/lib/auth";
import { fetchUserCampaigns, cancelCampaignRpc } from "@/lib/queries";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import { formatNumber } from "@/lib/format";

export default function MyCampaigns({ kind }: { kind: AudienceKind }) {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const [cancellingId, setCancellingId] = useState<string | null>(null);

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
    created_at: string;
    updated_at: string;
  };
  onCancel: (id: string) => void;
  cancellingId: string | null;
}

function CampaignCard({ campaign, onCancel, cancellingId }: CampaignCardProps) {
  const start = new Date(campaign.start_date + "T12:00:00");
  const end = new Date(campaign.end_date + "T12:00:00");
  const dateRange =
    campaign.start_date === campaign.end_date
      ? start.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" })
      : `${start.toLocaleDateString("es-MX", { day: "numeric", month: "short" })} – ${end.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" })}`;

  return (
    <Card subtitle={dateRange}>
      <div className="mb-3 flex items-center justify-between">
        <span className="font-semibold text-slate-800">{campaign.name}</span>
        <div className="flex items-center gap-2">
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