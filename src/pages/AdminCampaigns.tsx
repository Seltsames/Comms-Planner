import { useState } from "react";
import { Card, PageHeader } from "@/components/Ui";
import {
  fetchAllCampaigns,
  approveCampaignRpc,
  rejectCampaignRpc,
  deleteCampaignHardRpc,
} from "@/lib/queries";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import { formatNumber } from "@/features/cohorts/parser";

type CampaignRow = {
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
  creator_id: string;
  created_at: string;
  updated_at: string;
};

export default function AdminCampaigns() {
  const [actionId, setActionId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { data: campaigns, loading, error, refresh } = useAutoRefresh(
    () => fetchAllCampaigns(),
    60_000,
    [],
  );

  async function handleApprove(id: string) {
    if (!confirm("Aprobar esta campaña?")) return;
    setActionId(id);
    try {
      await approveCampaignRpc(id);
      await refresh();
    } catch (e: unknown) {
      alert("Error: " + (e as Error).message);
    } finally {
      setActionId(null);
    }
  }

  async function handleReject(id: string) {
    if (!confirm("Rechazar esta campaña?")) return;
    setActionId(id);
    try {
      await rejectCampaignRpc(id);
      await refresh();
    } catch (e: unknown) {
      alert("Error: " + (e as Error).message);
    } finally {
      setActionId(null);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Eliminar permanentemente esta campaña? Esta acción no se puede deshacer.")) return;
    setDeletingId(id);
    try {
      await deleteCampaignHardRpc(id);
      await refresh();
    } catch (e: unknown) {
      alert("Error: " + (e as Error).message);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <PageHeader
        title="Gestión de campañas"
        subtitle="Ver, aprobar, rechazar o eliminar campañas de todos los usuarios"
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

      {campaigns && campaigns.length === 0 && (
        <Card>
          <div className="py-8 text-center">
            <p className="text-sm font-semibold text-slate-600">No hay campañas</p>
          </div>
        </Card>
      )}

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">Nombre</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">Usuario</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">Estado</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">Fechas</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">País</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">Ciudades</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">Canales</th>
              <th className="px-4 py-3 text-right font-semibold text-slate-600">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {campaigns?.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-800">{c.name}</div>
                  <div className="text-xs text-slate-400">{c.team}</div>
                </td>
                <td className="px-4 py-3 text-slate-600">{c.creator_id.slice(0, 8)}…</td>
                <td className="px-4 py-3">
                  <StatusBadge status={c.status} />
                </td>
                <td className="px-4 py-3 text-slate-500">
                  {c.start_date === c.end_date
                    ? c.start_date
                    : `${c.start_date} – ${c.end_date}`}
                </td>
                <td className="px-4 py-3 text-slate-600">{c.country}</td>
                <td className="px-4 py-3 text-slate-600">{c.city_codes.length}</td>
                <td className="px-4 py-3 text-slate-600">{c.action_keys.join(", ")}</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-1">
                    {c.status === "pending" && (
                      <>
                        <button
                          onClick={() => handleApprove(c.id)}
                          disabled={actionId === c.id}
                          className="rounded bg-green-100 px-2 py-1 text-xs font-medium text-green-700 hover:bg-green-200 disabled:opacity-50"
                        >
                          Aprobar
                        </button>
                        <button
                          onClick={() => handleReject(c.id)}
                          disabled={actionId === c.id}
                          className="rounded bg-red-100 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-200 disabled:opacity-50"
                        >
                          Rechazar
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => handleDelete(c.id)}
                      disabled={deletingId === c.id}
                      className="rounded border border-red-200 bg-white px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      {deletingId === c.id ? "Eliminando…" : "Eliminar"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
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