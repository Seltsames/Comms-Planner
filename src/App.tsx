import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth, type AudienceKind } from "@/lib/auth";
import Layout from "@/components/Layout";
import Login from "@/pages/Login";
import AuthCallback from "@/components/auth/AuthCallback";
import PendingApproval from "@/pages/PendingApproval";
import Index from "@/pages/Index";
import MyCampaigns from "@/pages/MyCampaigns";
import AdminUsers from "@/pages/AdminUsers";
import AdminCampaigns from "@/pages/AdminCampaigns";
import NotFound from "@/pages/NotFound";
import { CampaignBuilderProvider } from "@/lib/campaignBuilder";

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

/**
 * Reads the audience kind from the URL (e.g. /pax/builder) and wraps the
 * children in a CampaignBuilderProvider so the form state survives
 * navigation between Builder → Dashboard → My Campaigns AND between DRV
 * ↔ PAX switching.
 */
function KindScoped({ kind, children }: { kind: AudienceKind; children: React.ReactNode }) {
  return <CampaignBuilderProvider kind={kind}>{children}</CampaignBuilderProvider>;
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

      {/* DRV app routes */}
      <Route
        path="/drv"
        element={
          <Protected>
            <KindScoped kind="drv">
              <Layout>
                <Index />
              </Layout>
            </KindScoped>
          </Protected>
        }
      />
      <Route
        path="/drv/my-campaigns"
        element={
          <Protected>
            <KindScoped kind="drv">
              <Layout>
                <MyCampaigns kind="drv" />
              </Layout>
            </KindScoped>
          </Protected>
        }
      />

      {/* PAX app routes */}
      <Route
        path="/pax"
        element={
          <Protected>
            <KindScoped kind="pax">
              <Layout>
                <Index />
              </Layout>
            </KindScoped>
          </Protected>
        }
      />
      <Route
        path="/pax/my-campaigns"
        element={
          <Protected>
            <KindScoped kind="pax">
              <Layout>
                <MyCampaigns kind="pax" />
              </Layout>
            </KindScoped>
          </Protected>
        }
      />

      {/* Shared admin routes — kind dispatched from the URL via ?kind=... */}
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

      {/* Backwards compatibility: redirect legacy routes to the DRV namespace. */}
      <Route path="/" element={<Navigate to="/drv" replace />} />
      <Route path="/my-campaigns" element={<Navigate to="/drv/my-campaigns" replace />} />
      <Route path="/admin/campaigns/drv" element={<Navigate to="/admin/campaigns" replace state={{ kind: "drv" }} />} />

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}