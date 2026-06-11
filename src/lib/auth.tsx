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
  signInWithGoogle: () => Promise<{ error: string | null; url?: string }>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

async function fetchAuthUser(sessionUser: User): Promise<AuthUser> {
  // Fetch profile (auto-created by handle_new_user trigger on signup)
  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("email, full_name, is_enabled")
    .eq("user_id", sessionUser.id)
    .maybeSingle();

  if (profileErr) {
    console.error("Error fetching profile:", profileErr);
  }

  // Fetch role from user_roles table
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
    const { data, error } = await supabase.auth.signInWithOAuth({
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
    return { error: null, url: data.url };
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
      signInWithGoogle,
      signOut,
      refreshUser,
    }),
    [user, loading, signInWithGoogle, signOut, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
