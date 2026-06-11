import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";

export default function AuthCallback() {
  const navigate = useNavigate();
  const { loading } = useAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function handle() {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      const errorDescription = params.get("error_description");

      if (errorDescription) {
        setError(errorDescription);
        return;
      }

      if (!code) {
        setError("No se recibió código de autenticación");
        return;
      }

      const { error: exchangeErr } = await supabase.auth.exchangeCodeForSession(code);
      if (exchangeErr) {
        setError(exchangeErr.message);
        return;
      }

      // Wait for AuthProvider to pick up the session, then redirect.
      // AuthProvider's onAuthStateChange will fire and set the user.
      // We just wait for loading to become false, then route to home.
      const start = Date.now();
      const poll = setInterval(() => {
        if (!active) return clearInterval(poll);
        if (!loading || Date.now() - start > 5000) {
          clearInterval(poll);
          navigate("/", { replace: true });
        }
      }, 100);
    }

    handle();
    return () => {
      active = false;
    };
  }, [navigate, loading]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div className="w-full max-w-md space-y-4 rounded-2xl border border-red-200 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
            <svg
              className="h-6 w-6 text-red-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-slate-900">Error de autenticación</h1>
          <p className="text-sm text-slate-600">{error}</p>
          <a
            href="/login"
            className="inline-block rounded-xl bg-brand-500 px-6 py-2 text-sm font-semibold text-white transition hover:bg-brand-600"
          >
            Volver a iniciar sesión
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="text-center">
        <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-brand-500 border-t-transparent" />
        <p className="text-sm text-slate-500">Completando inicio de sesión…</p>
      </div>
    </div>
  );
}
