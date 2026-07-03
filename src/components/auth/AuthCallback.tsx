import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";

export default function AuthCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function handle() {
      // Supabase JS client has detectSessionInUrl: true by default, which
      // means it auto-exchanges the OAuth code and REMOVES it from the
      // URL before this component gets a chance to read it. So the legacy
      // "no code → error" path was firing on every successful login.
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      if (data.session) {
        navigate("/", { replace: true });
        return;
      }

      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      const errorDescription = params.get("error_description");

      if (errorDescription) {
        setError(errorDescription);
        return;
      }

      if (!code) {
        // Still no code after the session check: surface the error so the
        // user isn't stuck on the callback URL silently.
        setError("No se recibió código de autenticación. Vuelve a intentar iniciar sesión.");
        return;
      }

      // Final fallback: explicit exchange.
      const { error: exchangeErr } = await supabase.auth.exchangeCodeForSession(code);
      if (!active) return;
      if (exchangeErr) {
        setError(exchangeErr.message);
        return;
      }
      navigate("/", { replace: true });
    }

    handle();

    return () => {
      active = false;
    };
  }, [navigate]);

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