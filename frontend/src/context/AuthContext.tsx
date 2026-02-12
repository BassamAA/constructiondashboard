import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type PropsWithChildren,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { fetchCurrentUser, login as loginRequest, logout as logoutRequest } from "../api/auth";
import type { AuthUser } from "../types";
import type { PermissionKey } from "../constants/permissions";

type AuthStatus = "loading" | "authenticated" | "unauthenticated";

type AuthContextValue = {
  user: AuthUser | null;
  status: AuthStatus;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  can: (permission: PermissionKey) => boolean;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const queryClient = useQueryClient();

  const loadCurrentUser = useCallback(async () => {
    try {
      const me = await fetchCurrentUser();
      setUser(me);
      setStatus("authenticated");
    } catch {
      setUser(null);
      setStatus("unauthenticated");
    }
  }, []);

  useEffect(() => {
    loadCurrentUser();
  }, [loadCurrentUser]);

  const login = useCallback(
    async (email: string, password: string) => {
      await loginRequest(email, password);
      await loadCurrentUser();
      queryClient.clear();
    },
    [loadCurrentUser, queryClient],
  );

  const logout = useCallback(async () => {
    await logoutRequest();
    setUser(null);
    setStatus("unauthenticated");
    queryClient.clear();
  }, [queryClient]);

  const can = useCallback(
    (permission: PermissionKey) => {
      if (!user) return false;
      if (user.role === "ADMIN") return true;
      return Boolean(user.permissions[permission]);
    },
    [user],
  );

  const value: AuthContextValue = {
    user,
    status,
    login,
    logout,
    can,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
