import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export type Role = "admin" | "normal";
export type AudienceKind = "drv" | "pax";

export const AUDIENCE_KINDS: readonly AudienceKind[] = ["drv", "pax"] as const;

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: Role | null;
  isEnabled: boolean;
  /** Platforms this user may work on, assigned by an admin. Admins always get both. */
  platformAccess: AudienceKind[];
}

interface AuthContextValue {
  user: AuthUser | null;
  role: Role | null;
  isEnabled: boolean;
  platformAccess: AudienceKind[];
  loading: boolean;
  audienceKind: AudienceKind;
  setAudienceKind: (kind: AudienceKind) => void;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const AUDIENCE_STORAGE_KEY = "commplanner.audience_kind";

function readStoredAudienceKind(): AudienceKind {
  if (typeof window === "undefined") return "drv";
  const raw = window.localStorage.getItem(AUDIENCE_STORAGE_KEY);
  return raw === "pax" ? "pax" : "drv";
}

function sanitizePlatformAccess(raw: unknown): AudienceKind[] {
  if (!Array.isArray(raw)) return [...AUDIENCE_KINDS];
  return AUDIENCE_KINDS.filter((k) => raw.includes(k));
}

async function fetchAuthUser(sessionUser: User): Promise<AuthUser> {
  let { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("email, full_name, is_enabled, platform_access")
    .eq("user_id", sessionUser.id)
    .maybeSingle();

  if (profileErr) {
    // Fallback for databases where migration 00030 (platform_access) has
    // not been applied yet: retry without the column and default to both
    // platforms so existing deployments keep working.
    const retry = await supabase
      .from("profiles")
      .select("email, full_name, is_enabled")
      .eq("user_id", sessionUser.id)
      .maybeSingle();
    if (retry.error) {
      console.error("Error fetching profile:", retry.error);
    } else {
      profile = retry.data as typeof profile;
      profileErr = null;
    }
  }

  const { data: roleRow, error: roleErr } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", sessionUser.id)
    .maybeSingle();

  if (roleErr) {
    console.error("Error fetching role:", roleErr);
  }

  const email = profile?.email ?? sessionUser.email ?? "";
  const fullName =
    profile?.full_name ??
    (sessionUser.user_metadata?.full_name as string | undefined) ??
    (sessionUser.user_metadata?.name as string | undefined) ??
    email.split("@")[0];

  const role = (roleRow?.role as Role | undefined) ?? null;

  return {
    id: sessionUser.id,
    email,
    fullName,
    role,
    isEnabled: profile?.is_enabled ?? false,
    // Platform access applies to admins too: an admin's scope is their
    // role intersected with platform_access (drv-only / pax-only / both).
    platformAccess: sanitizePlatformAccess(
      (profile as { platform_access?: unknown } | null)?.platform_access,
    ),
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [audienceKind, setAudienceKindState] = useState<AudienceKind>(() => readStoredAudienceKind());

  const setAudienceKind = useCallback((kind: AudienceKind) => {
    setAudienceKindState(kind);
    try {
      window.localStorage.setItem(AUDIENCE_STORAGE_KEY, kind);
    } catch {
      /* localStorage unavailable (e.g. SSR or private mode) */
    }
  }, []);

  const loadUser = useCallback(async (sessionUser: User) => {
    const u = await fetchAuthUser(sessionUser);
    setUser(u);
    return u;
  }, []);

  useEffect(() => {
    let active = true;

    // Safety net: never let `loading` stay true forever. If the bootstrap
    // somehow hangs (slow network, stuck RPC, etc.) this flips the flag
    // so the app can render the unauthenticated state instead of a
    // perpetual spinner.
    const loadingSafety = setTimeout(() => {
      if (active && (loading as unknown as boolean)) {
        console.warn("Auth bootstrap exceeded 5s — forcing loading=false");
        setUser((prev) => prev);
        setLoading(false);
      }
    }, 5000);

    async function bootstrap() {
      const { data, error } = await supabase.auth.getSession();
      if (!active) return;
      if (error) {
        console.error("getSession error:", error);
        setUser(null);
        setLoading(false);
        clearTimeout(loadingSafety);
        return;
      }
      const session = data.session;
      try {
        if (session?.user) {
          await loadUser(session.user);
        } else {
          setUser(null);
        }
      } catch (e) {
        console.error("loadUser error:", e);
        setUser(null);
      } finally {
        clearTimeout(loadingSafety);
        if (active) setLoading(false);
      }
    }

    bootstrap();

    const { data: sub } = supabase.auth.onAuthStateChange(
      async (_event, session: Session | null) => {
        if (!active) return;
        try {
          if (session?.user) {
            await loadUser(session.user);
          } else {
            setUser(null);
          }
        } catch (e) {
          console.error("onAuthStateChange loadUser error:", e);
          setUser(null);
        } finally {
          clearTimeout(loadingSafety);
          if (active) setLoading(false);
        }
      },
    );

    return () => {
      active = false;
      clearTimeout(loadingSafety);
      sub.subscription.unsubscribe();
    };
  }, [loadUser]);

  const signInWithGoogle = useCallback(async () => {
    const redirectTo = `${window.location.origin}/auth/callback`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        queryParams: {
          hd: "didi-labs.com",
          prompt: "select_account",
        },
      },
    });
    if (error) return { error: error.message };
    return { error: null };
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
  }, []);

  const refreshUser = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session?.user) {
      await loadUser(data.session.user);
    }
  }, [loadUser]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      role: user?.role ?? null,
      isEnabled: user?.isEnabled ?? false,
      platformAccess: user?.platformAccess ?? [],
      loading,
      audienceKind,
      setAudienceKind,
      signInWithGoogle,
      signOut,
      refreshUser,
    }),
    [user, loading, audienceKind, setAudienceKind, signInWithGoogle, signOut, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

/**
 * Returns the audience kind derived from the URL path. Falls back to the
 * AuthProvider state when the URL does not start with /drv or /pax.
 */
export function audienceKindFromPath(pathname: string): AudienceKind {
  if (pathname.startsWith("/pax")) return "pax";
  return "drv";
}