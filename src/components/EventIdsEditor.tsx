import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";

export interface EventIdEntry {
  label: string;
  value: string;
}

/**
 * Normalizes whatever the DB returned into a clean entry list.
 * Tolerates the legacy single `event_id` string and malformed rows.
 */
export function parseEventIds(raw: unknown, legacy?: string | null): EventIdEntry[] {
  const list = Array.isArray(raw)
    ? raw
        .map((e) => {
          const o = (e ?? {}) as { label?: unknown; value?: unknown };
          return { label: String(o.label ?? ""), value: String(o.value ?? "") };
        })
        .filter((e) => e.label !== "" || e.value !== "")
    : [];
  if (list.length > 0) return list;
  const fallback = (legacy ?? "").trim();
  return fallback ? [{ label: "Event ID", value: fallback }] : [];
}

/**
 * One Event ID per comm type, plus a "+" to add extra ones.
 *
 * When a campaign has no saved entries yet, the rows are seeded from its
 * comm types (Pope / Ad Placement) so a campaign that mixes both gets a
 * separate field for each. Saves the whole list on blur.
 */
export function EventIdsEditor({
  value,
  types,
  onSave,
  compact = false,
}: {
  value: EventIdEntry[];
  /** Campaign comm types, used to seed one field per type. */
  types: string[];
  onSave: (entries: EventIdEntry[]) => Promise<void>;
  compact?: boolean;
}) {
  const seed = (): EventIdEntry[] => {
    if (value.length > 0) return value;
    if (types.length > 0) return types.map((t) => ({ label: t, value: "" }));
    return [{ label: "Event ID", value: "" }];
  };

  const [rows, setRows] = useState<EventIdEntry[]>(seed);
  const [saving, setSaving] = useState(false);

  // Reflect external refreshes while not mid-edit.
  useEffect(() => {
    if (value.length > 0) setRows(value);
  }, [value]);

  function update(i: number, patch: Partial<EventIdEntry>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  async function commit(next?: EventIdEntry[]) {
    const list = (next ?? rows)
      .map((r) => ({ label: r.label.trim(), value: r.value.trim() }))
      .filter((r) => r.label !== "" || r.value !== "");
    // Nothing meaningful changed — skip the round trip.
    if (JSON.stringify(list) === JSON.stringify(value)) return;
    setSaving(true);
    try {
      await onSave(list);
    } catch (e: unknown) {
      const msg =
        typeof e === "object" && e !== null && "message" in e
          ? String((e as { message: unknown }).message)
          : "Error guardando Event ID";
      alert(msg);
      setRows(seed());
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={compact ? "space-y-1" : "space-y-1.5"}>
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input
            type="text"
            value={row.label}
            disabled={saving}
            onChange={(e) => update(i, { label: e.target.value })}
            onBlur={() => commit()}
            placeholder="Tipo"
            title="Etiqueta (ej. Pope, Ad Placement)"
            className={`rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-600 focus:border-brand-400 focus:outline-none disabled:opacity-50 ${
              compact ? "w-20" : "w-28"
            }`}
          />
          <input
            type="text"
            value={row.value}
            disabled={saving}
            onChange={(e) => update(i, { value: e.target.value })}
            onBlur={() => commit()}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            placeholder="Event ID"
            className={`rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 focus:border-brand-400 focus:outline-none disabled:opacity-50 ${
              compact ? "w-24" : "w-32"
            }`}
          />
          {rows.length > 1 && (
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                const next = rows.filter((_, idx) => idx !== i);
                setRows(next);
                commit(next);
              }}
              aria-label="Quitar Event ID"
              className="rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-red-600 disabled:opacity-50"
            >
              <X size={12} />
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        disabled={saving}
        onClick={() => setRows((prev) => [...prev, { label: "", value: "" }])}
        className="flex items-center gap-1 text-[11px] font-semibold text-brand-600 transition hover:text-brand-700 disabled:opacity-50"
      >
        <Plus size={12} /> Añadir Event ID
      </button>
    </div>
  );
}
