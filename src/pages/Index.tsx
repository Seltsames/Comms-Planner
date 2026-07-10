import { useEffect, useMemo, useRef, useState } from "react";
import { Card, PageHeader } from "@/components/Ui";
import {
  ACTION_KEYS_BY_KIND,
  COMM_TYPES,
  CITIES_DATA,
  COUNTRIES,
  TEAMS_BY_KIND,
  type CommType,
  type Country,
} from "@/lib/constants";
import {
  CohortUploader,
  computeEffectiveDrvIds,
  type CohortState,
} from "@/features/cohorts/CohortUploader";
import { CohortConflictPreview } from "@/features/cohorts/CohortConflictPreview";
import { saveCampaignRpc, fetchCampaignById } from "@/lib/queries";
import { TimeSlotPicker } from "@/components/TimeSlotPicker";
import { ScheduledCommsPreview, type ScheduledComm } from "@/components/ScheduledCommsPreview";
import { SaveSuccessModal } from "@/components/SaveSuccessModal";
import { ConflictsSummary, type ChannelConflicts } from "@/components/ConflictsSummary";
import DashboardView from "@/components/DashboardView";
import { useAuth } from "@/lib/auth";
import { useCampaignBuilder } from "@/lib/campaignBuilder";

function extractUsername(email: string) {
  if (!email) return "";
  const at = email.indexOf("@");
  return at > 0 ? email.slice(0, at) : email;
}

export default function Index() {
  const { user } = useAuth();
  const { kind, state, setState, reset, scheduledComms, setScheduledComms } = useCampaignBuilder();

  const [saveLoading, setSaveLoading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [savedCampaign, setSavedCampaign] = useState<{
    id: string;
    status: string;
    name: string;
  } | null>(null);

  const [citiesOpen, setCitiesOpen] = useState(false);
  const [cityChipsOpen, setCityChipsOpen] = useState(false);
  const [citySearch, setCitySearch] = useState("");
  const citiesRef = useRef<HTMLDivElement>(null);

  const [channelConflicts, setChannelConflicts] = useState<Record<string, ChannelConflicts>>({});

  const {
    name, team, subTeam, country, types, cityCodes, isRange,
    startDate, endDate, cohort, actionKeys, slotSelection, step, activeTab,
  } = state;

  useEffect(() => {
    if (!citiesOpen) return;
    function onDocClick(e: MouseEvent) {
      if (citiesRef.current && !citiesRef.current.contains(e.target as Node)) {
        setCitiesOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [citiesOpen]);

  const teamsForKind = TEAMS_BY_KIND[kind];
  const subTeams = useMemo(
    () => teamsForKind.find((t) => t.team === team)?.subTeams ?? [],
    [teamsForKind, team],
  );

  const availableActionKeys = useMemo(
    () => Array.from(new Set(types.flatMap((t) => ACTION_KEYS_BY_KIND[kind][t] ?? []))),
    [types, kind],
  );

  const effectiveDrvIds = useMemo(
    () => computeEffectiveDrvIds(cohort, cityCodes),
    [cohort, cityCodes],
  );

  const nomenclature = useMemo(() => {
    const parts = [kind === "pax" ? "PAX MKT" : "DRV MKT"];
    if (country) parts.push(country);
    if (team) parts.push(team);
    if (subTeam) parts.push(subTeam);
    if (name) parts.push(name);
    // Auto-generated names: uppercase, spaces → underscores, collapsed.
    return parts
      .join("_")
      .toUpperCase()
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_");
  }, [kind, country, team, subTeam, name]);

  const countryCities = useMemo(
    () => CITIES_DATA.filter((c) => c.country === country),
    [country],
  );
  const filteredCities = useMemo(() => {
    const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    return countryCities.filter((c) => norm(c.name).includes(norm(citySearch)));
  }, [countryCities, citySearch]);
  const allCountryCitiesSelected =
    countryCities.length > 0 && countryCities.every((c) => cityCodes.includes(c.id));

  const { canProceed, missingFields } = useMemo(() => {
    const missing: string[] = [];
    if (!name.trim()) missing.push("Nombre de campaña");
    if (subTeams.length > 0 && !subTeam) missing.push("Sub-equipo");
    if (types.length === 0) missing.push("Tipo");
    if (cityCodes.length === 0) missing.push("Ciudades");
    if (isRange && endDate && new Date(endDate) < new Date(startDate)) {
      missing.push("Rango de fechas inválido");
    }
    if (effectiveDrvIds.length === 0) {
      missing.push(
        cohort.general || Object.keys(cohort.byCity).length > 0
          ? "Cohorte (ciudades sin archivo)"
          : "Cohorte (subir CSV)",
      );
    }
    return { canProceed: missing.length === 0, missingFields: missing };
  }, [name, subTeam, subTeams.length, types.length, cityCodes.length, isRange, startDate, endDate, effectiveDrvIds.length, cohort]);

  // ------------------------------------------------------------------------
  // Mutators (kept inside Index.tsx so they update the context state slice)
  // ------------------------------------------------------------------------
  const setName = (v: string) => setState((s) => ({ ...s, name: v }));
  const setTeam = (newTeam: string) =>
    setState((s) => ({ ...s, team: newTeam, subTeam: "" }));
  const setSubTeam = (v: string) => setState((s) => ({ ...s, subTeam: v }));
  const setCountry = (newCountry: Country) =>
    setState((s) => ({ ...s, country: newCountry, cityCodes: [], cohort: { general: null, byCity: {} } }));
  const setStartDate = (v: string) => setState((s) => ({ ...s, startDate: v }));
  const setEndDate = (v: string) => setState((s) => ({ ...s, endDate: v }));
  const setIsRange = (v: boolean) => setState((s) => ({ ...s, isRange: v }));
  const setCohort = (v: CohortState) => setState((s) => ({ ...s, cohort: v }));
  const setActionKeys = (v: string[] | ((prev: string[]) => string[])) =>
    setState((s) => ({ ...s, actionKeys: typeof v === "function" ? v(s.actionKeys) : v }));
  const setSlotSelection = (
    v: Record<string, Record<string, string>> | ((prev: Record<string, Record<string, string>>) => Record<string, Record<string, string>>),
  ) => setState((s) => ({ ...s, slotSelection: typeof v === "function" ? v(s.slotSelection) : v }));
  const setStep = (v: 1 | 2) => setState((s) => ({ ...s, step: v }));
  const setActiveTab = (v: "builder" | "dashboard") => setState((s) => ({ ...s, activeTab: v }));

  function toggleType(value: CommType) {
    setState((s) => {
      if (s.types.includes(value)) {
        if (s.types.length === 1) return s;
        return { ...s, types: s.types.filter((t) => t !== value) };
      }
      return { ...s, types: [...s.types, value] };
    });
  }
  function isTypeLocked(value: CommType) {
    return types.includes(value) && types.length === 1;
  }
  function toggleActionKey(key: string) {
    setActionKeys((prev) => {
      if (prev.includes(key)) {
        setSlotSelection((sel) => {
          const next = { ...sel };
          delete next[key];
          return next;
        });
        return prev.filter((k) => k !== key);
      }
      return [...prev, key];
    });
  }
  function toggleCity(cityId: string) {
    setState((s) => ({
      ...s,
      cityCodes: s.cityCodes.includes(cityId)
        ? s.cityCodes.filter((c) => c !== cityId)
        : [...s.cityCodes, cityId],
    }));
  }
  function handleAllCities() {
    if (allCountryCitiesSelected) {
      const countryIds = new Set(countryCities.map((c) => c.id));
      setState((s) => ({ ...s, cityCodes: s.cityCodes.filter((id) => !countryIds.has(id)) }));
    } else {
      const merged = new Set([...cityCodes, ...countryCities.map((c) => c.id)]);
      setState((s) => ({ ...s, cityCodes: Array.from(merged) }));
    }
  }

  function buildAudience() {
    const audience: Array<{ id: string; city_code: string | null }> = [];
    for (const code of cityCodes) {
      const perCity = cohort.byCity[code];
      const source = perCity ?? cohort.general;
      if (!source) continue;
      for (const drvId of source.validIds) {
        audience.push({ id: drvId, city_code: perCity ? code : null });
      }
    }
    return audience;
  }

  function buildSchedules() {
    const schedules: Array<{ action_key: string; schedule_date: string; time_slot: string }> = [];
    for (const [actionKey, slots] of Object.entries(slotSelection)) {
      for (const [key, timeVal] of Object.entries(slots)) {
        const [date, time] = key.includes("|") ? key.split("|") : [key, timeVal];
        const finalTime = time === "FULL_DAY" ? "07:00-22:00" : time === "RANGE" ? (timeVal as string) : time;
        schedules.push({ action_key: actionKey, schedule_date: date, time_slot: finalTime });
      }
    }
    return schedules;
  }

  function setRangeForChannel(actionKey: string, date: string, range: string | null) {
    setSlotSelection((prev) => {
      const channelSlots = { ...(prev[actionKey] ?? {}) };
      const key = `${date}|RANGE`;
      if (range === null) {
        delete channelSlots[key];
      } else {
        channelSlots[key] = range;
      }
      return { ...prev, [actionKey]: channelSlots };
    });
  }

  function toggleSlotForChannel(actionKey: string, date: string, slot: string) {
    setSlotSelection((prev) => {
      const channelSlots = prev[actionKey] ?? {};
      const key = `${date}|${slot}`;
      const next = { ...prev, [actionKey]: { ...channelSlots } };
      if (channelSlots[key]) {
        delete next[actionKey][key];
      } else {
        next[actionKey][key] = slot;
      }
      return next;
    });
  }

  // Recompute scheduledComms preview whenever slotSelection changes. Stored
  // in the context so it survives navigation away from the builder.
  useEffect(() => {
    const items: ScheduledComm[] = [];
    for (const [actionKey, slots] of Object.entries(slotSelection)) {
      for (const [key, timeVal] of Object.entries(slots)) {
        const [date, time] = key.split("|");
        const finalTime = time === "FULL_DAY" ? "07:00-22:00" : time === "RANGE" ? (timeVal as string) : time;
        items.push({
          id: `${actionKey}|${date}|${time}`,
          name: nomenclature,
          actionKey,
          date,
          time: finalTime,
          types,
          drvCount: effectiveDrvIds.length,
          country,
        });
      }
    }
    items.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
    setScheduledComms(items);
  }, [slotSelection, nomenclature, types, effectiveDrvIds.length, country, setScheduledComms]);

  async function handleSave() {
    if (!user?.id) return;
    setSaveLoading(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const campaignId = await saveCampaignRpc(
        {
          name,
          team,
          subTeam,
          types,
          actionKeys,
          country,
          cityCodes,
          csvFileName: `cohort_${nomenclature}.csv`,
          startDate,
          endDate: isRange ? endDate : startDate,
          status: "pending",
          schedules: buildSchedules(),
          audience: buildAudience(),
        },
        kind,
      );
      const saved = await fetchCampaignById(campaignId, kind);
      if (saved) {
        setSavedCampaign({ id: saved.id, status: saved.status, name: saved.name });
      }
      setSaveSuccess(true);
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : "Error guardando campaña");
    } finally {
      setSaveLoading(false);
    }
  }

  function resetBuilder() {
    reset();
    setChannelConflicts({});
    setSaveError(null);
    setSaveSuccess(false);
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <PageHeader
        title={`Planificar comunicación · ${kind === "pax" ? "Pasajeros" : "Conductores"}`}
        subtitle={`Bienvenido, ${user?.fullName ?? "—"} · Define, programa y revisa conflictos`}
        action={
          <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 text-sm shadow-sm">
            <button
              onClick={() => setActiveTab("builder")}
              className={`rounded-lg px-4 py-1.5 font-semibold transition ${
                activeTab === "builder" ? "bg-brand-500 text-white" : "text-slate-600"
              }`}
            >
              Builder
            </button>
            <button
              onClick={() => setActiveTab("dashboard")}
              className={`rounded-lg px-4 py-1.5 font-semibold transition ${
                activeTab === "dashboard" ? "bg-brand-500 text-white" : "text-slate-600"
              }`}
            >
              Dashboard
            </button>
          </div>
        }
      />

      {activeTab === "builder" ? (
        <div className="space-y-6 pb-32">
          <Stepper step={step} />

          {step === 1 ? (
            <Card
              title="Configurar campaña"
              subtitle={`Define el público objetivo y carga los cohortes (${kind === "pax" ? "pasajeros" : "conductores"})`}
            >
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                {/* PAX: Usuario + Equipo share one row (flat team list).
                    DRV: Usuario full-width, then Equipo + Sub-equipo row. */}
                <Field label="Usuario" full={kind !== "pax"}>
                  <div className={inputClass + " cursor-default"}>
                    {extractUsername(user?.email ?? "") || "Sin usuario"}
                  </div>
                </Field>

                <Field label="Equipo" full={kind !== "pax" && subTeams.length === 0}>
                  <select
                    value={team}
                    onChange={(e) => setTeam(e.target.value)}
                    className={inputClass}
                  >
                    {teamsForKind.map((t) => (
                      <option key={t.team} value={t.team}>{t.team}</option>
                    ))}
                  </select>
                </Field>

                {/* PAX has a flat team list — hide the sub-team field entirely. */}
                {subTeams.length > 0 && (
                  <Field label="Sub-equipo">
                    <select
                      value={subTeam}
                      onChange={(e) => setSubTeam(e.target.value)}
                      className={inputClass}
                    >
                      <option value="">Seleccionar sub-equipo</option>
                      {subTeams.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </Field>
                )}

                <Field label="Nombre de campaña" full>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ej. Retención semanal"
                    className={inputClass}
                  />
                </Field>

                <Field label="País" full>
                  <select
                    value={country}
                    onChange={(e) => setCountry(e.target.value as Country)}
                    className={inputClass}
                  >
                    {COUNTRIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </Field>

                <Field label={`Ciudades (${cityCodes.length} seleccionadas)`} full>
                  <div ref={citiesRef} className="relative">
                    <button
                      type="button"
                      onClick={() => setCitiesOpen((v) => !v)}
                      className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-700 transition hover:border-brand-300"
                    >
                      <span className={cityCodes.length > 0 ? "" : "text-slate-500"}>
                        {cityCodes.length > 0
                          ? `${cityCodes.length} ciudad${cityCodes.length > 1 ? "es" : ""} seleccionada${
                              cityCodes.length > 1 ? "s" : ""
                            }`
                          : "Seleccionar ciudades"}
                      </span>
                      <span
                        className={`text-slate-400 transition-transform ${
                          citiesOpen ? "rotate-90" : ""
                        }`}
                      >
                        ▶
                      </span>
                    </button>
                    {citiesOpen && (
                      <div className="absolute z-30 mt-1 w-full space-y-2 rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={handleAllCities}
                            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                              allCountryCitiesSelected
                                ? "border-brand-500 bg-brand-500 text-white"
                                : "border-slate-200 bg-slate-50 text-slate-600 hover:border-brand-300"
                            }`}
                          >
                            ★ Todas ({country}) {allCountryCitiesSelected && "✓"}
                          </button>
                          {cityCodes.length > 0 && (
                            <button
                              type="button"
                              onClick={() => setState((s) => ({ ...s, cityCodes: [] }))}
                              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-500 transition hover:border-red-300 hover:text-red-600"
                            >
                              Limpiar
                            </button>
                          )}
                        </div>
                        <input
                          type="text"
                          placeholder="Buscar ciudad..."
                          value={citySearch}
                          onChange={(e) => setCitySearch(e.target.value)}
                          className={inputClass}
                          autoFocus
                        />
                        <div className="max-h-52 space-y-0.5 overflow-y-auto">
                          {filteredCities.map((city) => {
                            const selected = cityCodes.includes(city.id);
                            return (
                              <button
                                key={city.id}
                                type="button"
                                onClick={() => toggleCity(city.id)}
                                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-medium transition ${
                                  selected
                                    ? "bg-brand-50 text-brand-600"
                                    : "text-slate-600 hover:bg-slate-50"
                                }`}
                              >
                                <span>{city.name}</span>
                                {selected && <span className="text-brand-500">✓</span>}
                              </button>
                            );
                          })}
                          {filteredCities.length === 0 && (
                            <p className="py-3 text-center text-xs text-slate-500">
                              No se encontraron ciudades
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  {cityCodes.length > 0 && (
                    <div className="mt-2">
                      <button
                        type="button"
                        onClick={() => setCityChipsOpen((v) => !v)}
                        className="flex items-center gap-1.5 text-xs font-semibold text-brand-600 transition hover:text-brand-700"
                      >
                        <span
                          className={`inline-block text-[10px] transition-transform ${
                            cityChipsOpen ? "rotate-90" : ""
                          }`}
                        >
                          ▶
                        </span>
                        {cityChipsOpen ? "Ocultar ciudades" : "Ver ciudades seleccionadas"} (
                        {cityCodes.length})
                      </button>
                      {cityChipsOpen && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {cityCodes.map((code) => {
                            const city = CITIES_DATA.find((c) => c.id === code);
                            return (
                              <span
                                key={code}
                                className="inline-flex items-center gap-1 rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700"
                              >
                                {city?.name ?? code}
                                <button
                                  type="button"
                                  onClick={() => toggleCity(code)}
                                  className="flex h-4 w-4 items-center justify-center rounded-full text-brand-500 transition hover:bg-brand-100 hover:text-brand-700"
                                  aria-label={`Quitar ${city?.name ?? code}`}
                                >
                                  ×
                                </button>
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </Field>

                <Field label="Nomenclatura (auto-generada)" full>
                  <div className="rounded-lg border border-brand-500/30 bg-brand-50 px-4 py-2.5 font-mono text-sm tracking-wide text-slate-900">
                    {nomenclature}
                  </div>
                </Field>

                <Field label="Rango de fechas" full>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-sm font-medium text-slate-700">Fechas</span>
                      <label className="flex items-center gap-2 text-xs text-slate-500">
                        <input
                          type="checkbox"
                          checked={isRange}
                          onChange={(e) => setIsRange(e.target.checked)}
                          className="h-4 w-4 accent-brand-500"
                        />
                        Habilitar rango (max 30 días)
                      </label>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex-1">
                        <span className="mb-1 block text-xs text-slate-500">Inicio</span>
                        <input
                          type="date"
                          value={startDate}
                          onChange={(e) => setStartDate(e.target.value)}
                          className={inputClass + " bg-white"}
                        />
                      </div>
                      {isRange && (
                        <>
                          <span className="pt-5 text-slate-400">→</span>
                          <div className="flex-1">
                            <span className="mb-1 block text-xs text-slate-500">Fin</span>
                            <input
                              type="date"
                              value={endDate}
                              onChange={(e) => setEndDate(e.target.value)}
                              className={inputClass + " bg-white"}
                            />
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </Field>

                <Field label="Tipo" full>
                  <div className="flex flex-wrap gap-2">
                    {Object.values(COMM_TYPES).map((t) => {
                      const active = types.includes(t);
                      const locked = isTypeLocked(t);
                      return (
                        <button
                          key={t}
                          type="button"
                          onClick={() => toggleType(t)}
                          title={locked ? "Al menos un tipo es obligatorio" : undefined}
                          className={`rounded-lg border px-5 py-2.5 text-sm font-semibold transition ${
                            active
                              ? "border-brand-500 bg-brand-500 text-white shadow-sm"
                              : "border-slate-200 bg-white text-slate-600 hover:border-brand-300"
                          } ${locked ? "cursor-not-allowed opacity-90" : ""}`}
                        >
                          {t} {active && "✓"}
                        </button>
                      );
                    })}
                  </div>
                </Field>

                <Field label={`Cohortes (${kind === "pax" ? "PAX" : "DRV"} IDs)`} full>
                  <CohortUploader
                    country={country}
                    selectedCityCodes={cityCodes}
                    value={cohort}
                    onChange={setCohort}
                    kind={kind}
                  />
                </Field>
              </div>

              {effectiveDrvIds.length > 0 && (
                <div className="mt-4">
                  <CohortConflictPreview
                    drvIds={effectiveDrvIds}
                    country={country}
                    startDate={startDate}
                    endDate={isRange ? endDate : startDate}
                    kind={kind}
                  />
                </div>
              )}

              <div className="mt-8 flex justify-end">
                <button
                  onClick={() => setStep(2)}
                  disabled={!canProceed}
                  className="rounded-xl bg-brand-500 px-8 py-3 text-sm font-bold text-white transition hover:bg-brand-600 disabled:opacity-50"
                >
                  Analizar cohortes y continuar →
                </button>
              </div>
              {missingFields.length > 0 && (
                <p className="mt-2 text-right text-xs text-slate-500">
                  Pendiente: {missingFields.join(" · ")}
                </p>
              )}
            </Card>
          ) : (
            <Card
              title="Canales y horarios"
              subtitle="Selecciona los canales y los slots disponibles según el análisis de cohortes"
            >
              <Field label="Canales disponibles">
                <div className="flex flex-wrap gap-2">
                  {availableActionKeys.map((key) => {
                    const active = actionKeys.includes(key);
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => toggleActionKey(key)}
                        className={`rounded-xl border px-4 py-2.5 text-sm font-semibold transition ${
                          active
                            ? "border-sky-500 bg-sky-500 text-white shadow-sm"
                            : "border-slate-200 bg-white text-slate-600 hover:border-sky-300"
                        }`}
                      >
                        {key} {active && "✓"}
                      </button>
                    );
                  })}
                </div>
              </Field>

              {actionKeys.length === 0 ? (
                <p className="mt-4 text-sm text-slate-500 italic">
                  Selecciona al menos un canal para ver la disponibilidad.
                </p>
              ) : (
                <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {actionKeys.map((actionKey) => {
                    const isPope = types.includes(COMM_TYPES.POPE);
                    // Every Ad Placement channel schedules by free time range
                    // (desde–hasta) instead of hourly slots.
                    const isRangeOnly =
                      ACTION_KEYS_BY_KIND[kind][COMM_TYPES.AD_PLACEMENT].includes(actionKey);

                    const conflictingKey = actionKey === "Push out" ? "Whatsapp" : actionKey === "Whatsapp" ? "Push out" : null;
                    const blockedDates = new Set<string>();
                    if (conflictingKey && actionKeys.includes(conflictingKey)) {
                      const conflictingSlots = slotSelection[conflictingKey] ?? {};
                      Object.keys(conflictingSlots).forEach((k) => {
                        const date = k.split("|")[0];
                        blockedDates.add(date);
                      });
                    }

                    return (
                      <TimeSlotPicker
                        key={actionKey}
                        actionKey={actionKey}
                        country={country}
                        cityCodes={cityCodes}
                        startDate={startDate}
                        endDate={isRange ? endDate : startDate}
                        selectedSlots={slotSelection[actionKey] ?? {}}
                        onToggle={(date, slot) => toggleSlotForChannel(actionKey, date, slot)}
                        onRangeChange={(date, range) => setRangeForChannel(actionKey, date, range)}
                        isPope={isPope}
                        isRangeOnly={isRangeOnly}
                        blockedDates={blockedDates}
                        audienceIds={effectiveDrvIds}
                        kind={kind}
                        onConflictsChange={(conflicts, counts) => {
                          setChannelConflicts((prev) => ({
                            ...prev,
                            [actionKey]: {
                              conflicts,
                              atRiskCount: counts?.atRiskCount ?? 0,
                              lockedCount: counts?.lockedCount ?? 0,
                            },
                          }));
                        }}
                      />
                    );
                  })}
                </div>
              )}

              <ConflictsSummary channelConflicts={channelConflicts} />

              <div className="mt-6">
                <ScheduledCommsPreview items={scheduledComms} />
              </div>

              {saveError && (
                <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
                  {saveError}
                </p>
              )}
              {saveSuccess && (
                <p className="mt-3 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700 font-semibold">
                  ✓ Campaña guardada correctamente
                </p>
              )}

              <div className="mt-6 flex justify-between">
                <button
                  onClick={() => {
                    setStep(1);
                    setSaveError(null);
                    setSaveSuccess(false);
                  }}
                  className="text-sm font-semibold text-slate-500 hover:text-slate-700"
                >
                  ← Volver al paso 1
                </button>
                <button
                  onClick={handleSave}
                  disabled={saveLoading || actionKeys.length === 0 || scheduledComms.length === 0}
                  className="rounded-xl bg-brand-500 px-8 py-3 text-sm font-bold text-white transition hover:bg-brand-600 disabled:opacity-50"
                >
                  {saveLoading ? "Guardando…" : "Guardar campaña"}
                </button>
              </div>
            </Card>
          )}
        </div>
      ) : (
        <DashboardView kind={kind} />
      )}

      {savedCampaign && (
        <SaveSuccessModal
          campaignId={savedCampaign.id}
          campaignStatus={savedCampaign.status}
          campaignName={savedCampaign.name}
          scheduledComms={scheduledComms}
          onClose={() => {
            setSavedCampaign(null);
            resetBuilder();
            setTimeout(() => setSaveSuccess(false), 4000);
          }}
        />
      )}
    </div>
  );
}

function Stepper({ step }: { step: 1 | 2 }) {
  return (
    <div className="flex items-center gap-2 text-sm font-semibold">
      <span
        className={`flex h-7 w-7 items-center justify-center rounded-full ${
          step === 1 ? "bg-brand-500 text-white" : "bg-slate-200 text-slate-600"
        }`}
      >
        1
      </span>
      <span className={step === 1 ? "text-brand-600" : "text-slate-500"}>
        Campaña y cohortes
      </span>
      <span className="text-slate-300">›</span>
      <span
        className={`flex h-7 w-7 items-center justify-center rounded-full ${
          step === 2 ? "bg-brand-500 text-white" : "bg-slate-200 text-slate-600"
        }`}
      >
        2
      </span>
      <span className={step === 2 ? "text-brand-600" : "text-slate-500"}>
        Canales y horarios
      </span>
    </div>
  );
}

const inputClass =
  "w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30";

function Field({
  label,
  children,
  full,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <label className={`block ${full ? "md:col-span-2" : ""}`}>
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}