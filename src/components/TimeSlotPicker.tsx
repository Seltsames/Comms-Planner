import { useEffect, useMemo, useState } from "react";
import { Clock, Check, AlertTriangle, Ban, ChevronDown, ChevronUp, Sun, Lock } from "lucide-react";
import { getSlotAvailabilityV2, type SlotAvailabilityV2 } from "@/lib/queries";
import type { AudienceKind } from "@/lib/auth";

export const TIME_SLOTS_30M: string[] = [];
for (let h = 7; h <= 22; h++) {
  TIME_SLOTS_30M.push(`${String(h).padStart(2, "0")}:00`);
  if (h < 22) TIME_SLOTS_30M.push(`${String(h).padStart(2, "0")}:30`);
}

interface TimeSlotPickerProps {
  actionKey: string;
  country: string;
  cityCodes: string[];
  startDate: string;
  endDate: string;
  selectedSlots: Record<string, string>;
  onToggle: (date: string, slot: string) => void;
  /** Only for isRangeOnly channels: sets/clears the free HH:MM-HH:MM range of a date. */
  onRangeChange?: (date: string, range: string | null) => void;
  isPope: boolean;
  isRangeOnly: boolean;
  blockedDates: Set<string>;
  audienceIds: string[];
  kind: AudienceKind;
  onConflictsChange?: (
    conflicts: Array<{ date: string; reason: string; actionKey: string }>,
    counts?: { atRiskCount: number; lockedCount: number },
  ) => void;
}

function formatDateLabel(dateStr: string) {
  const d = new Date(dateStr + "T12:00:00");
  const days = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
  const months = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  return { day: days[d.getDay()], date: d.getDate(), month: months[d.getMonth()] };
}

function getSlotClass(severity: string | null, selected: boolean) {
  if (selected) {
    return "bg-orange-500 text-white border-orange-500 shadow-md hover:bg-orange-600";
  }
  switch (severity) {
    case "red":
      return "bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed";
    case "yellow":
      return "bg-amber-50 border-amber-300 text-amber-700 hover:bg-amber-100 cursor-pointer";
    case "green":
      return "bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-emerald-100 cursor-pointer";
    default:
      return "bg-slate-50 border-slate-200 text-slate-400 cursor-not-allowed";
  }
}

function getSeverityIcon(severity: string | null) {
  switch (severity) {
    case "yellow":
      return <AlertTriangle size={10} className="text-amber-500" />;
    case "red":
      return <Ban size={10} className="text-slate-400" />;
    default:
      return null;
  }
}

/**
 * Free "desde – hasta" range picker for Ad Placement channels: no hourly
 * slots, the user types any HH:MM boundaries (e.g. 00:00–23:59).
 */
function RangeDayPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (range: string | null) => void;
}) {
  const selected = value !== null;
  const [from, setFrom] = useState(() => value?.split("-")[0] ?? "00:00");
  const [to, setTo] = useState(() => value?.split("-")[1] ?? "23:59");
  const invalid = from >= to;

  function update(nextFrom: string, nextTo: string) {
    setFrom(nextFrom);
    setTo(nextTo);
    if (selected && nextFrom < nextTo) onChange(`${nextFrom}-${nextTo}`);
  }

  return (
    <div className="space-y-2 p-3">
      <div>
        <span className="mb-0.5 block text-[10px] font-medium text-slate-500">Desde</span>
        <input
          type="time"
          value={from}
          onChange={(e) => update(e.target.value, to)}
          className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700"
        />
      </div>
      <div>
        <span className="mb-0.5 block text-[10px] font-medium text-slate-500">Hasta</span>
        <input
          type="time"
          value={to}
          onChange={(e) => update(from, e.target.value)}
          className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700"
        />
      </div>
      {invalid && (
        <p className="text-[10px] font-medium text-red-600">"Desde" debe ser menor que "Hasta"</p>
      )}
      <button
        type="button"
        disabled={!selected && invalid}
        onClick={() => (selected ? onChange(null) : onChange(`${from}-${to}`))}
        className={`w-full rounded-lg border py-1.5 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${
          selected
            ? "border-orange-500 bg-orange-500 text-white hover:bg-orange-600"
            : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
        }`}
      >
        {selected ? `✓ ${value}` : "Seleccionar día"}
      </button>
    </div>
  );
}

export function TimeSlotPicker({
  actionKey,
  country,
  cityCodes,
  startDate,
  endDate,
  selectedSlots,
  onToggle,
  onRangeChange,
  isPope,
  isRangeOnly,
  blockedDates,
  audienceIds,
  kind,
  onConflictsChange,
}: TimeSlotPickerProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [slotAvailability, setSlotAvailability] = useState<Record<string, SlotAvailabilityV2>>({});
  const [dayLocks, setDayLocks] = useState<Record<string, { locked: boolean; reason: string }>>({});
  const [loadingSlots, setLoadingSlots] = useState(false);

  const availableDates = useMemo(() => {
    const dates: string[] = [];
    const start = new Date(startDate + "T00:00:00");
    const end = new Date(endDate + "T00:00:00");
    const cur = new Date(start);
    while (cur <= end) {
      dates.push(cur.toISOString().split("T")[0]);
      cur.setDate(cur.getDate() + 1);
    }
    return dates;
  }, [startDate, endDate]);

  useEffect(() => {
    let cancelled = false;
    setLoadingSlots(true);
    getSlotAvailabilityV2(country, cityCodes, startDate, endDate, [actionKey], audienceIds, kind)
      .then((slots) => {
        if (cancelled) return;
        const map: Record<string, SlotAvailabilityV2> = {};
        const locks: Record<string, { locked: boolean; reason: string }> = {};
        for (const s of slots) {
          const key = `${s.schedule_date}|${s.time_slot}`;
          map[key] = s;
          if (s.day_locked && !locks[s.schedule_date]) {
            locks[s.schedule_date] = { locked: true, reason: s.day_lock_reason ?? "Día bloqueado" };
          }
        }
        setSlotAvailability(map);
        setDayLocks(locks);

        if (onConflictsChange) {
          const conflicts: Array<{ date: string; reason: string; actionKey: string }> = [];
          for (const [date, lock] of Object.entries(locks)) {
            if (lock.locked) {
              conflicts.push({ date, reason: lock.reason, actionKey });
            }
          }
          const atRiskCount = Object.values(map).filter((s) => s.severity === "yellow").length;
          const lockedCount = Object.values(map).filter((s) => s.severity === "red").length;
          onConflictsChange(conflicts, { atRiskCount, lockedCount });
        }
      })
      .catch((err) => {
        console.error("getSlotAvailabilityV2 error", err);
        if (!cancelled) {
          setSlotAvailability({});
          setDayLocks({});
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingSlots(false);
      });
    return () => {
      cancelled = true;
    };
  }, [country, cityCodes, startDate, endDate, actionKey, audienceIds.join(","), kind]);

  const makeKey = (date: string, slot: string) => `${date}|${slot}`;
  const isSelected = (date: string, slot: string) => !!selectedSlots[makeKey(date, slot)];
  const isFullDay = (date: string) => !!selectedSlots[makeKey(date, "FULL_DAY")];

  const totalSelected = Object.keys(selectedSlots).length;

  function toggleSlot(date: string, slot: string) {
    const key = makeKey(date, slot);
    const avail = slotAvailability[key];
    if (avail?.severity === "red" && !selectedSlots[key]) return;
    if (selectedSlots[key]) {
      onToggle(date, slot);
      return;
    }
    if (isPope) {
      Object.keys(selectedSlots).forEach((k) => {
        if (k.startsWith(date + "|")) {
          const [, ts] = k.split("|");
          if (ts !== "FULL_DAY" && ts !== "RANGE") {
            onToggle(k.split("|")[0], ts);
          }
        }
      });
    }
    onToggle(date, slot);
  }

  function toggleFullDay(date: string) {
    const key = makeKey(date, "FULL_DAY");
    if (selectedSlots[key]) {
      onToggle(date, "FULL_DAY");
    } else {
      Object.keys(selectedSlots).forEach((k) => {
        if (k.startsWith(date + "|")) onToggle(k.split("|")[0], k.split("|")[1]);
      });
      onToggle(date, "FULL_DAY");
    }
  }

  const lockedCount = Object.values(dayLocks).filter((d) => d.locked).length;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="w-full flex justify-between items-center px-4 sm:px-5 py-4 bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer border-b border-slate-200"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-brand-500/10 text-brand-600 flex items-center justify-center shrink-0">
            <Clock size={18} />
          </div>
          <div className="text-left min-w-0">
            <h4 className="font-bold text-slate-800 text-sm truncate">{actionKey}</h4>
            <p className="text-xs text-slate-500 truncate">
              {isRangeOnly
                ? "Ad Placement · Rango de horas"
                : isPope
                  ? "POPE · 1 horario por día"
                  : "Ad Placement · Múltiples horarios"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {totalSelected > 0 && (
            <span className="bg-orange-500 text-white text-xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
              <Check size={12} /> {totalSelected}
            </span>
          )}
          {lockedCount > 0 && (
            <span className="bg-slate-200 text-slate-600 text-xs font-bold px-2 py-1 rounded-full flex items-center gap-1">
              <Lock size={10} /> {lockedCount}
            </span>
          )}
          {isOpen ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
        </div>
      </button>

      {isOpen && (
        <>
          {!isRangeOnly && (
            <div className="px-4 sm:px-5 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex flex-wrap gap-3 sm:gap-4">
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-sm bg-emerald-50 border border-emerald-300" /> Disponible
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-sm bg-amber-50 border border-amber-300" /> Bajo riesgo
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-sm bg-slate-100 border border-slate-200" /> No disponible
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-sm bg-orange-500" /> Seleccionado
                </span>
              </div>
            </div>
          )}

          <div className="p-4 sm:p-5">
            {loadingSlots && (
              <div className="py-8 text-center text-xs text-slate-400">
                <div className="inline-block animate-pulse">Cargando disponibilidad…</div>
              </div>
            )}

            {!loadingSlots && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {availableDates.map((date) => {
                  const dayLock = dayLocks[date];
                  const isDateBlocked = blockedDates.has(date) || dayLock?.locked;
                  const formatted = formatDateLabel(date);

                  return (
                    <div
                      key={date}
                      className={`rounded-xl border transition-all ${
                        isDateBlocked
                          ? "border-slate-200 bg-slate-50/50"
                          : "border-slate-200 bg-white"
                      }`}
                    >
                      <div
                        className={`text-center py-2.5 border-b rounded-t-xl ${
                          isDateBlocked
                            ? "bg-slate-100 border-slate-200"
                            : "bg-emerald-50/50 border-emerald-100"
                        }`}
                      >
                        <div className="text-xs text-slate-500 font-medium">{formatted.day}</div>
                        <div className={`text-xl font-bold ${isDateBlocked ? "text-slate-400" : "text-slate-700"}`}>
                          {formatted.date}
                        </div>
                        <div className="text-xs text-slate-400">{formatted.month}</div>
                      </div>

                      {isDateBlocked ? (
                        <div className="px-3 py-4 text-center">
                          <Lock size={16} className="text-slate-400 mx-auto mb-1.5" />
                          <p className="text-[11px] font-bold text-slate-500 mb-1">Día bloqueado</p>
                          <p className="text-[10px] text-slate-500 leading-tight">
                            {dayLock?.reason ?? "Otro canal ya tiene este día ocupado."}
                          </p>
                        </div>
                      ) : isRangeOnly ? (
                        <RangeDayPicker
                          value={selectedSlots[makeKey(date, "RANGE")] ?? null}
                          onChange={(range) => onRangeChange?.(date, range)}
                        />
                      ) : (
                        <div className="p-2 max-h-[320px] overflow-y-auto space-y-0.5">
                          {!isRangeOnly && !isPope && (
                            <button
                              onClick={() => toggleFullDay(date)}
                              className={`w-full py-1.5 rounded-lg text-xs font-bold border transition-all flex items-center justify-center gap-1 mb-1 ${
                                isFullDay(date)
                                  ? "bg-orange-500 text-white border-orange-500"
                                  : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
                              }`}
                            >
                              <Sun size={12} />
                              Día completo
                            </button>
                          )}
                          {TIME_SLOTS_30M.map((slot) => {
                            const key = makeKey(date, slot);
                            const avail = slotAvailability[key];
                            const active = isSelected(date, slot);
                            const severity = avail?.severity ?? null;
                            const isDisabled = severity === "red" && !active;

                            return (
                              <button
                                key={slot}
                                onClick={() => !isDisabled && toggleSlot(date, slot)}
                                disabled={isDisabled}
                                title={
                                  severity === "red"
                                    ? "No disponible"
                                    : severity === "yellow"
                                      ? "Bajo riesgo · requiere aprobación"
                                      : undefined
                                }
                                className={`w-full py-1 rounded text-[11px] font-medium border transition-all flex items-center justify-center gap-1 ${getSlotClass(severity, active)}`}
                              >
                                {active ? <Check size={10} /> : getSeverityIcon(severity)}
                                {slot}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {!loadingSlots && availableDates.length === 0 && (
              <p className="text-center text-xs text-slate-400 py-4">Sin fechas en el rango seleccionado</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}