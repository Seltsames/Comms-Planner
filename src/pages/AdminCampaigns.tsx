import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Clock } from "lucide-react";
import { Card, PageHeader } from "@/components/Ui";
import {
  fetchAllCampaignsBoth,
  fetchAudienceCountsBoth,
  fetchCampaignSchedules,
  approveCampaignRpc,
  rejectCampaignRpc,
  deleteCampaignHardRpc,
  setCampaignEventIdsRpc,
} from "@/lib/queries";
import { EventIdsEditor, parseEventIds } from "@/components/EventIdsEditor";
import { CampaignEditModal } from "@/components/CampaignEditModal";
import { CampaignSchedulesModal } from "@/components/CampaignSchedulesModal";
import type { AdminCampaignRow } from "@/lib/queries";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import { formatNumber } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { useAuth, type AudienceKind } from "@/lib/auth";

interface ProfileLookup {
  email: string | null;
  full_name: string | null;
}

type KindFilter = "all" | AudienceKind;

// Minute-of-day a schedule's communication is considered to END at.
function slotEndMinutes(timeSlot: string): number {
  if (timeSlot === "TRIGGER" || timeSlot === "FULL_DAY") return 1439; // end of day
  const parts = timeSlot.split("-");
  const hhmm = parts.length > 1 ? parts[1] : parts[0]; // range end, else the time
  const [h, m] = hhmm.split(":").map((n) => parseInt(n, 10));
  if (Number.isNaN(h)) return 1439;
  return h * 60 + (Number.isNaN(m) ? 0 : m);
}

// When the campaign's LAST scheduled communication ends, as a Date. Null if it
// has no schedules.
function lastCommEnd(rows: Array<{ schedule_date: string; time_slot: string }>): Date | null {
  let latest: Date | null = null;
  for (const r of rows) {
    const d = new Date(r.schedule_date + "T00:00:00");
    d.setMinutes(slotEndMinutes(r.time_slot));
    if (!latest || d > latest) latest = d;
  }
  return latest;
}

const ALERT_AFTER_MS = 24 * 60 * 60 * 1000; // 24 h after the campaign ends

export default function AdminCampaigns() {
  // Platform-scoped admin: only the sides in platformAccess are shown
  // and manageable (the RPCs enforce the same scope server-side).
  const { platformAccess } = useAuth();
  const [actionId, setActionId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Default the filter to the platform the admin arrived from (?kind), so
  // clicking "Campañas" while on PAX lands on the PAX campaigns.
  const [searchParams] = useSearchParams();
  const paramKind = searchParams.get("kind");
  const [kindFilter, setKindFilter] = useState<KindFilter>(
    paramKind === "pax" || paramKind === "drv" ? paramKind : "all",
  );
  const [editing, setEditing] = useState<AdminCampaignRow | null>(null);
  const [viewingSchedules, setViewingSchedules] = useState<AdminCampaignRow | null>(null);

  // Single call returns campaigns from BOTH schemas, tagged with `kind`.
  const { data: campaigns, loading, error, refresh } = useAutoRefresh(
    () => fetchAllCampaignsBoth(),
    60_000,
    [],
  );

  // Distinct audience ids per campaign, aggregated in Postgres.
  const { data: audienceCounts } = useAutoRefresh(
    () => fetchAudienceCountsBoth(),
    60_000,
    [],
  );

  // Profiles are small and shared across both schemas, so we fetch them
  // straight from the public table once on mount + on every refresh.
  const { data: profiles } = useAutoRefresh(
    async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("user_id, email, full_name");
      if (error) throw error;
      return (data ?? []) as Array<{ user_id: string; email: string; full_name: string | null }>;
    },
    60_000,
    [],
  );

  const profileById = useMemo(() => {
    const map = new Map<string, ProfileLookup>();
    for (const p of profiles ?? []) {
      map.set(p.user_id, { email: p.email, full_name: p.full_name });
    }
    return map;
  }, [profiles]);

  // Schedules for the managed platforms — small table — used to know when each
  // campaign's last communication ends. Refreshes on the same 60s cadence.
  const platformsKey = platformAccess.join(",");
  const { data: allSchedules } = useAutoRefresh(
    async () => {
      const results = await Promise.all(
        platformAccess.map((k) => fetchCampaignSchedules(k).catch(() => [])),
      );
      return results.flat() as Array<{
        campaign_id: string;
        schedule_date: string;
        time_slot: string;
      }>;
    },
    60_000,
    [platformsKey],
  );

  // Approved campaigns whose last communication ended more than 24 h ago are
  // "Concluded"; the rest are "On going". campaign_id keys are uuids, unique
  // across drv/pax.
  const concludedIds = useMemo(() => {
    const byCampaign = new Map<string, Array<{ schedule_date: string; time_slot: string }>>();
    for (const s of allSchedules ?? []) {
      const list = byCampaign.get(s.campaign_id) ?? [];
      list.push(s);
      byCampaign.set(s.campaign_id, list);
    }
    const now = Date.now();
    const concluded = new Set<string>();
    for (const c of campaigns ?? []) {
      if (c.status !== "approved") continue;
      const end = lastCommEnd(byCampaign.get(c.id) ?? []);
      if (end && now > end.getTime() + ALERT_AFTER_MS) concluded.add(c.id);
    }
    return concluded;
  }, [allSchedules, campaigns]);

  const scopedCampaigns = useMemo(
    () => (campaigns ?? []).filter((c) => platformAccess.includes(c.kind)),
    [campaigns, platformAccess],
  );

  const visibleCampaigns = useMemo(() => {
    const filtered =
      kindFilter === "all"
        ? scopedCampaigns
        : scopedCampaigns.filter((c) => c.kind === kindFilter);
    return [...filtered].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
  }, [scopedCampaigns, kindFilter]);

  const counts = useMemo(() => {
    const c = { drv: 0, pax: 0 };
    for (const row of scopedCampaigns) c[row.kind]++;
    return c;
  }, [scopedCampaigns]);

  async function handleApprove(id: string, kind: AudienceKind) {
    if (!confirm("Aprobar esta campaña?")) return;
    setActionId(id);
    try {
      await approveCampaignRpc(id, kind);
      await refresh();
    } catch (e: unknown) {
      alert("Error: " + (e as Error).message);
    } finally {
      setActionId(null);
    }
  }

  async function handleReject(id: string, kind: AudienceKind) {
    if (!confirm("Rechazar esta campaña?")) return;
    setActionId(id);
    try {
      await rejectCampaignRpc(id, kind);
      await refresh();
    } catch (e: unknown) {
      alert("Error: " + (e as Error).message);
    } finally {
      setActionId(null);
    }
  }

  async function handleDelete(id: string, kind: AudienceKind) {
    if (!confirm("Eliminar permanentemente esta campaña? Esta acción no se puede deshacer.")) return;
    setDeletingId(id);
    try {
      await deleteCampaignHardRpc(id, kind);
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
        subtitle="Ver, aprobar, rechazar o eliminar campañas de conductores y pasajeros"
        action={
          <span className="text-xs text-slate-500">
            {loading && <span className="animate-pulse">Actualizando…</span>}
            {!loading && campaigns && (
              <span>{formatNumber(scopedCampaigns.length)} campañas</span>
            )}
          </span>
        }
      />

      {/* Filter chips — only the platforms this admin manages */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {platformAccess.length > 1 && (
          <FilterChip
            active={kindFilter === "all"}
            onClick={() => setKindFilter("all")}
            label={`Todas · ${formatNumber(scopedCampaigns.length)}`}
          />
        )}
        {platformAccess.includes("drv") && (
          <FilterChip
            active={kindFilter === "drv"}
            onClick={() => setKindFilter("drv")}
            label={`Conductores · ${formatNumber(counts.drv)}`}
          />
        )}
        {platformAccess.includes("pax") && (
          <FilterChip
            active={kindFilter === "pax"}
            onClick={() => setKindFilter("pax")}
            label={`Pasajeros · ${formatNumber(counts.pax)}`}
          />
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Error cargando campañas: {error}
        </div>
      )}

      {visibleCampaigns.length === 0 && !loading && (
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
              <th className="px-4 py-3 text-left font-semibold text-slate-600">Event ID</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">Usuario</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">Tipo</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">Estado</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">Progreso</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">Fechas</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">País</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">Ciudades</th>
              <th className="px-4 py-3 text-right font-semibold text-slate-600">Cohort</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">Canales</th>
              <th className="px-4 py-3 text-right font-semibold text-slate-600">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visibleCampaigns.map((c) => {
              const profile = profileById.get(c.creator_id);
              return (
                <tr key={`${c.kind}-${c.id}`} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-800">{c.name}</div>
                    <div className="text-xs text-slate-400">{c.team}</div>
                  </td>
                  <td className="px-4 py-3">
                    <EventIdsEditor
                      value={parseEventIds(c.event_ids, c.event_id)}
                      types={c.types}
                      compact
                      onSave={async (entries) => {
                        await setCampaignEventIdsRpc(c.id, c.kind, entries);
                        await refresh();
                      }}
                    />
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {/* Only the name. Fall back to the email username, then a
                        short id, when the profile has no full name. */}
                    {profile?.full_name ? (
                      <span className="font-medium text-slate-800">{profile.full_name}</span>
                    ) : profile?.email ? (
                      <span className="font-medium text-slate-800">{profile.email.split("@")[0]}</span>
                    ) : (
                      <span className="font-mono text-xs text-slate-400" title={c.creator_id}>
                        {c.creator_id.slice(0, 8)}…
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <KindChip kind={c.kind} />
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="px-4 py-3">
                    {c.status !== "approved" ? (
                      <span className="text-xs text-slate-400">—</span>
                    ) : concludedIds.has(c.id) ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
                        <span className="h-1.5 w-1.5 rounded-full bg-slate-400" /> Concluded
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> On going
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {c.start_date === c.end_date ? (
                      <span className="whitespace-nowrap">{c.start_date}</span>
                    ) : (
                      <div className="flex flex-col leading-tight">
                        <span className="whitespace-nowrap">{c.start_date}</span>
                        <span className="whitespace-nowrap text-slate-400">– {c.end_date}</span>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{c.country}</td>
                  <td className="px-4 py-3 text-slate-600">{c.city_codes.length}</td>
                  <td className="px-4 py-3 text-right font-medium text-slate-700">
                    {audienceCounts?.[`${c.kind}-${c.id}`] !== undefined
                      ? formatNumber(audienceCounts[`${c.kind}-${c.id}`])
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => setViewingSchedules(c)}
                      title="Ver canales y horarios programados"
                      className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-left text-xs text-slate-600 hover:bg-slate-50"
                    >
                      <Clock size={13} className="shrink-0 text-slate-400" />
                      <span className="max-w-[160px] truncate">{c.action_keys.join(", ")}</span>
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => setEditing(c)}
                        className="rounded border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                      >
                        Editar
                      </button>
                      {c.status === "pending" && (
                        <>
                          <button
                            onClick={() => handleApprove(c.id, c.kind)}
                            disabled={actionId === c.id}
                            className="rounded bg-green-100 px-2 py-1 text-xs font-medium text-green-700 hover:bg-green-200 disabled:opacity-50"
                          >
                            Aprobar
                          </button>
                          <button
                            onClick={() => handleReject(c.id, c.kind)}
                            disabled={actionId === c.id}
                            className="rounded bg-red-100 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-200 disabled:opacity-50"
                          >
                            Rechazar
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => handleDelete(c.id, c.kind)}
                        disabled={deletingId === c.id}
                        className="rounded border border-red-200 bg-white px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        {deletingId === c.id ? "Eliminando…" : "Eliminar"}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editing && (
        <CampaignEditModal
          campaign={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refresh();
          }}
        />
      )}

      {viewingSchedules && (
        <CampaignSchedulesModal
          campaign={viewingSchedules}
          onClose={() => setViewingSchedules(null)}
        />
      )}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
        active
          ? "bg-brand-500 text-white shadow-sm"
          : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-100"
      }`}
      aria-pressed={active}
    >
      {label}
    </button>
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

function KindChip({ kind }: { kind: AudienceKind }) {
  const isDrv = kind === "drv";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold ${
        isDrv
          ? "bg-sky-100 text-sky-700"
          : "bg-violet-100 text-violet-700"
      }`}
      title={isDrv ? "Campaña de conductores" : "Campaña de pasajeros"}
    >
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${
          isDrv ? "bg-sky-500" : "bg-violet-500"
        }`}
      />
      {isDrv ? "DRV" : "PAX"}
    </span>
  );
}