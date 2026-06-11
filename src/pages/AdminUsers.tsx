import { useCallback, useEffect, useState } from "react";
import { Card, PageHeader } from "@/components/Ui";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

interface AdminUserRow {
  user_id: string;
  email: string;
  full_name: string | null;
  is_enabled: boolean;
  enabled_at: string | null;
  created_at: string;
  role: "admin" | "normal" | null;
}

type ActionResult = { ok: true } | { ok: false; error: string };

export default function AdminUsers() {
  const { refreshUser } = useAuth();
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    // Fetch all profiles (admin can read all)
    const { data: profiles, error: pErr } = await supabase
      .from("profiles")
      .select("user_id, email, full_name, is_enabled, enabled_at, created_at")
      .order("created_at", { ascending: false });

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

    const rows: AdminUserRow[] = (profiles ?? []).map((p) => ({
      user_id: p.user_id,
      email: p.email,
      full_name: p.full_name,
      is_enabled: p.is_enabled,
      enabled_at: p.enabled_at,
      created_at: p.created_at,
      role: roleByUser.get(p.user_id) ?? null,
    }));

    setUsers(rows);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function callAdminFn(
    action: "enable" | "disable" | "grant_admin" | "revoke_admin",
    targetUserId: string,
  ): Promise<ActionResult> {
    const { data, error: fnErr } = await supabase.functions.invoke<{
      success: boolean;
      error?: string;
    }>("admin-users", {
      body: { action, targetUserId },
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

  async function toggleAdmin(u: AdminUserRow) {
    setBusyId(u.user_id);
    setError(null);
    const action = u.role === "admin" ? "revoke_admin" : "grant_admin";
    const res = await callAdminFn(action, u.user_id);
    if (!res.ok) setError(res.error);
    await load();
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
                      <td className="py-3 pr-4 text-xs text-slate-500">
                        {new Date(u.created_at).toLocaleDateString("es-MX", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                      </td>
                      <td className="py-3 pr-4">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => toggleEnabled(u)}
                            disabled={isBusy}
                            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${
                              u.is_enabled
                                ? "border-amber-200 bg-amber-50 text-amber-700 hover:border-amber-300"
                                : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-300"
                            }`}
                          >
                            {u.is_enabled ? "Deshabilitar" : "Habilitar"}
                          </button>
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
