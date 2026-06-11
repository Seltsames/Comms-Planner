import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import Layout from "@/components/Layout";
import Login from "@/pages/Login";
import AuthCallback from "@/components/auth/AuthCallback";
import PendingApproval from "@/pages/PendingApproval";
import Index from "@/pages/Index";
import MyCampaigns from "@/pages/MyCampaigns";
import AdminUsers from "@/pages/AdminUsers";
import AdminCampaigns from "@/pages/AdminCampaigns";
import NotFound from "@/pages/NotFound";

function FullScreenLoader() {
  return (
    <div className="flex h-screen items-center justify-center bg-slate-50">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand-500 border-t-transparent" />
    </div>
  );
}

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading, isEnabled } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (!isEnabled) return <Navigate to="/pending-approval" replace />;
  return <>{children}</>;
}

function AdminOnly({ children }: { children: React.ReactNode }) {
  const { user, role, loading, isEnabled } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (!isEnabled) return <Navigate to="/pending-approval" replace />;
  if (role !== "admin") return <Navigate to="/" replace />;
  return <>{children}</>;
}

function GuestOnly({ children }: { children: React.ReactNode }) {
  const { user, loading, isEnabled } = useAuth();
  if (loading) return null;
  if (user) {
    if (!isEnabled) return <Navigate to="/pending-approval" replace />;
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

function PendingOnly({ children }: { children: React.ReactNode }) {
  const { user, loading, isEnabled } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (isEnabled) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <GuestOnly>
            <Login />
          </GuestOnly>
        }
      />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route
        path="/pending-approval"
        element={
          <PendingOnly>
            <PendingApproval />
          </PendingOnly>
        }
      />
      <Route
        path="/"
        element={
          <Protected>
            <Layout>
              <Index />
            </Layout>
          </Protected>
        }
      />
      <Route
        path="/my-campaigns"
        element={
          <Protected>
            <Layout>
              <MyCampaigns />
            </Layout>
          </Protected>
        }
      />
      <Route
        path="/admin/users"
        element={
          <AdminOnly>
            <Layout>
              <AdminUsers />
            </Layout>
          </AdminOnly>
        }
      />
      <Route
        path="/admin/campaigns"
        element={
          <AdminOnly>
            <Layout>
              <AdminCampaigns />
            </Layout>
          </AdminOnly>
        }
      />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
