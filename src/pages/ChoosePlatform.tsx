import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Car, Users, ShieldAlert } from "lucide-react";
import { useAuth, type AudienceKind } from "@/lib/auth";

const PLATFORM_META: Record<
  AudienceKind,
  { title: string; subtitle: string; Icon: typeof Car }
> = {
  drv: {
    title: "Conductores",
    subtitle: "Campañas para drivers (DRV)",
    Icon: Car,
  },
  pax: {
    title: "Pasajeros",
    subtitle: "Campañas para pasajeros (PAX)",
    Icon: Users,
  },
};

/**
 * Post-login platform picker. Users only see the platforms an admin
 * granted them in "Gestión de usuarios"; with a single grant they are
 * redirected straight to that side without seeing this screen.
 */
export default function ChoosePlatform() {
  const { user, platformAccess, setAudienceKind, signOut } = useAuth();
  const navigate = useNavigate();

  function enter(kind: AudienceKind) {
    setAudienceKind(kind);
    navigate(`/${kind}`, { replace: true });
  }

  // Single platform: skip the chooser entirely.
  useEffect(() => {
    if (platformAccess.length === 1) {
      enter(platformAccess[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platformAccess]);

  if (platformAccess.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div className="w-full max-w-md space-y-4 rounded-2xl border border-amber-200 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-100">
            <ShieldAlert className="h-6 w-6 text-amber-600" />
          </div>
          <h1 className="text-xl font-bold text-slate-900">Sin plataforma asignada</h1>
          <p className="text-sm text-slate-600">
            Tu cuenta está habilitada pero ningún administrador te ha asignado
            acceso a Conductores ni a Pasajeros. Contacta a un administrador
            para que te otorgue acceso en Gestión de usuarios.
          </p>
          <button
            onClick={() => {
              signOut();
              navigate("/login", { replace: true });
            }}
            className="text-xs text-slate-500 transition hover:text-red-600"
          >
            Cerrar sesión
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-2xl space-y-8">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-500 text-xl font-bold text-white">
            D
          </div>
          <h1 className="text-2xl font-bold text-slate-900">
            ¿Dónde vas a trabajar hoy{user ? `, ${user.fullName.split(" ")[0]}` : ""}?
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Elige la plataforma. Todo lo que veas, crees y consultes queda
            aislado a la plataforma elegida.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {platformAccess.map((kind) => {
            const { title, subtitle, Icon } = PLATFORM_META[kind];
            return (
              <button
                key={kind}
                type="button"
                onClick={() => enter(kind)}
                className="group flex flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm transition hover:border-brand-300 hover:shadow-md"
              >
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 text-brand-600 transition group-hover:bg-brand-500 group-hover:text-white">
                  <Icon className="h-7 w-7" />
                </div>
                <div>
                  <div className="text-lg font-bold text-slate-900">{title}</div>
                  <div className="text-xs text-slate-500">{subtitle}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
