import { useMemo, useState } from "react";
import { useAuth, type AudienceKind } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import {
  fetchAllCampaigns,
  fetchCampaignSchedules,
  type CampaignRow,
  type AnalyticsAggregates,
} from "@/lib/queries";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import {
  Users, Calendar, Megaphone, BarChart3, MapPin,
  Target, Trophy, ChevronDown,
  Search, Download, Clock,
} from "lucide-react";
import { CITIES_DATA } from "@/lib/constants";
import { formatNumber } from "@/lib/format";
import { getChannelColor } from "@/lib/channelStyles";

const HOURS: number[] = Array.from({ length: 24 }, (_, i) => i);

function shortName(fullName: string) {
  if (!fullName.startsWith("DRV MKT_")) return fullName;
  const parts = fullName.split("_");
  if (parts.length <= 4) return parts[parts.length - 1];
  return parts.slice(4).join("_");
}

function cityName(code: string): string {
  if (!code || code === "N/A") return code;
  const found = CITIES_DATA.find(c => c.id === code);
  return found ? found.name : code;
}

function getIsoWeek(dateStr: string): { week: string; weekLabel: string } {
  const d = new Date(dateStr + "T12:00:00");
  if (isNaN(d.getTime())) return { week: "unknown", weekLabel: "Sin fecha" };
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1);
  const monday = new Date(d);
  const weekKey = monday.toISOString().split("T")[0];
  const weekLabel = monday.toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
  return { week: weekKey, weekLabel };
}

interface ScheduleItem {
  id: string;
  name: string;
  team: string;
  subTeam: string | null;
  actionKey: string;
  scheduleDate: string;
  timeSlot: string;
  country: string;
  cityCodes: string[];
  creatorId: string;
  status: string;
}

function parseTimeMinutes(slot: string): number | null {
  if (!slot) return null;
  if (slot === "FULL_DAY" || slot.includes("-")) {
    const m = slot.match(/^(\d{1,2}):(\d{2})/);
    if (m) return parseInt(m[1]) * 60 + parseInt(m[2]);
    return null;
  }
  const [h, m] = slot.split(":").map(Number);
  if (isNaN(h)) return null;
  return h * 60 + m;
}

const EMPTY_AGGREGATES: AnalyticsAggregates = {
  kpis: { total_comms: 0, total_drivers: 0, total_campaigns: 0, total_countries: 0, total_cities: 0, total_days: 0 },
  top_drivers: [],
  drivers_by_country: [],
  drivers_by_city: [],
  campaigns_by_country: [],
  campaigns_by_city: [],
  per_campaign_drivers: [],
};

export default function AnalyticsView({ kind }: { kind: AudienceKind }) {
  const { role } = useAuth();
  const isAdmin = role === "admin";

  const [searchQuery, setSearchQuery] = useState("");
  const [countryFilter, setCountryFilter] = useState<string>("all");
  const [channelFilter, setChannelFilter] = useState<string>("all");
  const [showAllCampaigns, setShowAllCampaigns] = useState(false);

  // ===== Server-side aggregates (admin only) =====
  const { data: aggregates, loading: aggregatesLoading, error: aggregatesError } = useAutoRefresh(
    async () => {
      try {
        const { data, error } = await supabase.rpc(
          kind === "pax" ? "get_analytics_aggregates_pax" : "get_analytics_aggregates",
          { p_country: countryFilter, p_channel: channelFilter },
        );
        if (error) throw error;
        return (data as AnalyticsAggregates) ?? null;
      } catch (err) {
        console.error("get_analytics_aggregates error", err);
        throw err;
      }
    },
    60_000,
    [countryFilter, channelFilter, kind],
  );

  // ===== Lightweight client-side data (small tables, no audience) =====
  const { data: rawCampaigns } = useAutoRefresh(
    () => fetchAllCampaigns(kind),
    60_000,
    [kind],
  );

  const { data: rawSchedules } = useAutoRefresh(
    () => fetchCampaignSchedules(kind),
    60_000,
    [kind],
  );

  // Build per-campaign driver count lookup from RPC
  const driversByCampaign = useMemo(() => {
    const map: Record<string, number> = {};
    (aggregates?.per_campaign_drivers ?? []).forEach(p => {
      map[p.campaign_id] = p.drivers;
    });
    return map;
  }, [aggregates]);

  const scheduleItems = useMemo((): ScheduleItem[] => {
    if (!rawCampaigns || !rawSchedules) return [];
    const campMap: Record<string, CampaignRow> = {};
    rawCampaigns.forEach(c => { campMap[c.id] = c; });
    const items: ScheduleItem[] = [];
    for (const camp of rawCampaigns) {
      if (camp.status === "rejected" || camp.status === "cancelled") continue;
      if (countryFilter !== "all" && camp.country !== countryFilter) continue;
      const campSchedules = rawSchedules.filter(s => s.campaign_id === camp.id);
      for (const sched of campSchedules) {
        if (channelFilter !== "all" && sched.action_key !== channelFilter) continue;
        items.push({
          id: sched.id,
          name: camp.name,
          team: camp.team,
          subTeam: camp.sub_team,
          actionKey: sched.action_key,
          scheduleDate: sched.schedule_date,
          timeSlot: sched.time_slot,
          country: camp.country,
          cityCodes: camp.city_codes,
          creatorId: camp.creator_id,
          status: camp.status,
        });
      }
    }
    return items;
  }, [rawCampaigns, rawSchedules, countryFilter, channelFilter]);

  // ===== CLIENT-SIDE METRICS (small data, fast) =====

  // Comms by country + city (from schedules only, no audience)
  const commsByCountry = useMemo(() => {
    const map: Record<string, { total: number; channels: Record<string, number>; campaigns: Set<string>; cities: Set<string> }> = {};
    scheduleItems.forEach(c => {
      const country = c.country || "N/A";
      if (!map[country]) map[country] = { total: 0, channels: {}, campaigns: new Set(), cities: new Set() };
      map[country].total++;
      map[country].channels[c.actionKey] = (map[country].channels[c.actionKey] || 0) + 1;
      map[country].campaigns.add(c.name);
      c.cityCodes.forEach(cy => map[country].cities.add(cy));
    });
    return Object.entries(map)
      .map(([country, data]) => ({ country, ...data, campaigns: data.campaigns.size }))
      .sort((a, b) => b.total - a.total);
  }, [scheduleItems]);

  const commsByCity = useMemo(() => {
    const map: Record<string, { total: number; channels: Record<string, number>; country: string; campaigns: Set<string> }> = {};
    scheduleItems.forEach(c => {
      c.cityCodes.forEach(city => {
        if (!map[city]) map[city] = { total: 0, channels: {}, country: c.country, campaigns: new Set() };
        map[city].total++;
        map[city].channels[c.actionKey] = (map[city].channels[c.actionKey] || 0) + 1;
        map[city].campaigns.add(c.name);
      });
    });
    return Object.entries(map)
      .map(([city, data]) => ({ city, ...data, campaigns: data.campaigns.size }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 15);
  }, [scheduleItems]);

  // Channel usage (from schedules)
  const channelUsage = useMemo(() => {
    const map: Record<string, { comms: number; campaigns: Set<string>; countries: Set<string> }> = {};
    scheduleItems.forEach(c => {
      if (!map[c.actionKey]) map[c.actionKey] = { comms: 0, campaigns: new Set(), countries: new Set() };
      map[c.actionKey].comms++;
      map[c.actionKey].campaigns.add(c.name);
      map[c.actionKey].countries.add(c.country);
    });
    return Object.entries(map)
      .map(([channel, data]) => ({
        channel,
        comms: data.comms,
        campaigns: data.campaigns.size,
        countries: data.countries.size,
      }))
      .sort((a, b) => b.comms - a.comms);
  }, [scheduleItems]);

  const maxChannelComms = Math.max(1, ...channelUsage.map(c => c.comms));

  // Hourly heat map
  const hourlyData = useMemo(() => {
    const hourCounts: Record<number, { total: number; channels: Record<string, number> }> = {};
    HOURS.forEach(h => { hourCounts[h] = { total: 0, channels: {} }; });
    scheduleItems.forEach(c => {
      const minutes = parseTimeMinutes(c.timeSlot);
      if (minutes === null) return;
      const h = Math.floor(minutes / 60);
      if (h < 0 || h > 23) return;
      hourCounts[h].total++;
      hourCounts[h].channels[c.actionKey] = (hourCounts[h].channels[c.actionKey] || 0) + 1;
    });
    const maxCount = Math.max(1, ...Object.values(hourCounts).map(d => d.total));
    return { hourCounts, maxCount };
  }, [scheduleItems]);

  // Weekly volume
  const weeklyData = useMemo(() => {
    const weekMap: Record<string, { comms: number; channels: Record<string, number>; dates: Set<string> }> = {};
    scheduleItems.forEach(c => {
      const { week } = getIsoWeek(c.scheduleDate);
      if (!weekMap[week]) weekMap[week] = { comms: 0, channels: {}, dates: new Set() };
      weekMap[week].comms++;
      weekMap[week].channels[c.actionKey] = (weekMap[week].channels[c.actionKey] || 0) + 1;
      weekMap[week].dates.add(c.scheduleDate);
    });
    return Object.entries(weekMap)
      .map(([week, data]) => ({ week, comms: data.comms, channels: data.channels, days: data.dates.size }))
      .sort((a, b) => a.week.localeCompare(b.week));
  }, [scheduleItems]);

  const maxWeeklyComms = Math.max(1, ...weeklyData.map(w => w.comms));

  // Per-campaign table (uses RPC for driver counts)
  const campaignRows = useMemo(() => {
    const map: Record<string, {
      name: string;
      campaignId: string;
      comms: number;
      drivers: number;
      channels: Set<string>;
      countries: Set<string>;
      dates: Set<string>;
      team: string;
    }> = {};
    scheduleItems.forEach(c => {
      if (!map[c.name]) {
        // Find the campaign ID for driver count lookup
        const matchingCamp = (rawCampaigns ?? []).find(rc => rc.name === c.name);
        map[c.name] = {
          name: c.name,
          campaignId: matchingCamp?.id ?? "",
          comms: 0,
          drivers: matchingCamp ? (driversByCampaign[matchingCamp.id] ?? 0) : 0,
          channels: new Set(),
          countries: new Set(),
          dates: new Set(),
          team: c.team,
        };
      }
      map[c.name].comms++;
      map[c.name].channels.add(c.actionKey);
      map[c.name].countries.add(c.country);
      map[c.name].dates.add(c.scheduleDate);
    });
    return Object.values(map)
      .map(c => ({ ...c, channels: Array.from(c.channels), countries: Array.from(c.countries), dates: c.dates.size }))
      .sort((a, b) => b.drivers - a.drivers);
  }, [scheduleItems, rawCampaigns, driversByCampaign]);

  const filteredCampaignRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return campaignRows;
    return campaignRows.filter(c => c.name.toLowerCase().includes(q));
  }, [campaignRows, searchQuery]);

  const visibleCampaigns = showAllCampaigns ? filteredCampaignRows : filteredCampaignRows.slice(0, 5);

  // Filter dropdown options (from all schedules)
  const filterOptions = useMemo(() => {
    const channels = new Set<string>();
    const countries = new Set<string>();
    (rawSchedules ?? []).forEach(s => channels.add(s.action_key));
    (rawCampaigns ?? [])
      .filter(c => c.status !== "rejected" && c.status !== "cancelled")
      .forEach(c => { if (c.country) countries.add(c.country); });
    return {
      channels: Array.from(channels).sort(),
      countries: Array.from(countries).sort(),
    };
  }, [rawCampaigns, rawSchedules]);

  // ===== KPIs (from RPC) =====
  const agg: AnalyticsAggregates = aggregates ?? EMPTY_AGGREGATES;
  const kpis = agg.kpis;
  const topDrivers = agg.top_drivers;

  const heatColor = (count: number, max: number): string => {
    if (count === 0) return "bg-slate-100";
    const intensity = count / max;
    if (intensity < 0.15) return "bg-emerald-200";
    if (intensity < 0.3) return "bg-emerald-300";
    if (intensity < 0.5) return "bg-emerald-400";
    if (intensity < 0.7) return "bg-amber-400";
    if (intensity < 0.85) return "bg-orange-400";
    return "bg-red-500";
  };

  function downloadCSV(rows: Array<Record<string, string | number>>, filename: string) {
    if (rows.length === 0) return;
    const headers = Object.keys(rows[0]);
    const csv = [
      headers.join(","),
      ...rows.map(r => headers.map(h => {
        const v = String(r[h] ?? "");
        return v.includes(",") || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v;
      }).join(",")),
    ].join("\n");
    const link = document.createElement("a");
    link.setAttribute("href", encodeURI("data:text/csv;charset=utf-8," + csv));
    link.setAttribute("download", filename);
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <BarChart3 size={16} className="text-slate-400" />
          <span className="text-xs font-bold uppercase text-slate-500">Filtros</span>
        </div>
        <select value={countryFilter} onChange={e => setCountryFilter(e.target.value)}
          className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-700">
          <option value="all">Todos los países</option>
          {filterOptions.countries.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={channelFilter} onChange={e => setChannelFilter(e.target.value)}
          className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-700">
          <option value="all">Todos los canales</option>
          {filterOptions.channels.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        {(countryFilter !== "all" || channelFilter !== "all") && (
          <button onClick={() => { setCountryFilter("all"); setChannelFilter("all"); }}
            className="text-xs text-red-500 hover:underline font-medium">Limpiar</button>
        )}
        {aggregatesLoading && (
          <span className="text-xs text-slate-400 ml-auto">Cargando métricas…</span>
        )}
        {aggregatesError && (
          <span className="text-xs text-red-500 ml-auto">⚠ {aggregatesError}</span>
        )}
      </div>

      {/* Top KPIs (from RPC) */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-6">
        <KpiTile label="Comunicaciones" value={formatNumber(kpis.total_comms)} hint="Comms programadas" />
        <KpiTile label="Conductores" value={formatNumber(kpis.total_drivers)} hint="Únicos impactados" tone={kpis.total_drivers > 0 ? "success" : "default"} />
        <KpiTile label="Campañas" value={formatNumber(kpis.total_campaigns)} hint={`${isAdmin ? "Total" : "Creadas por ti"}`} />
        <KpiTile label="Países" value={formatNumber(kpis.total_countries)} hint="Con actividad" />
        <KpiTile label="Ciudades" value={formatNumber(kpis.total_cities)} hint="Con cobertura" />
        <KpiTile label="Días activos" value={formatNumber(kpis.total_days)} hint="Con comunicaciones" />
      </div>

      {/* Top Driver + Channel Usage */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top drivers with most notifications */}
        <Card title="Conductores con más notificaciones" subtitle="Top 10 por volumen total (server-side)" icon={<Trophy size={18} className="text-amber-500" />}>
          {topDrivers.length === 0 ? (
            <p className="text-sm text-slate-400 italic py-6 text-center">Sin datos</p>
          ) : (
            <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
              {topDrivers.map((d, idx) => {
                const max = topDrivers[0]?.count || 1;
                const pct = (d.count / max) * 100;
                return (
                  <div key={d.drv_id} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-slate-50 transition">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${idx === 0 ? "bg-amber-100 text-amber-700" : idx === 1 ? "bg-slate-200 text-slate-700" : idx === 2 ? "bg-orange-100 text-orange-700" : "bg-slate-100 text-slate-500"}`}>
                      {idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-xs font-mono font-bold text-slate-800 truncate">{d.drv_id}</p>
                        <span className="text-sm font-bold text-slate-900 ml-2">{d.count}</span>
                      </div>
                      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-amber-400 to-orange-500 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {d.channels.slice(0, 4).map(ch => {
                          const cc = getChannelColor(ch);
                          return <span key={ch} className={`text-[9px] px-1.5 py-0.5 rounded ${cc.bg} ${cc.text} font-semibold`}>{ch}</span>;
                        })}
                        {d.channels.length > 4 && <span className="text-[9px] text-slate-400">+{d.channels.length - 4}</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* Channel Usage */}
        <Card title="Canal más utilizado" subtitle="Distribución de comunicaciones por canal" icon={<Megaphone size={18} className="text-brand-500" />}>
          {channelUsage.length === 0 ? (
            <p className="text-sm text-slate-400 italic py-6 text-center">Sin datos</p>
          ) : (
            <div className="space-y-3">
              {channelUsage.map(item => {
                const cc = getChannelColor(item.channel);
                const pct = (item.comms / maxChannelComms) * 100;
                return (
                  <div key={item.channel} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`w-3 h-3 rounded-full ${cc.dot}`} />
                        <span className={`text-sm font-semibold ${cc.text}`}>{item.channel}</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-600">
                        <span className="font-mono font-bold text-slate-900">{formatNumber(item.comms)}</span>
                        <span className="text-slate-400">{item.campaigns} camp</span>
                      </div>
                    </div>
                    <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: cc.hex }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* Hourly Heat Map */}
      <Card
        title="Mapa de calor por hora"
        subtitle="Cuándo se concentran más las comunicaciones"
        icon={<Clock size={18} className="text-brand-500" />}
        action={
          <span className="text-xs text-slate-400">
            Pico: <strong className="text-slate-700">
              {(() => {
                const peak = Object.entries(hourlyData.hourCounts).sort((a, b) => b[1].total - a[1].total)[0];
                return peak && peak[1].total > 0 ? `${peak[0]}:00 (${peak[1].total} comms)` : "—";
              })()}
            </strong>
          </span>
        }
      >
        <div className="space-y-2">
          <div className="grid grid-cols-12 gap-1 sm:grid-cols-24">
            {HOURS.map(h => {
              const count = hourlyData.hourCounts[h].total;
              return (
                <div key={h} className="flex flex-col items-center">
                  <div
                    className={`w-full aspect-square rounded ${heatColor(count, hourlyData.maxCount)} flex items-center justify-center text-[10px] font-bold ${count > hourlyData.maxCount * 0.5 ? "text-white" : "text-slate-700"}`}
                    title={`${String(h).padStart(2, "0")}:00 — ${count} comunicaciones`}
                  >
                    {count > 0 ? count : ""}
                  </div>
                  <span className="text-[9px] text-slate-400 mt-1">{h}</span>
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-end gap-1 mt-2 text-[10px] text-slate-500">
            <span>Menos</span>
            <div className="flex gap-0.5">
              <div className="w-3 h-3 rounded bg-slate-100" />
              <div className="w-3 h-3 rounded bg-emerald-200" />
              <div className="w-3 h-3 rounded bg-emerald-400" />
              <div className="w-3 h-3 rounded bg-amber-400" />
              <div className="w-3 h-3 rounded bg-orange-400" />
              <div className="w-3 h-3 rounded bg-red-500" />
            </div>
            <span>Más</span>
          </div>
        </div>
      </Card>

      {/* Weekly Volume */}
      {weeklyData.length > 0 && (
        <Card title="Volumen semanal" subtitle="Comunicaciones agrupadas por semana" icon={<Calendar size={18} className="text-blue-500" />}>
          <div className="space-y-3">
            {weeklyData.map(w => {
              const pct = (w.comms / maxWeeklyComms) * 100;
              const wDate = new Date(w.week + "T12:00:00");
              const wLabel = wDate.toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
              return (
                <div key={w.week} className="flex items-center gap-3">
                  <div className="w-24 flex-shrink-0 text-xs text-slate-500 font-medium">
                    Sem {wLabel}
                  </div>
                  <div className="flex-1">
                    <div className="h-7 bg-slate-50 rounded-lg overflow-hidden border border-slate-100 relative">
                      <div
                        className="h-full bg-gradient-to-r from-blue-400 to-blue-600 rounded-lg flex items-center justify-end px-2 transition-all"
                        style={{ width: `${Math.max(pct, 8)}%` }}
                      >
                        <span className="text-xs font-bold text-white">{w.comms}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-[10px] text-slate-500">
                      <span>{w.days} día{w.days !== 1 ? "s" : ""}</span>
                      <div className="flex gap-0.5">
                        {Object.entries(w.channels).map(([ch, n]) => {
                          const cc = getChannelColor(ch);
                          return (
                            <span key={ch} className={`px-1 rounded ${cc.bg} ${cc.text} font-semibold`} title={`${ch}: ${n}`}>
                              {n}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Comms by Country + City */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card
          title="Comunicaciones por país"
          subtitle="Volumen y canales por país"
          icon={<MapPin size={18} className="text-emerald-500" />}
          action={
            <button
              onClick={() => downloadCSV(
                commsByCountry.map(c => ({
                  pais: c.country,
                  total: c.total,
                  campanias: c.campaigns,
                  canales: Object.entries(c.channels).map(([k, v]) => `${k}:${v}`).join(" | "),
                })),
                `comms_por_pais_${new Date().toISOString().split("T")[0]}.csv`,
              )}
              className="text-xs text-slate-500 hover:text-brand-600 flex items-center gap-1"
            >
              <Download size={12} /> CSV
            </button>
          }
        >
          {commsByCountry.length === 0 ? (
            <p className="text-sm text-slate-400 italic py-6 text-center">Sin datos</p>
          ) : (
            <div className="space-y-2">
              {commsByCountry.map(c => {
                const max = Math.max(1, ...commsByCountry.map(x => x.total));
                const pct = (c.total / max) * 100;
                return (
                  <div key={c.country} className="p-3 rounded-lg border border-slate-100 hover:bg-slate-50 transition">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-slate-800">{c.country}</span>
                        <span className="text-[10px] text-slate-400">{c.campaigns} camp</span>
                      </div>
                      <span className="text-lg font-bold text-slate-900">{formatNumber(c.total)}</span>
                    </div>
                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mb-2">
                      <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(c.channels).sort((a, b) => b[1] - a[1]).map(([ch, n]) => {
                        const cc = getChannelColor(ch);
                        return <span key={ch} className={`text-[10px] px-1.5 py-0.5 rounded ${cc.bg} ${cc.text} font-semibold`}>{ch}: {n}</span>;
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card
          title="Comunicaciones por ciudad"
          subtitle="Top 15 ciudades con más volumen"
          icon={<MapPin size={18} className="text-pink-500" />}
        >
          {commsByCity.length === 0 ? (
            <p className="text-sm text-slate-400 italic py-6 text-center">Sin datos</p>
          ) : (
            <div className="space-y-1.5 max-h-[420px] overflow-y-auto">
              {commsByCity.map((c, idx) => {
                const max = commsByCity[0]?.total || 1;
                const pct = (c.total / max) * 100;
                return (
                  <div key={c.city} className="flex items-center gap-2 p-2 rounded hover:bg-slate-50">
                    <span className="text-[10px] text-slate-400 w-5 text-right font-mono">{idx + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-xs font-semibold text-slate-800 truncate">{cityName(c.city)}</span>
                          <span className="text-[10px] text-slate-400">{c.country}</span>
                        </div>
                        <span className="text-xs font-bold text-slate-900">{c.total}</span>
                      </div>
                      <div className="h-1 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-pink-400 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* Drivers by Country + City (from RPC) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Conductores por país" subtitle="Conductores únicos impactados" icon={<Users size={18} className="text-blue-500" />}>
          {agg.drivers_by_country.length === 0 ? (
            <p className="text-sm text-slate-400 italic py-6 text-center">Sin datos</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {agg.drivers_by_country.map(d => {
                const max = Math.max(1, ...agg.drivers_by_country.map(x => x.count));
                const pct = (d.count / max) * 100;
                return (
                  <div key={d.country} className="p-3 rounded-lg border border-slate-100">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-bold text-slate-700">{d.country}</span>
                      <span className="text-sm font-bold text-blue-700">{formatNumber(d.count)}</span>
                    </div>
                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card title="Conductores por ciudad" subtitle="Top ciudades con más conductores" icon={<Users size={18} className="text-cyan-500" />}>
          {agg.drivers_by_city.length === 0 ? (
            <p className="text-sm text-slate-400 italic py-6 text-center">Sin datos</p>
          ) : (
            <div className="space-y-1.5 max-h-[420px] overflow-y-auto">
              {agg.drivers_by_city.map(d => {
                const max = agg.drivers_by_city[0]?.count || 1;
                const pct = (d.count / max) * 100;
                return (
                  <div key={d.city} className="flex items-center gap-2 p-2 rounded hover:bg-slate-50">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-xs font-semibold text-slate-800 truncate">{cityName(d.city)}</span>
                          <span className="text-[10px] text-slate-400">{d.country}</span>
                        </div>
                        <span className="text-xs font-bold text-cyan-700">{formatNumber(d.count)}</span>
                      </div>
                      <div className="h-1 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-cyan-500 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* Campaigns by Country + City (from RPC) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Campañas por país" subtitle="Cantidad de campañas activas" icon={<Megaphone size={18} className="text-purple-500" />}>
          {agg.campaigns_by_country.length === 0 ? (
            <p className="text-sm text-slate-400 italic py-6 text-center">Sin datos</p>
          ) : (
            <div className="space-y-2">
              {agg.campaigns_by_country.map(c => {
                const max = Math.max(1, ...agg.campaigns_by_country.map(x => x.campaigns));
                const pct = (c.campaigns / max) * 100;
                return (
                  <div key={c.country} className="p-3 rounded-lg border border-slate-100">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm font-bold text-slate-800">{c.country}</span>
                      <span className="text-lg font-bold text-purple-700">{c.campaigns}</span>
                    </div>
                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mb-2">
                      <div className="h-full bg-purple-500 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="flex items-center gap-3 text-[10px] text-slate-500">
                      <span>{c.comms} comms</span>
                      <span>{formatNumber(c.drivers)} DRVs</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card title="Campañas por ciudad" subtitle="Top ciudades con más campañas" icon={<Megaphone size={18} className="text-indigo-500" />}>
          {agg.campaigns_by_city.length === 0 ? (
            <p className="text-sm text-slate-400 italic py-6 text-center">Sin datos</p>
          ) : (
            <div className="space-y-1.5 max-h-[420px] overflow-y-auto">
              {agg.campaigns_by_city.map(c => {
                const max = agg.campaigns_by_city[0]?.campaigns || 1;
                const pct = (c.campaigns / max) * 100;
                return (
                  <div key={c.city} className="flex items-center gap-2 p-2 rounded hover:bg-slate-50">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-xs font-semibold text-slate-800 truncate">{cityName(c.city)}</span>
                          <span className="text-[10px] text-slate-400">{c.country}</span>
                        </div>
                        <span className="text-xs font-bold text-indigo-700">{c.campaigns}</span>
                      </div>
                      <div className="h-1 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <p className="text-[10px] text-slate-400 mt-0.5">{formatNumber(c.drivers)} DRVs</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* Per-Campaign Table */}
      <Card
        title="Análisis por campaña"
        subtitle={`${filteredCampaignRows.length} campaña${filteredCampaignRows.length !== 1 ? "s" : ""}`}
        icon={<Target size={18} className="text-brand-500" />}
        action={
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Buscar..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-7 pr-2 py-1.5 text-xs border border-slate-200 rounded-lg bg-white w-40"
              />
            </div>
            {filteredCampaignRows.length > 0 && (
              <button
                onClick={() => downloadCSV(
                  filteredCampaignRows.map(c => ({
                    campania: c.name,
                    comunicaciones: c.comms,
                    conductores: c.drivers,
                    canales: c.channels.join(" | "),
                    paises: c.countries.join(" | "),
                    dias: c.dates,
                    equipo: c.team,
                  })),
                  `campañas_${new Date().toISOString().split("T")[0]}.csv`,
                )}
                className="text-xs text-slate-500 hover:text-brand-600 flex items-center gap-1"
              >
                <Download size={12} /> CSV
              </button>
            )}
          </div>
        }
      >
        {filteredCampaignRows.length === 0 ? (
          <p className="text-sm text-slate-400 italic py-6 text-center">Sin campañas</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-[10px] text-slate-500 uppercase font-semibold">
                    <th className="py-2 px-3">Campaña</th>
                    <th className="py-2 px-3 text-right">Comms</th>
                    <th className="py-2 px-3 text-right">DRVs</th>
                    <th className="py-2 px-3 text-right">Días</th>
                    <th className="py-2 px-3">Canales</th>
                    <th className="py-2 px-3">Países</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleCampaigns.map(c => (
                    <tr key={c.name} className="border-b border-slate-50 last:border-0 hover:bg-slate-50 transition">
                      <td className="py-2.5 px-3">
                        <p className="font-bold text-slate-800 text-sm">{shortName(c.name)}</p>
                        <p className="text-[10px] text-slate-400">{c.team}</p>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">{c.comms}</td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-700">{formatNumber(c.drivers)}</td>
                      <td className="py-2.5 px-3 text-right text-slate-600">{c.dates}</td>
                      <td className="py-2.5 px-3">
                        <div className="flex flex-wrap gap-1">
                          {c.channels.map(ch => {
                            const cc = getChannelColor(ch);
                            return <span key={ch} className={`text-[10px] px-1.5 py-0.5 rounded ${cc.bg} ${cc.text} font-semibold`}>{ch}</span>;
                          })}
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex flex-wrap gap-1">
                          {c.countries.map(co => (
                            <span key={co} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-medium">{co}</span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filteredCampaignRows.length > 5 && (
              <button
                onClick={() => setShowAllCampaigns(o => !o)}
                className="mt-3 w-full text-xs text-brand-600 hover:underline font-medium flex items-center justify-center gap-1"
              >
                <ChevronDown size={14} className={`transition-transform ${showAllCampaigns ? "rotate-180" : ""}`} />
                {showAllCampaigns ? "Ver menos" : `Ver todas (${filteredCampaignRows.length})`}
              </button>
            )}
          </>
        )}
      </Card>
    </div>
  );
}

interface KpiTileProps {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "default" | "warning" | "danger" | "success";
}
function KpiTile({ label, value, hint, tone = "default" }: KpiTileProps) {
  const toneClasses: Record<string, string> = {
    default: "border-slate-200 bg-white",
    warning: "border-amber-200 bg-amber-50",
    danger: "border-red-200 bg-red-50",
    success: "border-emerald-200 bg-emerald-50",
  };
  return (
    <div className={`rounded-2xl border p-5 shadow-sm ${toneClasses[tone]}`}>
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-bold text-slate-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

interface CardProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}
function Card({ title, subtitle, icon, action, children }: CardProps) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-bold text-slate-800 flex items-center gap-2 text-sm">
            {icon}
            {title}
          </h3>
          {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
