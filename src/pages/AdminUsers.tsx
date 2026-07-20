import { useCallback, useEffect, useState } from "react";
import { Card, PageHeader } from "@/components/Ui";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

type Platform = "drv" | "pax";
const PLATFORMS: readonly Platform[] = ["drv", "pax"] as const;
const PLATFORM_LABELS: Record<Platform, string> = { drv: "DRV", pax: "PAX" };

interface AdminUserRow {
  user_id: string;
  email: string;
  full_name: string | null;
  is_enabled: boolean;
  enabled_at: string | null;
  created_at: string;
  role: "admin" | "normal" | null;
  platform_access: Platform[];
}

type ActionResult = { ok: true } | { ok: false; error: string };

export default function AdminUsers() {
  const { refreshUser } = useAuth();
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // User whose "Habilitar" button is showing the platform picker.
  const [enablePickerFor, setEnablePickerFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    // Fetch all profiles (admin can read all). Falls back to the legacy
    // column set when migration 00030 (platform_access) is not applied yet.
    let { data: profiles, error: pErr } = await supabase
      .from("profiles")
      .select("user_id, email, full_name, is_enabled, enabled_at, created_at, platform_access")
      .order("created_at", { ascending: false });

    if (pErr) {
      const retry = await supabase
        .from("profiles")
        .select("user_id, email, full_name, is_enabled, enabled_at, created_at")
        .order("created_at", { ascending: false });
      profiles = (retry.data ?? null) as typeof profiles;
      pErr = retry.error;
    }

    if (pErr) {
      setError(pErr.message);
      setLoading(false);
      return;
    }

    // Fetch all roles
    const { data: roles, error: rErr } = await supabase
      .from("user_roles")
      .select("user_id, role");

    if (rErr) {
      setError(rErr.message);
      setLoading(false);
      return;
    }

    const roleByUser = new Map<string, "admin" | "normal">();
    for (const r of roles ?? []) {
      roleByUser.set(r.user_id, r.role as "admin" | "normal");
    }

    const rows: AdminUserRow[] = (profiles ?? []).map((p) => {
      const rawAccess = (p as { platform_access?: unknown }).platform_access;
      return {
        user_id: p.user_id,
        email: p.email,
        full_name: p.full_name,
        is_enabled: p.is_enabled,
        enabled_at: p.enabled_at,
        created_at: p.created_at,
        role: roleByUser.get(p.user_id) ?? null,
        platform_access: Array.isArray(rawAccess)
          ? PLATFORMS.filter((k) => rawAccess.includes(k))
          : [...PLATFORMS],
      };
    });

    setUsers(rows);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function callAdminFn(
    action: "enable" | "disable" | "grant_admin" | "revoke_admin" | "set_platform_access",
    targetUserId: string,
    platforms?: Platform[],
  ): Promise<ActionResult> {
    const { data, error: fnErr } = await supabase.functions.invoke<{
      success: boolean;
      error?: string;
    }>("admin-users", {
      body: { action, targetUserId, ...(platforms ? { platforms } : {}) },
    });

    if (fnErr) {
      return { ok: false, error: fnErr.message };
    }
    if (data && data.error) {
      return { ok: false, error: data.error };
    }
    return { ok: true };
  }

  async function toggleEnabled(u: AdminUserRow) {
    setBusyId(u.user_id);
    setError(null);
    const action = u.is_enabled ? "disable" : "enable";
    const res = await callAdminFn(action, u.user_id);
    if (!res.ok) setError(res.error);
    await load();
    await refreshUser();
    setBusyId(null);
  }

  /**
   * Enable a new user with the platform access the admin picked (Driver,
   * PAX or both). Sets the access first so the user never lands enabled
   * with the wrong platforms.
   */
  async function enableWithPlatforms(u: AdminUserRow, platforms: Platform[]) {
    setBusyId(u.user_id);
    setError(null);
    const accessRes = await callAdminFn("set_platform_access", u.user_id, platforms);
    if (!accessRes.ok) {
      setError(accessRes.error);
    } else {
      const enableRes = await callAdminFn("enable", u.user_id);
      if (!enableRes.ok) setError(enableRes.error);
    }
    setEnablePickerFor(null);
    await load();
    await refreshUser();
    setBusyId(null);
  }

  async function toggleAdmin(u: AdminUserRow) {
    setBusyId(u.user_id);
    setError(null);
    const action = u.role === "admin" ? "revoke_admin" : "grant_admin";
    const res = await callAdminFn(action, u.user_id);
    if (!res.ok) setError(res.error);
    await load();
    setBusyId(null);
  }

  async function togglePlatform(u: AdminUserRow, platform: Platform) {
    setBusyId(u.user_id);
    setError(null);
    const next = u.platform_access.includes(platform)
      ? u.platform_access.filter((p) => p !== platform)
      : [...u.platform_access, platform];
    const res = await callAdminFn("set_platform_access", u.user_id, next);
    if (!res.ok) setError(res.error);
    await load();
    await refreshUser();
    setBusyId(null);
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <PageHeader
        title="Gestión de usuarios"
        subtitle="Habilita o deshabilita usuarios, y otorga o revoca el rol de administrador"
        action={
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 disabled:opacity-50"
          >
            {loading ? "Cargando…" : "↻ Refrescar"}
          </button>
        }
      />

      {error && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <Card>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-500 border-t-transparent" />
          </div>
        ) : users.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">
            No hay usuarios registrados todavía.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  <th className="py-3 pr-4">Usuario</th>
                  <th className="py-3 pr-4">Estado</th>
                  <th className="py-3 pr-4">Rol</th>
                  <th className="py-3 pr-4">Plataformas</th>
                  <th className="py-3 pr-4">Creado</th>
                  <th className="py-3 pr-4 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const isBusy = busyId === u.user_id;
                  return (
                    <tr
                      key={u.user_id}
                      className="border-b border-slate-100 last:border-b-0"
                    >
                      <td className="py-3 pr-4">
                        <div className="font-medium text-slate-900">
                          {u.full_name ?? "—"}
                        </div>
                        <div className="text-xs text-slate-500">{u.email}</div>
                      </td>
                      <td className="py-3 pr-4">
                        {u.is_enabled ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                            ✓ Habilitado
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
                            ⏳ Pendiente
                          </span>
                        )}
                      </td>
                      <td className="py-3 pr-4">
                        {u.role === "admin" ? (
                          <span className="inline-flex items-center rounded-full border border-brand-200 bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
                            Admin
                          </span>
                        ) : (
                          <span className="text-xs text-slate-500">Normal</span>
                        )}
                      </td>
                      <td className="py-3 pr-4">
                        {/* Chips apply to admins too: they define the admin's
                            platform scope (drv-only / pax-only / both). */}
                          <div className="flex gap-1">
                            {PLATFORMS.map((p) => {
                              const active = u.platform_access.includes(p);
                              return (
                                <button
                                  key={p}
                                  type="button"
                                  onClick={() => togglePlatform(u, p)}
                                  disabled={isBusy}
                                  title={
                                    active
                                      ? `Quitar acceso a ${PLATFORM_LABELS[p]}`
                                      : `Otorgar acceso a ${PLATFORM_LABELS[p]}`
                                  }
                                  className={`rounded-full border px-2 py-0.5 text-xs font-semibold transition disabled:opacity-50 ${
                                    active
                                      ? "border-brand-200 bg-brand-50 text-brand-700 hover:border-brand-300"
                                      : "border-slate-200 bg-slate-50 text-slate-400 hover:border-slate-300"
                                  }`}
                                >
                                  {PLATFORM_LABELS[p]}
                                </button>
                              );
                            })}
                          </div>
                      </td>
                      <td className="py-3 pr-4 text-xs text-slate-500">
                        {new Date(u.created_at).toLocaleDateString("es-MX", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                      </td>
                      <td className="py-3 pr-4">
                        <div className="flex justify-end gap-2">
                          {u.is_enabled ? (
                            <button
                              type="button"
                              onClick={() => toggleEnabled(u)}
                              disabled={isBusy}
                              className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 transition hover:border-amber-300 disabled:opacity-50"
                            >
                              Deshabilitar
                            </button>
                          ) : enablePickerFor === u.user_id ? (
                            <div className="flex items-center gap-1">
                              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                                Acceso:
                              </span>
                              <button
                                type="button"
                                onClick={() => enableWithPlatforms(u, ["drv"])}
                                disabled={isBusy}
                                className="rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-xs font-semibold text-sky-700 transition hover:border-sky-300 disabled:opacity-50"
                              >
                                Driver
                              </button>
                              <button
                                type="button"
                                onClick={() => enableWithPlatforms(u, ["pax"])}
                                disabled={isBusy}
                                className="rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1.5 text-xs font-semibold text-violet-700 transition hover:border-violet-300 disabled:opacity-50"
                              >
                                PAX
                              </button>
                              <button
                                type="button"
                                onClick={() => enableWithPlatforms(u, ["drv", "pax"])}
                                disabled={isBusy}
                                className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 transition hover:border-emerald-300 disabled:opacity-50"
                              >
                                Ambas
                              </button>
                              <button
                                type="button"
                                onClick={() => setEnablePickerFor(null)}
                                disabled={isBusy}
                                aria-label="Cancelar"
                                className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-500 transition hover:border-slate-300 disabled:opacity-50"
                              >
                                ×
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setEnablePickerFor(u.user_id)}
                              disabled={isBusy}
                              className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:border-emerald-300 disabled:opacity-50"
                            >
                              Habilitar…
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => toggleAdmin(u)}
                            disabled={isBusy}
                            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${
                              u.role === "admin"
                                ? "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300"
                                : "border-brand-200 bg-brand-50 text-brand-700 hover:border-brand-300"
                            }`}
                          >
                            {u.role === "admin" ? "Quitar admin" : "Otorgar admin"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
