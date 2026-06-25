import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth, audienceKindFromPath, type AudienceKind } from "@/lib/auth";

export default function Navbar() {
  const { user, role, signOut, audienceKind, setAudienceKind } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  function handleSignOut() {
    signOut();
    navigate("/login", { replace: true });
  }

  function handleKindSwitch(target: AudienceKind) {
    if (target === audienceKind) return;
    setAudienceKind(target);
    // Preserve the current section when toggling between DRV and PAX.
    // /drv/my-campaigns → /pax/my-campaigns, /admin/campaigns?kind=drv → ?kind=pax,
    // /drv → /pax (builder), etc.
    const parts = location.pathname.split("/").filter(Boolean);
    if (parts[0] === "admin") {
      const search = new URLSearchParams(location.search);
      search.set("kind", target);
      navigate({ pathname: location.pathname, search: `?${search.toString()}` });
    } else {
      const section = parts[1] ?? "";
      navigate(`/${target}/${section}`);
    }
  }

  const urlKind = audienceKindFromPath(location.pathname);

  return (
    <nav className="sticky top-0 z-30 border-b border-slate-200 bg-white">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4">
        <Link to={`/${urlKind}`} className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded bg-brand-500 font-bold text-white">
            D
          </div>
          <span className="text-lg font-bold tracking-tight">
            DiDi <span className="text-brand-500">CommsPlanner</span>
          </span>
        </Link>

        {/* Audience-kind switcher */}
        <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 text-xs font-semibold shadow-sm">
          <button
            type="button"
            onClick={() => handleKindSwitch("drv")}
            className={`rounded-lg px-3 py-1.5 transition ${
              audienceKind === "drv" ? "bg-brand-500 text-white" : "text-slate-600 hover:bg-slate-100"
            }`}
            aria-pressed={audienceKind === "drv"}
          >
            Conductores
          </button>
          <button
            type="button"
            onClick={() => handleKindSwitch("pax")}
            className={`rounded-lg px-3 py-1.5 transition ${
              audienceKind === "pax" ? "bg-brand-500 text-white" : "text-slate-600 hover:bg-slate-100"
            }`}
            aria-pressed={audienceKind === "pax"}
          >
            Pasajeros
          </button>
        </div>

        <div className="flex items-center gap-1 text-sm">
          {/* Section nav links — scoped to the active kind */}
          {audienceKind === "drv" && (
            <>
              <NavLink
                to="/drv"
                end
                className={({ isActive }) =>
                  `rounded-lg px-3 py-2 font-medium transition ${
                    isActive ? "bg-brand-50 text-brand-600" : "text-slate-600 hover:bg-slate-100"
                  }`
                }
              >
                Planificar
              </NavLink>
              <NavLink
                to="/drv/my-campaigns"
                className={({ isActive }) =>
                  `rounded-lg px-3 py-2 font-medium transition ${
                    isActive ? "bg-brand-50 text-brand-600" : "text-slate-600 hover:bg-slate-100"
                  }`
                }
              >
                Mis campañas
              </NavLink>
            </>
          )}
          {audienceKind === "pax" && (
            <>
              <NavLink
                to="/pax"
                end
                className={({ isActive }) =>
                  `rounded-lg px-3 py-2 font-medium transition ${
                    isActive ? "bg-brand-50 text-brand-600" : "text-slate-600 hover:bg-slate-100"
                  }`
                }
              >
                Planificar
              </NavLink>
              <NavLink
                to="/pax/my-campaigns"
                className={({ isActive }) =>
                  `rounded-lg px-3 py-2 font-medium transition ${
                    isActive ? "bg-brand-50 text-brand-600" : "text-slate-600 hover:bg-slate-100"
                  }`
                }
              >
                Mis campañas
              </NavLink>
            </>
          )}

          {role === "admin" && (
            <>
              <NavLink
                to="/admin/campaigns?kind=drv"
                className={({ isActive }) =>
                  `rounded-lg px-3 py-2 font-medium transition ${
                    isActive ? "bg-brand-50 text-brand-600" : "text-slate-600 hover:bg-slate-100"
                  }`
                }
              >
                Campañas
              </NavLink>
              <NavLink
                to="/admin/users"
                className={({ isActive }) =>
                  `rounded-lg px-3 py-2 font-medium transition ${
                    isActive ? "bg-brand-50 text-brand-600" : "text-slate-600 hover:bg-slate-100"
                  }`
                }
              >
                Usuarios
              </NavLink>
            </>
          )}
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">{user?.email}</span>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-bold ${
              role === "admin" ? "bg-brand-50 text-brand-600" : "bg-slate-100 text-slate-600"
            }`}
          >
            {role === "admin" ? "Admin" : "Usuario"}
          </span>
          <button
            onClick={handleSignOut}
            className="text-xs text-slate-500 transition hover:text-red-600"
          >
            Cerrar sesión
          </button>
        </div>
      </div>
    </nav>
  );
}