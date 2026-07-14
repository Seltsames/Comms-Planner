import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth, type AudienceKind } from "@/lib/auth";
import Layout from "@/components/Layout";
import Login from "@/pages/Login";
import AuthCallback from "@/components/auth/AuthCallback";
import PendingApproval from "@/pages/PendingApproval";
import Index from "@/pages/Index";
import ChoosePlatform from "@/pages/ChoosePlatform";
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

/**
 * Blocks a DRV/PAX route when the admin did not grant that platform to
 * the user. Redirects home, where HomeRedirect re-routes to a platform
 * the user *can* use (or to the chooser / "no access" screen).
 */
function PlatformGuard({ kind, children }: { kind: AudienceKind; children: React.ReactNode }) {
  const { loading, platformAccess } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (!platformAccess.includes(kind)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/**
 * Landing decision for "/": with both platforms granted the user picks
 * one (ChoosePlatform); with exactly one they go straight to it; with
 * none, ChoosePlatform shows the "no access" message.
 */
function HomeRedirect() {
  const { user, loading, isEnabled, platformAccess } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (!isEnabled) return <Navigate to="/pending-approval" replace />;
  if (platformAccess.length === 1) return <Navigate to={`/${platformAccess[0]}`} replace />;
  return <Navigate to="/choose-platform" replace />;
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

      {/* Platform chooser — shown after login when the user has access to
          more than one platform. */}
      <Route
        path="/choose-platform"
        element={
          <Protected>
            <ChoosePlatform />
          </Protected>
        }
      />

      {/* DRV app routes */}
      <Route
        path="/drv"
        element={
          <Protected>
            <PlatformGuard kind="drv">
              <KindScoped kind="drv">
                <Layout>
                  <Index />
                </Layout>
              </KindScoped>
            </PlatformGuard>
          </Protected>
        }
      />
      <Route
        path="/drv/my-campaigns"
        element={
          <Protected>
            <PlatformGuard kind="drv">
              <KindScoped kind="drv">
                <Layout>
                  <MyCampaigns kind="drv" />
                </Layout>
              </KindScoped>
            </PlatformGuard>
          </Protected>
        }
      />

      {/* PAX app routes */}
      <Route
        path="/pax"
        element={
          <Protected>
            <PlatformGuard kind="pax">
              <KindScoped kind="pax">
                <Layout>
                  <Index />
                </Layout>
              </KindScoped>
            </PlatformGuard>
          </Protected>
        }
      />
      <Route
        path="/pax/my-campaigns"
        element={
          <Protected>
            <PlatformGuard kind="pax">
              <KindScoped kind="pax">
                <Layout>
                  <MyCampaigns kind="pax" />
                </Layout>
              </KindScoped>
            </PlatformGuard>
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

      {/* Landing: route to the platform(s) the user has access to. */}
      <Route path="/" element={<HomeRedirect />} />

      {/* Backwards compatibility: redirect legacy routes to the DRV
          namespace (PlatformGuard re-routes users without DRV access). */}
      <Route path="/my-campaigns" element={<Navigate to="/drv/my-campaigns" replace />} />
      <Route path="/admin/campaigns/drv" element={<Navigate to="/admin/campaigns" replace state={{ kind: "drv" }} />} />

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}