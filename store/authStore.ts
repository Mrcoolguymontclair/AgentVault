import { create } from "zustand";
import { type Session, type User, type AuthError } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { upsertProfile } from "@/lib/services/profileService";

export interface AuthResult {
  error?: string;
  success?: boolean;
}

export interface ProfileData {
  displayName: string;
  avatar: string;
  tradingLevel: string;
}

interface AuthStore {
  session: Session | null;
  user: User | null;
  isLoading: boolean;
  profileComplete: boolean;

  initialize: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  signUp: (email: string, password: string, displayName: string) => Promise<AuthResult>;
  signOut: () => Promise<void>;
  signInWithGoogle: () => Promise<AuthResult>;
  resetPassword: (email: string) => Promise<AuthResult>;
  updateProfile: (data: ProfileData) => Promise<AuthResult>;
}

function mapAuthError(error: AuthError | null | undefined): string {
  if (!error) return "An unknown error occurred";
  const msg = (error.message || "").toLowerCase();

  if (msg.includes("already registered") || msg.includes("user already registered") || msg.includes("already exists")) {
    return "An account with this email already exists. Try signing in instead.";
  }
  if (msg.includes("invalid login credentials") || msg.includes("invalid_credentials")) {
    return "Incorrect email or password. Please try again.";
  }
  if (msg.includes("email not confirmed")) {
    return "Please check your inbox and verify your email before signing in.";
  }
  if (msg.includes("too many requests") || msg.includes("rate_limit") || error.status === 429) {
    return "Too many attempts. Please wait a moment and try again.";
  }
  if (msg.includes("network") || msg.includes("fetch") || msg.includes("failed to fetch")) {
    return "Network error. Check your connection and try again.";
  }
  if (msg.includes("weak password") || msg.includes("password should be")) {
    return "Password is too weak. Use at least 8 characters with numbers and letters.";
  }
  if (msg.includes("user not found") || msg.includes("no user found")) {
    return "No account found with this email address.";
  }
  return error.message || "Something went wrong. Please try again.";
}

export const useAuthStore = create<AuthStore>((set) => ({
  session: null,
  user: null,
  isLoading: true,
  profileComplete: false,

  initialize: async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const profileComplete = !!(session?.user?.user_metadata?.profile_complete);
      set({ session, user: session?.user ?? null, isLoading: false, profileComplete });

      supabase.auth.onAuthStateChange((_event, session) => {
        const profileComplete = !!(session?.user?.user_metadata?.profile_complete);
        set({ session, user: session?.user ?? null, profileComplete });
      });
    } catch {
      set({ isLoading: false });
    }
  },

  signIn: async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: mapAuthError(error) };
    return { success: true };
  },

  signUp: async (email, password, displayName) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName },
      },
    });
    if (error) return { error: mapAuthError(error) };
    return { success: true };
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ session: null, user: null, profileComplete: false });
  },

  signInWithGoogle: async () => {
    try {
      const redirectTo =
        typeof window !== "undefined"
          ? `${window.location.origin}/`
          : "agentvault://";

      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo },
      });
      if (error) return { error: mapAuthError(error) };
      return { success: true };
    } catch {
      return { error: "Google sign-in is not available right now." };
    }
  },

  resetPassword: async (email) => {
    const redirectTo =
      typeof window !== "undefined"
        ? `${window.location.origin}/auth/reset-password`
        : "agentvault://auth/reset-password";

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    });
    if (error) return { error: mapAuthError(error) };
    return { success: true };
  },

  updateProfile: async (data) => {
    const { error, data: updatedUser } = await supabase.auth.updateUser({
      data: {
        display_name: data.displayName,
        avatar: data.avatar,
        trading_level: data.tradingLevel,
        profile_complete: true,
      },
    });
    if (error) return { error: mapAuthError(error) };

    // Also persist to the profiles table
    const userId = updatedUser?.user?.id;
    if (userId) {
      await upsertProfile(userId, {
        display_name: data.displayName,
        avatar: data.avatar,
        trading_level: data.tradingLevel as any,
      });
    }

    set({ profileComplete: true });
    return { success: true };
  },
}));
