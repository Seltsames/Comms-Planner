import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import {
  ACTION_KEYS_BY_KIND,
  COMM_TYPES,
  TRIGGER_CHANNEL,
  CITIES_DATA,
  COUNTRIES,
  TEAMS_BY_KIND,
  type CommType,
} from "@/lib/constants";
import { TimeSlotPicker } from "@/components/TimeSlotPicker";
import { fetchCampaignSchedules, updateCampaignRpc } from "@/lib/queries";
import type { AudienceKind } from "@/lib/auth";
import type { AdminCampaignRow } from "@/lib/queries";

type SlotMap = Record<string, Record<string, string>>; // actionKey -> (key -> value)

// Reverse of buildSchedules: turn stored {action_key, schedule_date, time_slot}
// rows back into the TimeSlotPicker's `${date}|${slot}` selection map.
function schedulesToSlotMap(
  rows: Array<{ action_key: string; schedule_date: string; time_slot: string }>,
): SlotMap {
  const map: SlotMap = {};
  for (const r of rows) {
    const ch = (map[r.action_key] ??= {});
    const ts = r.time_slot;
    if (ts === "TRIGGER") {
      ch[r.schedule_date] = "TRIGGER";
    } else if (ts === "FULL_DAY" || ts === "07:00-22:00" || ts === "06:00-22:00") {
      ch[`${r.schedule_date}|FULL_DAY`] = "FULL_DAY";
    } else if (ts.includes("-")) {
      ch[`${r.schedule_date}|RANGE`] = ts;
    } else {
      ch[`${r.schedule_date}|${ts}`] = ts;
    }
  }
  return map;
}

// Same transform as the builder's buildSchedules().
function slotMapToSchedules(map: SlotMap) {
  const out: Array<{ action_key: string; schedule_date: string; time_slot: string }> = [];
  for (const [actionKey, slots] of Object.entries(map)) {
    for (const [key, timeVal] of Object.entries(slots)) {
      const [date, time] = key.includes("|") ? key.split("|") : [key, timeVal];
      const finalTime =
        time === "FULL_DAY" ? "07:00-22:00" : time === "RANGE" ? timeVal : time;
      out.push({ action_key: actionKey, schedule_date: date, time_slot: finalTime });
    }
  }
  return out;
}

export function CampaignEditModal({
  campaign,
  onClose,
  onSaved,
}: {
  campaign: AdminCampaignRow;
  onClose: () => void;
  onSaved: (newStatus: string) => void;
}) {
  const kind: AudienceKind = campaign.kind;
  const teams = TEAMS_BY_KIND[kind];

  const [name, setName] = useState(campaign.name);
  const [team, setTeam] = useState(campaign.team);
  const [subTeam, setSubTeam] = useState<string>(campaign.sub_team ?? "");
  const [types, setTypes] = useState<string[]>(campaign.types ?? []);
  const [actionKeys, setActionKeys] = useState<string[]>(campaign.action_keys ?? []);
  const [country, setCountry] = useState<string>(campaign.country);
  const [cityCodes, setCityCodes] = useState<string[]>(campaign.city_codes ?? []);
  const [startDate, setStartDate] = useState<string>(campaign.start_date);
  const [endDate, setEndDate] = useState<string>(campaign.end_date);
  const [slotMap, setSlotMap] = useState<SlotMap>({});
  const [citiesOpen, setCitiesOpen] = useState(false);
  const [loadingSchedules, setLoadingSchedules] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the campaign's existing schedules into the picker.
  useEffect(() => {
    let cancelled = false;
    // fetchCampaignSchedules returns every schedule for the platform; filter to
    // this campaign's own rows.
    fetchCampaignSchedules(kind)
      .then((rows) => {
        if (cancelled) return;
        setSlotMap(
          schedulesToSlotMap(
            (rows ?? [])
              .filter((r) => (r as { campaign_id?: string }).campaign_id === campaign.id)
              .map((r) => ({
                action_key: r.action_key,
                schedule_date: r.schedule_date,
                time_slot: r.time_slot,
              })),
          ),
        );
      })
      .catch(() => {
        if (!cancelled) setSlotMap({});
      })
      .finally(() => {
        if (!cancelled) setLoadingSchedules(false);
      });
    return () => {
      cancelled = true;
    };
  }, [campaign.id, kind]);

  const subTeams = useMemo(
    () => teams.find((t) => t.team === team)?.subTeams ?? [],
    [teams, team],
  );
  const availableActionKeys = useMemo(
    () => Array.from(new Set(types.flatMap((t) => ACTION_KEYS_BY_KIND[kind][t as CommType] ?? []))),
    [types, kind],
  );
  const countryCities = useMemo(
    () => CITIES_DATA.filter((c) => c.country === country),
    [country],
  );

  function toggleFrom(list: string[], setList: (v: string[]) => void, value: string) {
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  function toggleType(t: string) {
    const next = types.includes(t) ? types.filter((v) => v !== t) : [...types, t];
    setTypes(next);
    // Drop channels (and their slots) that no longer belong to a selected type.
    const allowed = new Set(next.flatMap((x) => ACTION_KEYS_BY_KIND[kind][x as CommType] ?? []));
    setActionKeys((prev) => prev.filter((k) => allowed.has(k)));
    setSlotMap((prev) => {
      const cleaned: SlotMap = {};
      for (const [k, v] of Object.entries(prev)) if (allowed.has(k)) cleaned[k] = v;
      return cleaned;
    });
  }

  function toggleChannel(k: string) {
    if (actionKeys.includes(k)) {
      setActionKeys(actionKeys.filter((x) => x !== k));
      setSlotMap((prev) => {
        const next = { ...prev };
        delete next[k];
        return next;
      });
    } else {
      setActionKeys([...actionKeys, k]);
    }
  }

  function toggleSlot(actionKey: string, date: string, slot: string) {
    setSlotMap((prev) => {
      const ch = { ...(prev[actionKey] ?? {}) };
      const key = `${date}|${slot}`;
      if (ch[key]) delete ch[key];
      else ch[key] = slot;
      return { ...prev, [actionKey]: ch };
    });
  }

  function setRange(actionKey: string, date: string, range: string | null) {
    setSlotMap((prev) => {
      const ch = { ...(prev[actionKey] ?? {}) };
      const key = `${date}|RANGE`;
      if (range === null) delete ch[key];
      else ch[key] = range;
      return { ...prev, [actionKey]: ch };
    });
  }

  const scheduleCount = Object.values(slotMap).reduce((n, s) => n + Object.keys(s).length, 0);

  async function handleSave() {
    setError(null);
    if (!name.trim()) return setError("El nombre no puede quedar vacío.");
    if (types.length === 0) return setError("Selecciona al menos un tipo.");
    if (actionKeys.length === 0) return setError("Selecciona al menos un canal.");
    if (cityCodes.length === 0) return setError("Selecciona al menos una ciudad.");
    if (new Date(endDate) < new Date(startDate)) return setError("La fecha final es anterior a la inicial.");
    if (scheduleCount === 0) return setError("La campaña necesita al menos un horario.");

    setSaving(true);
    try {
      const newStatus = await updateCampaignRpc(campaign.id, kind, {
        name: name.trim(),
        team,
        subTeam: subTeam || null,
        types,
        actionKeys,
        country,
        cityCodes,
        startDate,
        endDate,
        schedules: slotMapToSchedules(slotMap),
      });
      onSaved(newStatus);
    } catch (e: unknown) {
      const msg =
        typeof e === "object" && e !== null && "message" in e
          ? String((e as { message: unknown }).message)
          : "Error guardando la campaña";
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h3 className="font-bold text-slate-800">Editar campaña</h3>
            <p className="text-xs text-slate-500">
              El cohorte no se modifica. Al guardar se re-valida el estado.
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">Nombre</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500">País</label>
              <select
                value={country}
                onChange={(e) => {
                  setCountry(e.target.value);
                  setCityCodes([]); // cities are country-specific
                }}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
              >
                {COUNTRIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500">Equipo</label>
              <select
                value={team}
                onChange={(e) => {
                  setTeam(e.target.value);
                  setSubTeam("");
                }}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
              >
                {teams.map((t) => (
                  <option key={t.team} value={t.team}>{t.team}</option>
                ))}
              </select>
            </div>
            {subTeams.length > 0 && (
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-500">Sub-equipo</label>
                <select
                  value={subTeam}
                  onChange={(e) => setSubTeam(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
                >
                  <option value="">—</option>
                  {subTeams.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">Tipo</label>
            <div className="flex flex-wrap gap-2">
              {Object.values(COMM_TYPES).map((t) => (
                <button
                  key={t}
                  onClick={() => toggleType(t)}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                    types.includes(t)
                      ? "border-brand-500 bg-brand-500 text-white"
                      : "border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {availableActionKeys.length > 0 && (
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500">Canales</label>
              <div className="flex flex-wrap gap-2">
                {availableActionKeys.map((k) => (
                  <button
                    key={k}
                    onClick={() => toggleChannel(k)}
                    className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                      actionKeys.includes(k)
                        ? "border-brand-500 bg-brand-500 text-white"
                        : "border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {k}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500">Desde</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500">Hasta</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <button
              onClick={() => setCitiesOpen((v) => !v)}
              className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              <span className="font-semibold text-slate-500 text-xs uppercase">Ciudades</span>
              <span className="text-xs text-slate-500">{cityCodes.length} seleccionadas</span>
            </button>
            {citiesOpen && (
              <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-slate-200 p-2">
                {countryCities.map((c) => (
                  <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={cityCodes.includes(c.id)}
                      onChange={() => toggleFrom(cityCodes, setCityCodes, c.id)}
                    />
                    <span className="text-slate-700">{c.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="mb-2 block text-xs font-semibold text-slate-500">Horarios</label>
            {loadingSchedules ? (
              <p className="text-sm italic text-slate-400">Cargando horarios…</p>
            ) : actionKeys.length === 0 ? (
              <p className="text-sm italic text-slate-400">Selecciona un canal para editar horarios.</p>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {actionKeys.map((actionKey) => {
                  const isPope = types.includes(COMM_TYPES.POPE);
                  const isRangeOnly = ACTION_KEYS_BY_KIND[kind][COMM_TYPES.AD_PLACEMENT].includes(actionKey);
                  const isTriggerOnly = actionKey === TRIGGER_CHANNEL;
                  return (
                    <TimeSlotPicker
                      key={actionKey}
                      actionKey={actionKey}
                      country={country}
                      cityCodes={cityCodes}
                      startDate={startDate}
                      endDate={endDate}
                      selectedSlots={slotMap[actionKey] ?? {}}
                      onToggle={(date, slot) => toggleSlot(actionKey, date, slot)}
                      onRangeChange={(date, range) => setRange(actionKey, date, range)}
                      isPope={isPope}
                      isRangeOnly={isRangeOnly}
                      isTriggerOnly={isTriggerOnly}
                      blockedDates={new Set()}
                      // The campaign references its OWN audience; the availability
                      // RPC excludes it, so it never conflicts with itself.
                      cohortId={campaign.id}
                      kind={kind}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-slate-200 px-5 py-4">
          {error && (
            <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              onClick={onClose}
              disabled={saving}
              className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-500 hover:text-slate-700 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={saving || loadingSchedules}
              className="rounded-xl bg-brand-500 px-6 py-2 text-sm font-bold text-white hover:bg-brand-600 disabled:opacity-50"
            >
              {saving ? "Guardando…" : "Guardar cambios"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
