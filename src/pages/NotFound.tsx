import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-4 text-center">
      <h1 className="mb-2 text-5xl font-bold text-slate-900">404</h1>
      <p className="mb-6 text-lg text-slate-500">Página no encontrada</p>
      <Link to="/" className="text-sm font-semibold text-brand-600 hover:underline">
        ← Volver al inicio
      </Link>
    </div>
  );
}
