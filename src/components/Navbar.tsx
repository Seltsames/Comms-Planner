import { Link, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";

export default function Navbar() {
  const { user, role, signOut } = useAuth();
  const navigate = useNavigate();

  function handleSignOut() {
    signOut();
    navigate("/login", { replace: true });
  }

  return (
    <nav className="sticky top-0 z-30 border-b border-slate-200 bg-white">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4">
        <Link to="/" className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded bg-brand-500 font-bold text-white">
            D
          </div>
          <span className="text-lg font-bold tracking-tight">
            DiDi <span className="text-brand-500">CommsPlanner</span>
          </span>
        </Link>

        <div className="flex items-center gap-1 text-sm">
          <NavLink
            to="/"
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
            to="/my-campaigns"
            className={({ isActive }) =>
              `rounded-lg px-3 py-2 font-medium transition ${
                isActive ? "bg-brand-50 text-brand-600" : "text-slate-600 hover:bg-slate-100"
              }`
            }
          >
            Mis campañas
          </NavLink>
          {role === "admin" && (
            <>
              <NavLink
                to="/admin/campaigns"
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
