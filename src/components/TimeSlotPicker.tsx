import { useEffect, useMemo, useState } from "react";
import { Clock, Check, AlertTriangle, Ban, ChevronDown, ChevronUp, Sun, ArrowRight } from "lucide-react";
import { getSlotAvailability, type SlotAvailability } from "@/lib/queries";

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
  selectedSlots: Record<string, string>; // "YYYY-MM-DD|HH:MM" -> time string
  onToggle: (date: string, slot: string) => void;
  isPope: boolean;
  isRangeOnly: boolean;
  blockedDates: Set<string>;
}

function formatDateLabel(dateStr: string) {
  const d = new Date(dateStr + "T12:00:00");
  const days = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
  const months = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  return { day: days[d.getDay()], date: d.getDate(), month: months[d.getMonth()] };
}

function getSeverityColor(severity: string | null, selected: boolean) {
  if (selected) return "bg-brand-500 text-white border-brand-500 shadow-sm ring-2 ring-brand-500/30";
  switch (severity) {
    case "green":
      return "bg-white border-slate-200 text-slate-700 hover:border-brand-300 cursor-pointer";
    case "yellow":
      return "bg-amber-50 border-amber-300 text-amber-700 hover:bg-amber-100 cursor-pointer";
    case "red":
      return "bg-red-50 border-red-300 text-red-400 cursor-not-allowed opacity-60";
    default:
      return "bg-white border-slate-200 text-slate-700 hover:border-brand-300 cursor-pointer";
  }
}

function getSeverityIcon(severity: string | null) {
  switch (severity) {
    case "yellow":
      return <AlertTriangle size={10} className="text-amber-500" />;
    case "red":
      return <Ban size={10} className="text-red-400" />;
    default:
      return null;
  }
}

export function TimeSlotPicker({
  actionKey,
  country,
  cityCodes,
  startDate,
  endDate,
  selectedSlots,
  onToggle,
  isPope,
  isRangeOnly,
  blockedDates,
}: TimeSlotPickerProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [selectionMode, setSelectionMode] = useState<"slots" | "range">("slots");
  const [dateRanges, setDateRanges] = useState<Record<string, { start: string; end: string }>>({});
  const [slotAvailability, setSlotAvailability] = useState<Record<string, SlotAvailability>>({});
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
    getSlotAvailability(country, cityCodes, startDate, endDate, [actionKey])
      .then((slots) => {
        if (cancelled) return;
        const map: Record<string, SlotAvailability> = {};
        for (const s of slots) {
          const key = `${s.schedule_date}|${s.time_slot}`;
          map[key] = s;
        }
        setSlotAvailability(map);
      })
      .catch(() => {
        if (!cancelled) setSlotAvailability({});
      })
      .finally(() => {
        if (!cancelled) setLoadingSlots(false);
      });
    return () => {
      cancelled = true;
    };
  }, [country, cityCodes, startDate, endDate, actionKey]);

  const makeKey = (date: string, slot: string) => `${date}|${slot}`;
  const isSelected = (date: string, slot: string) => !!selectedSlots[makeKey(date, slot)];
  const isFullDay = (date: string) => !!selectedSlots[makeKey(date, "FULL_DAY")];
  const isRangeSet = (date: string) => !!selectedSlots[makeKey(date, "RANGE")];

  const slotsPerDate = useMemo(() => {
    const map: Record<string, number> = {};
    Object.keys(selectedSlots).forEach((key) => {
      const date = key.split("|")[0];
      map[date] = (map[date] || 0) + 1;
    });
    return map;
  }, [selectedSlots]);

  const selectedSummary = useMemo(() => {
    const byDate: Record<string, string[]> = {};
    Object.entries(selectedSlots).forEach(([key, val]) => {
      const [date, time] = key.split("|");
      if (!byDate[date]) byDate[date] = [];
      if (time === "FULL_DAY") byDate[date].push("Día completo");
      else if (time === "RANGE") byDate[date].push(val);
      else byDate[date].push(val);
    });
    return Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, times]) => ({ date, times, formatted: formatDateLabel(date) }));
  }, [selectedSlots]);

  const totalSelected = Object.keys(selectedSlots).length;

  function toggleSlot(date: string, slot: string) {
    const key = makeKey(date, slot);
    const avail = slotAvailability[key];
    if (avail && avail.severity === "red" && !selectedSlots[key]) return;

    if (selectedSlots[key]) {
      const next = { ...selectedSlots };
      delete next[key];
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

  function applyRange(date: string) {
    const range = dateRanges[date];
    if (!range || !range.start || !range.end) return;
    const [sh, sm] = range.start.split(":").map(Number);
    const [eh, em] = range.end.split(":").map(Number);
    const startMin = sh * 60 + sm;
    const endMin = eh * 60 + em;
    if (endMin <= startMin) return;

    Object.keys(selectedSlots).forEach((k) => {
      if (k.startsWith(date + "|")) onToggle(k.split("|")[0], k.split("|")[1]);
    });
    onToggle(date, "RANGE");
    const next = { ...selectedSlots };
    next[makeKey(date, "RANGE")] = `${range.start}-${range.end}`;
    onToggle(date, "RANGE");
  }

  function clearDate(date: string) {
    Object.keys(selectedSlots).forEach((k) => {
      if (k.startsWith(date + "|")) onToggle(k.split("|")[0], k.split("|")[1]);
    });
  }

  const visibleDates = availableDates.slice(0, 7);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="w-full flex justify-between items-center px-5 py-4 bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer border-b border-slate-200"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-brand-500/10 text-brand-600 flex items-center justify-center">
            <Clock size={18} />
          </div>
          <div className="text-left">
            <h4 className="font-bold text-slate-800 text-sm">{actionKey}</h4>
            <p className="text-xs text-slate-500">
              {isRangeOnly
                ? "Ad Placement · Rango de horas"
                : isPope
                  ? "POPE · 1 horario por día"
                  : "Ad Placement · Múltiples horarios"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {totalSelected > 0 && (
            <span className="bg-brand-500 text-white text-xs font-bold px-3 py-1.5 rounded-full flex items-center gap-1">
              <Check size={12} /> {totalSelected}
            </span>
          )}
          {isOpen ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
        </div>
      </button>

      {!isOpen && totalSelected > 0 && (
        <div className="px-5 py-3 flex flex-wrap gap-2 bg-white">
          {selectedSummary.map(({ date, times, formatted }) => (
            <div
              key={date}
              className="bg-brand-50 border border-brand-200 rounded-lg px-3 py-2 flex items-center gap-2"
            >
              <span className="text-xs font-semibold text-brand-700">
                {formatted.day} {formatted.date} {formatted.month}
              </span>
              <span className="text-xs text-brand-500">{times.join(", ")}</span>
            </div>
          ))}
        </div>
      )}

      {!isOpen && totalSelected === 0 && (
        <div className="px-5 py-3 text-xs text-slate-400 italic bg-white">Sin horarios seleccionados</div>
      )}

      {isOpen && (
        <>
          <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-4 text-xs">
            <div className="flex flex-wrap gap-4">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm bg-white border border-slate-200" /> Disponible
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm bg-amber-50 border border-amber-300" /> Bajo riesgo
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm bg-red-50 border border-red-300" /> No disponible
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm bg-brand-500" /> Seleccionado
              </span>
            </div>
            {!isRangeOnly && (
              <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5 border border-slate-200">
                <button
                  onClick={() => setSelectionMode("slots")}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                    selectionMode === "slots"
                      ? "bg-brand-500 text-white shadow-sm"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  Franjas
                </button>
                <button
                  onClick={() => setSelectionMode("range")}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                    selectionMode === "range"
                      ? "bg-brand-500 text-white shadow-sm"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  Rango de horas
                </button>
              </div>
            )}
          </div>

          <div className="p-5 overflow-x-auto">
            {loadingSlots && (
              <div className="flex items-center justify-center py-4 mb-2">
                <span className="text-xs text-slate-400 animate-pulse">Consultando disponibilidad…</span>
              </div>
            )}
            <div className="overflow-x-auto max-h-[500px] overflow-y-auto rounded-xl">
              <div
                className="grid gap-4"
                style={{ gridTemplateColumns: `repeat(${visibleDates.length}, minmax(160px, 33.333%))`, minWidth: "600px" }}
              >
              {visibleDates.map((date) => {
                const f = formatDateLabel(date);
                const isToday = date === new Date().toISOString().split("T")[0];
                const isBlocked = blockedDates.has(date);
                const dateHasSelection = (slotsPerDate[date] ?? 0) > 0;

                return (
                  <div
                    key={date}
                    className={`rounded-xl border transition-all relative ${
                      isBlocked
                        ? "border-amber-300 opacity-60"
                        : dateHasSelection
                          ? "border-brand-300 bg-brand-50/30"
                          : "border-slate-200"
                    }`}
                  >
                    <div
                      className={`text-center py-3 border-b rounded-t-xl ${
                        isToday ? "bg-brand-50 border-brand-200" : "bg-slate-50 border-slate-100"
                      }`}
                    >
                      <div className="text-xs text-slate-500 font-medium">{f.day}</div>
                      <div className={`text-xl font-bold ${isToday ? "text-brand-600" : "text-slate-800"}`}>
                        {f.date}
                      </div>
                      <div className="text-xs text-slate-400">{f.month}</div>
                    </div>

                    {isBlocked && (
                      <div className="mx-2 mt-2 p-2.5 bg-amber-50 border border-amber-200 rounded-lg">
                        <div className="flex items-center gap-1.5">
                          <Ban size={12} className="text-amber-600 shrink-0" />
                          <span className="text-xs font-bold text-amber-700">Día bloqueado</span>
                        </div>
                        <p className="text-[10px] text-amber-600 leading-tight mt-1">
                          Push o WhatsApp ya seleccionado este día.
                        </p>
                      </div>
                    )}

                    {!isBlocked && selectionMode === "slots" && !isRangeOnly && (
                      <div className="px-2 pt-2">
                        {!isPope && (
                          <button
                            onClick={() => toggleFullDay(date)}
                            className={`w-full py-1.5 rounded-lg text-xs font-bold border transition-all flex items-center justify-center gap-1 mb-1 ${
                              isFullDay(date)
                                ? "bg-brand-500 text-white border-brand-500"
                                : "bg-slate-50 border-slate-200 text-slate-600 hover:border-brand-300"
                            }`}
                          >
                            <Sun size={12} />
                            Día completo
                            {!isFullDay(date) && getSeverityIcon(slotAvailability[makeKey(date, "FULL_DAY")]?.severity ?? null)}
                          </button>
                        )}
                      </div>
                    )}

                    {!isBlocked && selectionMode === "slots" && !isRangeOnly && (
                      <div
                        className={`px-2 pb-2 space-y-0.5 max-h-[280px] overflow-y-auto ${
                          isFullDay(date) ? "opacity-40 pointer-events-none" : ""
                        }`}
                      >
                        {TIME_SLOTS_30M.map((slot) => {
                          const key = makeKey(date, slot);
                          const avail = slotAvailability[key];
                          const active = isSelected(date, slot);
                          const blocked = avail?.severity === "red" && !active;
                          const popeOtherSelected = isPope && dateHasSelection && !active;

                          return (
                            <button
                              key={slot}
                              onClick={() => !blocked && toggleSlot(date, slot)}
                              disabled={blocked}
                              title={
                                avail?.conflict_count
                                  ? `${avail.conflict_count} conflictos`
                                  : undefined
                              }
                              className={`group w-full py-1 rounded-lg text-xs font-medium border transition-all flex items-center justify-center gap-1 ${
                                active
                                  ? "bg-brand-500 text-white border-brand-500 shadow-sm hover:bg-red-500 hover:border-red-500"
                                  : popeOtherSelected
                                    ? "bg-slate-50 border-slate-100 text-slate-300 cursor-default"
                                    : getSeverityColor(avail?.severity ?? null, false)
                              }`}
                            >
                              {active ? (
                                <>
                                  <Check size={10} className="group-hover:hidden" />
                                  <span className="hidden group-hover:inline text-xs">✕</span>
                                </>
                              ) : (
                                getSeverityIcon(avail?.severity ?? null)
                              )}
                              {slot}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {!isBlocked && selectionMode === "range" && (
                      <div className="px-2 pt-2 pb-2 space-y-2">
                        {(() => {
                          const existingRange = (() => {
                            const k = makeKey(date, "RANGE");
                            const val = selectedSlots[k];
                            if (!val || !val.includes("-")) return null;
                            const [s, e] = val.split("-");
                            return { start: s, end: e };
                          })();
                          const localRange =
                            dateRanges[date] || existingRange || {
                              start: isRangeOnly ? "00:00" : "06:00",
                              end: isRangeOnly ? "23:59" : "22:00",
                            };
                          const [sh, sm] = localRange.start.split(":").map(Number);
                          const [eh, em] = localRange.end.split(":").map(Number);
                          const durationMin = eh * 60 + em - (sh * 60 + sm);
                          const isValid = durationMin > 0;

                          return (
                            <>
                              <div className="space-y-1">
                                <label className="text-[10px] font-semibold text-slate-500 uppercase">Desde</label>
                                <input
                                  type="time"
                                  value={localRange.start}
                                  onChange={(e) =>
                                    setDateRanges((prev) => ({ ...prev, [date]: { ...localRange, start: e.target.value } }))
                                  }
                                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs outline-none focus:border-brand-500"
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-[10px] font-semibold text-slate-500 uppercase">Hasta</label>
                                <input
                                  type="time"
                                  value={localRange.end}
                                  onChange={(e) =>
                                    setDateRanges((prev) => ({ ...prev, [date]: { ...localRange, end: e.target.value } }))
                                  }
                                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs outline-none focus:border-brand-500"
                                />
                              </div>
                              {isValid && (
                                <p className="text-[10px] text-slate-400 text-center">
                                  {Math.floor(durationMin / 60)}h {durationMin % 60 > 0 ? `${durationMin % 60}m` : ""}
                                </p>
                              )}
                              <div className="flex gap-1">
                                {isRangeSet(date) ? (
                                  <button
                                    onClick={() => clearDate(date)}
                                    className="w-full py-1.5 rounded-lg text-xs font-medium border border-red-200 text-red-600 bg-red-50 hover:bg-red-100 transition-all"
                                  >
                                    Quitar
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => {
                                      setDateRanges((prev) => ({ ...prev, [date]: localRange }));
                                      applyRange(date);
                                    }}
                                    disabled={!isValid}
                                    className={`w-full py-1.5 rounded-lg text-xs font-bold border transition-all flex items-center justify-center gap-1 ${
                                      isValid
                                        ? "bg-brand-500 text-white border-brand-500 hover:bg-brand-600"
                                        : "bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed"
                                    }`}
                                  >
                                    <Check size={11} /> Aplicar
                                  </button>
                                )}
                              </div>
                              {isRangeSet(date) && existingRange && (
                                <div className="bg-brand-50 rounded-lg py-1.5 px-2 text-center">
                                  <span className="text-xs font-bold text-brand-600">{existingRange.start}</span>
                                  <ArrowRight size={10} className="inline mx-1 text-brand-600" />
                                  <span className="text-xs font-bold text-brand-600">{existingRange.end}</span>
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                );
              })}
              </div>
            </div>

            {availableDates.length > 7 && (
              <p className="text-xs text-slate-400 text-center mt-4">
                Mostrando primeros 7 días. Ajusta el rango de fechas para ver más.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}