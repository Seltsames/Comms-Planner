import { useAuth } from "@/lib/auth";

export default function PendingApproval() {
  const { user, signOut } = useAuth();

  async function onSignOut() {
    await signOut();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-100">
            <svg
              className="h-8 w-8 text-amber-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">
            Cuenta pendiente de aprobación
          </h1>
        </div>

        <div className="space-y-4 rounded-2xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
          <p className="text-sm text-slate-700">
            Hola <strong>{user?.fullName ?? user?.email}</strong>, tu cuenta fue
            verificada correctamente con Google, pero aún no ha sido habilitada
            por un administrador.
          </p>
          <p className="text-sm text-slate-600">
            Para acceder a DiDi CommsPlanner, un administrador debe aprobar tu
            solicitud. Una vez aprobada, podrás iniciar sesión normalmente.
          </p>
          <p className="text-xs text-slate-500">
            Si crees que esto es un error, contacta al equipo de Comms
            Governance para solicitar acceso.
          </p>
        </div>

        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={onSignOut}
            className="text-sm font-semibold text-slate-500 transition hover:text-slate-700"
          >
            ← Cerrar sesión
          </button>
        </div>
      </div>
    </div>
  );
}
