import { useEffect, useState } from "react";

/**
 * Inline auto-saving input for the campaign "Event ID" code. Commits on
 * blur (Enter blurs); reverts to the last saved value if the save fails.
 */
export function EventIdInput({
  value,
  onSave,
}: {
  value: string | null;
  onSave: (eventId: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(value ?? "");
  const [saving, setSaving] = useState(false);

  // Reflect external updates (e.g. auto-refresh) while not editing.
  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  async function commit() {
    const next = draft.trim();
    if (next === (value ?? "")) return;
    setSaving(true);
    try {
      await onSave(next);
    } catch (e: unknown) {
      alert("Error guardando Event ID: " + (e as Error).message);
      setDraft(value ?? "");
    } finally {
      setSaving(false);
    }
  }

  return (
    <input
      type="text"
      value={draft}
      disabled={saving}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      placeholder="Event ID"
      className="w-28 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 focus:border-brand-400 focus:outline-none disabled:opacity-50"
    />
  );
}
