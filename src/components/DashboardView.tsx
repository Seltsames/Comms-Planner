import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import type { CampaignRow, CampaignScheduleRow, AnalyticsAggregates } from "@/lib/queries";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import {
  Calendar, AlertTriangle, CheckCircle, FileText, Target, Users,
  Download, X, ChevronLeft, ChevronRight, Megaphone, List,
} from "lucide-react";
import AnalyticsView from "./AnalyticsView";

const TIME_SLOTS_30M: string[] = [];
for (let h = 7; h < 22; h++) {
  TIME_SLOTS_30M.push(`${String(h).padStart(2, "0")}:00`);
  TIME_SLOTS_30M.push(`${String(h).padStart(2, "0")}:30`);
}

const CHANNEL_COLORS: Record<string, { bg: string; border: string; text: string; dot: string }> = {
  "Pop Up": { bg: "bg-blue-500/15", border: "border-blue-500/30", text: "text-blue-600", dot: "bg-blue-500" },
  XPanel: { bg: "bg-purple-500/15", border: "border-purple-500/30", text: "text-purple-600", dot: "bg-purple-500" },
  Whatsapp: { bg: "bg-emerald-500/15", border: "border-emerald-500/30", text: "text-emerald-600", dot: "bg-emerald-500" },
  "Push in/out": { bg: "bg-amber-400/15", border: "border-amber-400/30", text: "text-amber-600", dot: "bg-amber-400" },
  "Push in": { bg: "bg-amber-400/15", border: "border-amber-400/30", text: "text-amber-600", dot: "bg-amber-400" },
  "Push out": { bg: "bg-amber-400/15", border: "border-amber-400/30", text: "text-amber-600", dot: "bg-amber-400" },
  Email: { bg: "bg-pink-500/15", border: "border-pink-500/30", text: "text-pink-600", dot: "bg-pink-500" },
  SMS: { bg: "bg-slate-100", border: "border-slate-200", text: "text-slate-600", dot: "bg-slate-400" },
};
const getChannelColor = (actionKey: string) =>
  CHANNEL_COLORS[actionKey] ?? { bg: "bg-brand-500/10", border: "border-brand-500/20", text: "text-brand-600", dot: "bg-brand-500" };

const POPE_CHANNELS = ["Push in/out", "Push in", "Push out", "Email", "Whatsapp", "SMS"];
const AD_CHANNELS = ["Pop Up", "XPanel"];

function shortName(fullName: string) {
  if (!fullName.startsWith("DRV MKT_")) return fullName;
  const parts = fullName.split("_");
  if (parts.length <= 4) return parts[parts.length - 1];
  return parts.slice(4).join("_");
}

function formatDateShort(dateStr: string) {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("es-MX", { weekday: "short", day: "2-digit", month: "short" });
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
  creatorEmail: string;
  status: string;
  drvIds: Set<string>;
}

interface ConflictDetail {
  campA: ScheduleItem;
  campB: ScheduleItem;
  overlappingDrivers: string[];
  overlapPercentA: number;
  overlapPercentB: number;
  severity: "green" | "yellow" | "red";
  reason: string;
}

export default function DashboardView() {
  const { user, role } = useAuth();
  const isAdmin = role === "admin";

  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [calendarWeekOffset, setCalendarWeekOffset] = useState(0);
  const [calendarViewAll, setCalendarViewAll] = useState(false);
  const [calendarSubTab, setCalendarSubTab] = useState<"pope" | "ad">("pope");
  const [inspectorConflict, setInspectorConflict] = useState<ConflictDetail | null>(null);

  const [filterChannel, setFilterChannel] = useState<string>("all");
  const [filterHourFrom, setFilterHourFrom] = useState<string>("all");
  const [filterHourTo, setFilterHourTo] = useState<string>("all");
  const [filterCreator, setFilterCreator] = useState<string>("all");
  const [filterTeam, setFilterTeam] = useState<string>("all");
  const [filterCountry, setFilterCountry] = useState<string>("all");

  const [activeTab, setActiveTab] = useState<"planning" | "analytics">("planning");

  const { data: rawCampaigns } = useAutoRefresh(
    async () => {
      const { data } = await supabase.from("campaigns").select("*");
      return (data as CampaignRow[]) ?? null;
    },
    60_000,
    [],
  );

  const { data: rawSchedules } = useAutoRefresh(
    async () => {
      const { data } = await supabase.from("campaign_schedules").select("*");
      return (data as CampaignScheduleRow[]) ?? null;
    },
    60_000,
    [],
  );

  // Server-side driver count (admin only — falls back to 0 silently for non-admins)
  const { data: aggregates } = useAutoRefresh(
    async () => {
      if (role !== "admin") return null;
      try {
        const { data, error } = await supabase.rpc("get_analytics_aggregates", {
          p_country: "all",
          p_channel: "all",
        });
        if (error) return null;
        return (data as AnalyticsAggregates) ?? null;
      } catch {
        return null;
      }
    },
    60_000,
    [role],
  );

  const totalDriversCount = aggregates?.kpis.total_drivers ?? 0;

  const scheduleItems = useMemo((): ScheduleItem[] => {
    if (!rawCampaigns || !rawSchedules) return [];
    const items: ScheduleItem[] = [];
    for (const camp of rawCampaigns) {
      if (camp.status === "rejected" || camp.status === "cancelled") continue;
      const campSchedules = rawSchedules.filter(s => s.campaign_id === camp.id);
      for (const sched of campSchedules) {
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
          creatorEmail: user?.email ?? "",
          status: camp.status,
          drvIds: new Set<string>(),
        });
      }
    }
    return items;
  }, [rawCampaigns, rawSchedules, user?.email]);

  const allDates = useMemo(() => {
    const dates = new Set<string>();
    scheduleItems.forEach(s => dates.add(s.scheduleDate));
    return Array.from(dates).sort();
  }, [scheduleItems]);

  const calendarDates = useMemo(() => {
    if (allDates.length === 0) return [];
    if (calendarViewAll && isAdmin) return allDates;
    const today = new Date();
    const dayOfWeek = today.getDay();
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1) + calendarWeekOffset * 7);
    const dates: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(startOfWeek);
      d.setDate(d.getDate() + i);
      dates.push(d.toISOString().split("T")[0]);
    }
    return dates;
  }, [allDates, calendarWeekOffset, calendarViewAll, isAdmin]);

  useEffect(() => {
    if (!selectedDate && allDates.length > 0) {
      const todayStr = new Date().toISOString().split("T")[0];
      setSelectedDate(allDates.includes(todayStr) ? todayStr : allDates[0]);
    }
  }, [allDates, selectedDate]);

  const filteredTimeSlots = useMemo(() => {
    if (filterHourFrom === "all" && filterHourTo === "all") return TIME_SLOTS_30M;
    const fromH = filterHourFrom !== "all" ? parseInt(filterHourFrom) : 7;
    const toH = filterHourTo !== "all" ? parseInt(filterHourTo) : 21;
    return TIME_SLOTS_30M.filter(slot => {
      const h = parseInt(slot.split(":")[0]);
      return h >= fromH && h <= toH;
    });
  }, [filterHourFrom, filterHourTo]);

  const filteredItems = useMemo(() => {
    return scheduleItems.filter(c =>
      (filterChannel === "all" || c.actionKey === filterChannel) &&
      (filterCreator === "all" || c.creatorId === filterCreator) &&
      (filterTeam === "all" || c.team === filterTeam) &&
      (filterCountry === "all" || c.country === filterCountry),
    );
  }, [scheduleItems, filterChannel, filterCreator, filterTeam, filterCountry]);

  const filteredBySubTab = useMemo(() => {
    return filteredItems.filter(c =>
      calendarSubTab === "pope" ? POPE_CHANNELS.includes(c.actionKey) : AD_CHANNELS.includes(c.actionKey),
    );
  }, [filteredItems, calendarSubTab]);

  const dayStats = useMemo(() => {
    const stats: Record<string, { items: ScheduleItem[]; totalVolume: number }> = {};
    filteredBySubTab.forEach(item => {
      if (!stats[item.scheduleDate]) stats[item.scheduleDate] = { items: [], totalVolume: 0 };
      stats[item.scheduleDate].items.push(item);
      stats[item.scheduleDate].totalVolume += item.drvIds.size;
    });
    return stats;
  }, [filteredBySubTab]);

  const conflicts = useMemo((): ConflictDetail[] => {
    const result: ConflictDetail[] = [];
    const byDate: Record<string, ScheduleItem[]> = {};
    scheduleItems.forEach(c => {
      if (!byDate[c.scheduleDate]) byDate[c.scheduleDate] = [];
      byDate[c.scheduleDate].push(c);
    });
    Object.entries(byDate).forEach(([_date, items]) => {
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const a = items[i], b = items[j];
          if (a.name === b.name) continue;
          const overlap = [...a.drvIds].filter(d => b.drvIds.has(d));
          if (overlap.length === 0) continue;
          const pctA = a.drvIds.size > 0 ? (overlap.length / a.drvIds.size) * 100 : 0;
          const pctB = b.drvIds.size > 0 ? (overlap.length / b.drvIds.size) * 100 : 0;
          const maxPct = Math.max(pctA, pctB);
          const [hA, mA] = a.timeSlot.split(":").map(Number);
          const [hB, mB] = b.timeSlot.split(":").map(Number);
          const timeDiff = Math.abs((hA * 60 + mA) - (hB * 60 + mB));
          const hasTimingConflict = timeDiff < 60;
          let severity: "green" | "yellow" | "red" = "green";
          let reason = "Sin conflicto significativo";
          if (maxPct > 50 || (hasTimingConflict && maxPct > 30)) {
            severity = "red";
            reason = `Conflicto crítico: ${overlap.length} conductores compartidos (${maxPct.toFixed(0)}%)${hasTimingConflict ? `, solo ${timeDiff} min de diferencia` : ""}`;
          } else if (maxPct > 0 && maxPct <= 30) {
            severity = "yellow";
            reason = `Conflicto moderado: ${overlap.length} conductores compartidos (${maxPct.toFixed(0)}%)${hasTimingConflict ? `, ${timeDiff} min de diferencia` : ""}`;
          }
          if (severity !== "green" || overlap.length > 0) {
            result.push({ campA: a, campB: b, overlappingDrivers: overlap, overlapPercentA: pctA, overlapPercentB: pctB, severity, reason });
          }
        }
      }
    });
    return result;
  }, [scheduleItems]);

  const todayItems = selectedDate ? (dayStats[selectedDate]?.items ?? []) : [];
  const todayConflicts = selectedDate ? conflicts.filter(c => c.campA.scheduleDate === selectedDate) : [];
  const redConflicts = conflicts.filter(c => c.severity === "red").length;
  const yellowConflicts = conflicts.filter(c => c.severity === "yellow").length;
  const approvedCount = scheduleItems.filter(c => c.status === "approved").length;

  const filterOptions = useMemo(() => {
    const channels = new Set<string>(), teams = new Set<string>(), countries = new Set<string>();
    scheduleItems.forEach(c => {
      channels.add(c.actionKey);
      if (c.team) teams.add(c.team);
      if (c.country) countries.add(c.country);
    });
    return {
      channels: Array.from(channels).sort(),
      teams: Array.from(teams).sort(),
      countries: Array.from(countries).sort(),
    };
  }, [scheduleItems]);

  const hasActiveFilters = filterChannel !== "all" || filterHourFrom !== "all" || filterHourTo !== "all" || filterCreator !== "all" || filterTeam !== "all" || filterCountry !== "all";

  function clearFilters() {
    setFilterChannel("all");
    setFilterHourFrom("all");
    setFilterHourTo("all");
    setFilterCreator("all");
    setFilterTeam("all");
    setFilterCountry("all");
  }

  const getCampsAtSlot = (date: string, time: string) =>
    filteredBySubTab.filter(c => c.scheduleDate === date && c.timeSlot === time);

  const getFullDayCamps = (date: string) =>
    filteredBySubTab.filter(c =>
      c.scheduleDate === date &&
      (c.timeSlot === "FULL_DAY" || c.timeSlot === "07:00-22:00" || c.timeSlot === "06:00-22:00"),
    );

  function renderCell(date: string, time: string, camps: ScheduleItem[]) {
    if (camps.length === 1) {
      const cc = getChannelColor(camps[0].actionKey);
      return (
        <td key={date + time} className="border-l border-slate-100 p-0.5 h-11 align-top">
          <button
            className={`w-full text-left rounded px-1.5 py-1 border text-[10px] leading-tight truncate cursor-pointer hover:shadow transition block ${cc.bg} ${cc.border} ${cc.text}`}
          >
            <span className="font-bold block truncate">{shortName(camps[0].name)}</span>
            <span className="opacity-70">{camps[0].actionKey}</span>
          </button>
        </td>
      );
    }
    const dominantChannel = camps.reduce((acc, c) => {
      acc[c.actionKey] = (acc[c.actionKey] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const topChannel = Object.entries(dominantChannel).sort((a, b) => b[1] - a[1])[0][0];
    const cc = getChannelColor(topChannel);
    const uniqueChannels = [...new Set(camps.map(c => c.actionKey))];
    return (
      <td key={date + time} className="border-l border-slate-100 p-0.5 h-11 align-top">
        <button
          className={`w-full text-left rounded px-1.5 py-1 border text-[10px] leading-tight cursor-pointer hover:shadow transition block ${cc.bg} ${cc.border} ${cc.text}`}
        >
          <span className="font-bold">{camps.length} comms</span>
          <div className="flex gap-0.5 mt-0.5">
            {uniqueChannels.map(ch => (
              <span key={ch} className={`w-2 h-2 rounded-full inline-block ${getChannelColor(ch).dot}`} />
            ))}
          </div>
        </button>
      </td>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 pb-32">
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-3xl font-bold text-slate-800">Dashboard</h2>
        <div className="flex items-center gap-3">
          <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 text-sm shadow-sm">
            <button
              onClick={() => setActiveTab("planning")}
              className={`rounded-lg px-4 py-1.5 font-semibold transition ${activeTab === "planning" ? "bg-brand-500 text-white" : "text-slate-600"}`}
            >
              Planificación
            </button>
            {isAdmin && (
              <button
                onClick={() => setActiveTab("analytics")}
                className={`rounded-lg px-4 py-1.5 font-semibold transition ${activeTab === "analytics" ? "bg-brand-500 text-white" : "text-slate-600"}`}
              >
                Análisis
              </button>
            )}
          </div>
        </div>
      </div>

      {activeTab === "planning" && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
            <KpiCard title="Programadas" value={scheduleItems.length} icon={<FileText size={24} className="text-blue-500" />} sub="Comunicaciones totales" />
            <KpiCard title="Aprobadas" value={approvedCount} icon={<CheckCircle size={24} className="text-green-500" />} sub="Auto + manual" />
            <KpiCard title="Conductores" value={totalDriversCount.toLocaleString()} icon={<Users size={24} className="text-brand-500" />} sub="Únicos impactados" />
            <KpiCard title="Riesgo moderado" value={yellowConflicts} icon={<AlertTriangle size={24} className="text-amber-500" />} sub="Amarillo (<30%)" isWarning={yellowConflicts > 0} />
            <KpiCard title="Conflicto crítico" value={redConflicts} icon={<AlertTriangle size={24} className="text-red-500" />} sub="Rojo (>50%)" isDanger={redConflicts > 0} />
          </div>

          <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-4">
              <Target size={20} className="text-blue-500" />
              <div>
                <span className="text-xs text-slate-500 uppercase font-medium">Fecha seleccionada</span>
                <p className="text-lg font-bold text-slate-800">{selectedDate ? formatDateShort(selectedDate) : "N/A"}</p>
              </div>
              {selectedDate && (
                <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                  todayConflicts.some(c => c.severity === "red") ? "bg-red-100 text-red-700" :
                  todayConflicts.some(c => c.severity === "yellow") ? "bg-amber-100 text-amber-700" :
                  "bg-green-100 text-green-700"
                }`}>
                  {todayConflicts.some(c => c.severity === "red") ? "Conflicto crítico" :
                   todayConflicts.some(c => c.severity === "yellow") ? "Riesgo moderado" : "Óptimo"}
                </span>
              )}
              <div className="flex gap-4 ml-4 text-sm">
                <span className="text-slate-500">{todayItems.length} comms</span>
                <span className="text-slate-500">{todayConflicts.length} conflictos</span>
              </div>
            </div>
          </div>

          {todayConflicts.length > 0 && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-5 border-l-4 border-l-red-400">
              <h3 className="font-bold text-slate-800 mb-3 flex items-center gap-2 text-sm">
                <AlertTriangle size={16} className="text-red-500" /> Alertas de conflicto — {selectedDate}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {(todayConflicts.length > 6 ? todayConflicts.slice(0, 6) : todayConflicts).map((cf, idx) => (
                  <div
                    key={idx}
                    onClick={() => setInspectorConflict(cf)}
                    className={`p-3 rounded-xl border cursor-pointer transition hover:shadow-md text-sm ${
                      cf.severity === "red" ? "border-red-300 bg-red-100/50" : "border-amber-300 bg-amber-100/50"
                    }`}
                  >
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <span className={`w-2.5 h-2.5 rounded-full ${cf.severity === "red" ? "bg-red-500" : "bg-amber-500"}`} />
                        <span className="font-bold text-slate-800">{shortName(cf.campA.name)}</span>
                        <span className="text-slate-500">vs</span>
                        <span className="font-bold text-slate-800">{shortName(cf.campB.name)}</span>
                      </div>
                      <span className="text-xs font-bold text-slate-500">{cf.overlappingDrivers.length} DRVs</span>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">{cf.reason}</p>
                  </div>
                ))}
              </div>
              {todayConflicts.length > 6 && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm font-medium text-brand-600 hover:underline">
                    Ver {todayConflicts.length - 6} alertas más…
                  </summary>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                    {todayConflicts.slice(6).map((cf, idx) => (
                      <div
                        key={`extra-${idx}`}
                        onClick={() => setInspectorConflict(cf)}
                        className={`p-3 rounded-xl border cursor-pointer transition hover:shadow-md text-sm ${
                          cf.severity === "red" ? "border-red-300 bg-red-100/50" : "border-amber-300 bg-amber-100/50"
                        }`}
                      >
                        <div className="flex justify-between items-center">
                          <div className="flex items-center gap-2">
                            <span className={`w-2.5 h-2.5 rounded-full ${cf.severity === "red" ? "bg-red-500" : "bg-amber-500"}`} />
                            <span className="font-bold text-slate-800">{shortName(cf.campA.name)}</span>
                            <span className="text-slate-500">vs</span>
                            <span className="font-bold text-slate-800">{shortName(cf.campB.name)}</span>
                          </div>
                          <span className="text-xs font-bold text-slate-500">{cf.overlappingDrivers.length} DRVs</span>
                        </div>
                        <p className="text-xs text-slate-500 mt-1">{cf.reason}</p>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}

          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-slate-100 bg-slate-50/50">
              {!calendarViewAll && (
                <button onClick={() => setCalendarWeekOffset(p => p - 1)} className="p-2 rounded-lg hover:bg-slate-100 transition">
                  <ChevronLeft size={18} className="text-slate-500" />
                </button>
              )}
              <h3 className="font-bold text-slate-800 flex items-center gap-2">
                <Calendar size={18} />
                Calendario de comunicaciones
                {!calendarViewAll && calendarDates.length > 0 && (
                  <span className="text-sm font-normal text-slate-500 ml-2">
                    {formatDateShort(calendarDates[0])} — {formatDateShort(calendarDates[calendarDates.length - 1])}
                  </span>
                )}
                {calendarViewAll && (
                  <span className="text-sm font-normal text-slate-500 ml-2">Todos los días ({calendarDates.length})</span>
                )}
              </h3>
              <div className="flex items-center gap-2">
                {isAdmin && (
                  <button
                    onClick={() => setCalendarViewAll(p => !p)}
                    className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition ${
                      calendarViewAll ? "bg-brand-50 border-brand-200 text-brand-600" : "border-slate-200 text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    <List size={14} /> {calendarViewAll ? "Vista semanal" : "Ver todos los días"}
                  </button>
                )}
                {!calendarViewAll && (
                  <button onClick={() => setCalendarWeekOffset(p => p + 1)} className="p-2 rounded-lg hover:bg-slate-100 transition">
                    <ChevronRight size={18} className="text-slate-500" />
                  </button>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 p-3 border-b border-slate-100 bg-slate-50/30">
              <span className="text-xs font-bold text-slate-500 uppercase">Filtros:</span>
              <select value={filterChannel} onChange={e => setFilterChannel(e.target.value)}
                className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-700 focus:ring-2 focus:ring-brand-500/30">
                <option value="all">Todos los canales</option>
                {filterOptions.channels.map(ch => <option key={ch} value={ch}>{ch}</option>)}
              </select>
              <div className="flex items-center gap-1">
                <select value={filterHourFrom} onChange={e => setFilterHourFrom(e.target.value)}
                  className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-700">
                  <option value="all">Desde</option>
                  {Array.from({ length: 15 }, (_, i) => i + 7).map(h => (
                    <option key={h} value={String(h).padStart(2, "0")}>{String(h).padStart(2, "0")}:00</option>
                  ))}
                </select>
                <span className="text-xs text-slate-400">—</span>
                <select value={filterHourTo} onChange={e => setFilterHourTo(e.target.value)}
                  className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-700">
                  <option value="all">Hasta</option>
                  {Array.from({ length: 15 }, (_, i) => i + 7).map(h => (
                    <option key={h} value={String(h).padStart(2, "0")}>{String(h).padStart(2, "0")}:00</option>
                  ))}
                </select>
              </div>
              <select value={filterTeam} onChange={e => setFilterTeam(e.target.value)}
                className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-700">
                <option value="all">Todos los equipos</option>
                {filterOptions.teams.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <select value={filterCountry} onChange={e => setFilterCountry(e.target.value)}
                className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-700">
                <option value="all">Todos los países</option>
                {filterOptions.countries.map(co => <option key={co} value={co}>{co}</option>)}
              </select>
              {hasActiveFilters && (
                <button onClick={clearFilters} className="text-xs text-red-500 hover:underline font-medium">Limpiar</button>
              )}
            </div>

            <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-100 bg-slate-50/30">
              <div className="flex items-center gap-4 text-xs">
                <button
                  onClick={() => setCalendarSubTab("pope")}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition ${
                    calendarSubTab === "pope" ? "bg-brand-500 text-white" : "text-slate-500 hover:bg-slate-100"
                  }`}
                >
                  <Megaphone size={13} /> POPE
                </button>
                <button
                  onClick={() => setCalendarSubTab("ad")}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition ${
                    calendarSubTab === "ad" ? "bg-brand-500 text-white" : "text-slate-500 hover:bg-slate-100"
                  }`}
                >
                  Ad Placement
                </button>
              </div>
              {calendarSubTab === "pope" ? (
                <div className="ml-4 flex items-center gap-3 text-[10px] text-slate-500">
                  {[
                    { key: "Whatsapp", label: "Whatsapp", color: "bg-emerald-500" },
                    { key: "Push in/out", label: "Push", color: "bg-amber-400" },
                    { key: "Email", label: "Email", color: "bg-pink-500" },
                    { key: "SMS", label: "SMS", color: "bg-slate-400" },
                  ].map(l => (
                    <div key={l.key} className="flex items-center gap-1">
                      <span className={`w-2.5 h-2.5 rounded-sm ${l.color}`} />
                      <span>{l.label}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="ml-4 flex items-center gap-3 text-[10px] text-slate-500">
                  {[
                    { key: "Pop Up", label: "Pop up", color: "bg-blue-500" },
                    { key: "XPanel", label: "XPanel", color: "bg-purple-500" },
                  ].map(l => (
                    <div key={l.key} className="flex items-center gap-1">
                      <span className={`w-2.5 h-2.5 rounded-sm ${l.color}`} />
                      <span>{l.label}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse" style={{ minWidth: calendarViewAll ? Math.max(900, calendarDates.length * 130) : 900 }}>
                <colgroup>
                  <col style={{ width: 80 }} />
                  {calendarDates.map(() => <col style={{ minWidth: calendarViewAll ? 120 : undefined }} />)}
                </colgroup>
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="p-2 text-xs font-bold text-slate-500 text-center bg-slate-50 border-r border-slate-200">Hora</th>
                    {calendarDates.map(date => {
                      const isSelected = date === selectedDate;
                      return (
                        <th key={date} onClick={() => setSelectedDate(date)}
                          className={`p-2 text-center cursor-pointer transition border-l border-slate-100 font-normal ${isSelected ? "bg-brand-50" : "hover:bg-slate-50"}`}>
                          <p className="text-xs font-bold text-slate-700">{formatDateShort(date)}</p>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {calendarSubTab === "ad" && (
                    <tr className="border-b border-slate-100 bg-blue-50/30">
                      <td className="p-1 text-[10px] font-bold text-blue-600 text-center bg-blue-50 border-r border-slate-200 h-11 align-middle uppercase whitespace-nowrap">Día completo</td>
                      {calendarDates.map(date => {
                        const camps = getFullDayCamps(date);
                        if (camps.length === 0) return <td key={date} className="border-l border-slate-100 h-11" />;
                        return renderCell(date, "FULL_DAY", camps);
                      })}
                    </tr>
                  )}
                  {filteredTimeSlots.map(time => (
                    <tr key={time} className="border-b border-slate-100/50">
                      <td className="p-1 text-xs font-mono text-slate-400 text-center bg-slate-50 border-r border-slate-200 h-11 align-middle">{time}</td>
                      {calendarDates.map(date => {
                        const camps = getCampsAtSlot(date, time);
                        if (camps.length === 0) return <td key={date} className="border-l border-slate-100 h-11" />;
                        return renderCell(date, time, camps);
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === "analytics" && isAdmin && (
        <AnalyticsView />
      )}

      {inspectorConflict && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setInspectorConflict(null)}>
          <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b border-slate-200 flex justify-between items-center bg-slate-50">
              <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                <AlertTriangle className={inspectorConflict.severity === "red" ? "text-red-500" : "text-amber-500"} size={20} />
                Inspector de conflictos
              </h2>
              <button onClick={() => setInspectorConflict(null)} className="p-2 hover:bg-slate-200 rounded-full">
                <X size={24} className="text-slate-400" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                  <p className="text-[10px] text-slate-500 uppercase font-bold">Campaña A</p>
                  <p className="font-bold text-slate-800 mt-0.5">{shortName(inspectorConflict.campA.name)}</p>
                  <p className="text-sm text-slate-500">{inspectorConflict.campA.timeSlot} | {inspectorConflict.campA.actionKey}</p>
                </div>
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                  <p className="text-[10px] text-slate-500 uppercase font-bold">Campaña B</p>
                  <p className="font-bold text-slate-800 mt-0.5">{shortName(inspectorConflict.campB.name)}</p>
                  <p className="text-sm text-slate-500">{inspectorConflict.campB.timeSlot} | {inspectorConflict.campB.actionKey}</p>
                </div>
                <div className={`p-4 rounded-xl border ${inspectorConflict.severity === "red" ? "bg-red-50 border-red-200" : "bg-amber-50 border-amber-200"}`}>
                  <p className={`text-[10px] uppercase font-bold ${inspectorConflict.severity === "red" ? "text-red-600" : "text-amber-600"}`}>Overlap</p>
                  <p className={`font-bold text-2xl mt-0.5 ${inspectorConflict.severity === "red" ? "text-red-600" : "text-amber-600"}`}>
                    {inspectorConflict.overlappingDrivers.length}
                  </p>
                  <p className="text-xs text-slate-500">
                    {inspectorConflict.overlapPercentA.toFixed(1)}% de A / {inspectorConflict.overlapPercentB.toFixed(1)}% de B
                  </p>
                </div>
              </div>
              <div className={`p-4 rounded-xl border ${inspectorConflict.severity === "red" ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"}`}>
                <p className="font-bold text-slate-800 mb-1">Razón del conflicto</p>
                <p className="text-sm text-slate-600">{inspectorConflict.reason}</p>
              </div>
              <button
                onClick={() => {
                  const csv = "DriverID\n" + inspectorConflict.overlappingDrivers.join("\n");
                  const link = document.createElement("a");
                  link.setAttribute("href", encodeURI("data:text/csv;charset=utf-8," + csv));
                  link.setAttribute("download", `conflictos_${inspectorConflict.campA.name}_vs_${inspectorConflict.campB.name}.csv`);
                  document.body.appendChild(link); link.click(); document.body.removeChild(link);
                }}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 border border-slate-200 rounded-xl text-slate-700 hover:bg-slate-50 transition font-semibold text-sm"
              >
                <Download size={18} /> Descargar IDs en conflicto
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface KpiCardProps {
  title: string;
  value: number | string;
  icon: React.ReactNode;
  sub: string;
  isWarning?: boolean;
  isDanger?: boolean;
  onClick?: () => void;
}

function KpiCard({ title, value, icon, sub, isWarning, isDanger, onClick }: KpiCardProps) {
  const borderColor = isDanger ? "border-red-200" : isWarning ? "border-amber-200" : "border-slate-200";
  const bgColor = isDanger ? "bg-red-50" : isWarning ? "bg-amber-50" : "bg-white";
  return (
    <div
      onClick={onClick}
      className={`rounded-2xl border p-5 shadow-sm transition cursor-pointer hover:shadow ${borderColor} ${bgColor} ${onClick ? "cursor-pointer" : ""}`}
    >
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</p>
        <div className="text-slate-400">{icon}</div>
      </div>
      <p className={`text-3xl font-bold ${isDanger ? "text-red-600" : isWarning ? "text-amber-600" : "text-slate-900"}`}>{value}</p>
      <p className="text-xs text-slate-400 mt-1">{sub}</p>
    </div>
  );
}