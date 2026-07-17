"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import { useSession, signOut as nextAuthSignOut } from "next-auth/react";
import { DEFAULT_CURRENCY } from "@/lib/currency";
import {
  canEditSettings as canEditSettingsFor,
  canManageMembers as canManageMembersFor,
  canSendMessages as canSendMessagesFor,
  isAccountRole,
  type AccountRole,
} from "@/lib/auth/roles";
import { fetchProfileAndAccountAction } from "@/app/actions/auth";

interface Profile {
  id: string;
  full_name: string | null;
  email: string;
  avatar_url: string | null;
  role: string | null;
  beta_features: string[];
  account_id: string | null;
  account_role: AccountRole | null;
}

interface AccountSummary {
  id: string;
  name: string;
  default_currency: string;
}

interface AuthContextValue {
  user: any | null; // From next-auth session.user
  profile: Profile | null;
  loading: boolean;
  profileLoading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  
  accountId: string | null;
  accountRole: AccountRole | null;
  account: AccountSummary | null;
  defaultCurrency: string;
  isOwner: boolean;
  isAdmin: boolean;
  isAgent: boolean;
  isViewer: boolean;
  canManageMembers: boolean;
  canEditSettings: boolean;
  canSendMessages: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession();
  
  const [profile, setProfile] = useState<Profile | null>(null);
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);

  const fetchProfile = useCallback(async () => {
    setProfileLoading(true);
    try {
      const data = await fetchProfileAndAccountAction();
      if (data) {
        const accountRole = isAccountRole(data.profile.account_role as string)
          ? data.profile.account_role as AccountRole
          : null;
          
        setProfile({
          id: data.profile.id,
          full_name: data.profile.full_name,
          email: data.profile.email,
          avatar_url: data.profile.avatar_url,
          role: data.profile.role,
          beta_features: (data.profile.beta_features as string[]) ?? [],
          account_id: data.profile.account_id ?? null,
          account_role: accountRole,
        });
        
        if (data.account) {
          setAccount({
            id: data.account.id,
            name: data.account.name,
            default_currency: data.account.default_currency ?? DEFAULT_CURRENCY,
          });
        }
      } else {
        setProfile(null);
        setAccount(null);
      }
    } catch (err) {
      console.error("[AuthProvider] fetchProfile threw:", err);
    } finally {
      setProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === "authenticated" && session?.user) {
      fetchProfile();
    } else if (status === "unauthenticated") {
      setProfile(null);
      setAccount(null);
      setProfileLoading(false);
    }
  }, [status, session?.user, fetchProfile]);

  const signOut = useCallback(async () => {
    await nextAuthSignOut({ callbackUrl: "/login" });
  }, []);

  const refreshProfile = useCallback(async () => {
    await fetchProfile();
  }, [fetchProfile]);

  const derived = useMemo(() => {
    const role = profile?.account_role ?? null;
    return {
      accountRole: role,
      accountId: profile?.account_id ?? null,
      isOwner: role === "owner",
      isAdmin: role === "admin",
      isAgent: role === "agent",
      isViewer: role === "viewer",
      canManageMembers: role ? canManageMembersFor(role) : false,
      canEditSettings: role ? canEditSettingsFor(role) : false,
      canSendMessages: role ? canSendMessagesFor(role) : false,
    };
  }, [profile?.account_role, profile?.account_id]);

  return (
    <AuthContext.Provider
      value={{
        user: session?.user ?? null,
        profile,
        loading: status === "loading",
        profileLoading: status === "loading" || profileLoading,
        signOut,
        refreshProfile,
        account,
        defaultCurrency: account?.default_currency ?? DEFAULT_CURRENCY,
        ...derived,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    return {
      user: null,
      profile: null,
      loading: false,
      profileLoading: false,
      signOut: async () => {
        window.location.href = "/login";
      },
      refreshProfile: async () => {},
      account: null,
      defaultCurrency: DEFAULT_CURRENCY,
      accountId: null,
      accountRole: null,
      isOwner: false,
      isAdmin: false,
      isAgent: false,
      isViewer: false,
      canManageMembers: false,
      canEditSettings: false,
      canSendMessages: false,
    };
  }
  return ctx;
}
