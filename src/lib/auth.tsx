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
}

interface AuthContextValue {
  user: AuthUser | null;
  role: Role | null;
  isEnabled: boolean;
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

async function fetchAuthUser(sessionUser: User): Promise<AuthUser> {
  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("email, full_name, is_enabled")
    .eq("user_id", sessionUser.id)
    .maybeSingle();

  if (profileErr) {
    console.error("Error fetching profile:", profileErr);
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

  return {
    id: sessionUser.id,
    email,
    fullName,
    role: (roleRow?.role as Role | undefined) ?? null,
    isEnabled: profile?.is_enabled ?? false,
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

    async function bootstrap() {
      const { data, error } = await supabase.auth.getSession();
      if (!active) return;
      if (error) {
        console.error("getSession error:", error);
        setUser(null);
        setLoading(false);
        return;
      }
      const session = data.session;
      if (session?.user) {
        await loadUser(session.user);
      } else {
        setUser(null);
      }
      if (active) setLoading(false);
    }

    bootstrap();

    const { data: sub } = supabase.auth.onAuthStateChange(
      async (_event, session: Session | null) => {
        if (!active) return;
        if (session?.user) {
          await loadUser(session.user);
        } else {
          setUser(null);
        }
        if (active) setLoading(false);
      },
    );

    return () => {
      active = false;
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