/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, clearToken, getToken, setToken } from "../api/client";
import { type BaseRole } from "../utils/roles";

type AuthUser = {
  email: string;
  role: BaseRole;
};

type VerifyCodeResponse = {
  access_token: string;
  token_type: string;
  trusted_device_token?: string | null;
};

type LoginStartResponse = {
  status: string;
  challenge_id?: number;
  message: string;
  dev_code?: string;
  access_token?: string;
  token_type?: string;
  trusted_device_token?: string | null;
};

type AuthContextValue = {
  token: string | null;
  user: AuthUser | null;
  loading: boolean;
  login: (email: string) => Promise<LoginStartResponse>;
  adminPasswordLogin: (email: string, password: string) => Promise<void>;
  passwordLogin: (email: string, password: string) => Promise<void>;
  verifyCode: (challengeId: number, code: string) => Promise<void>;
  logout: () => void;
  refreshMe: () => Promise<AuthUser | null>;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const TRUSTED_DEVICE_KEY = "trusted_device_token";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setTokenState] = useState<string | null>(() => getToken());
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const logout = useCallback(() => {
    clearToken();
    setTokenState(null);
    setUser(null);
  }, []);

  const refreshMe = useCallback(async (): Promise<AuthUser | null> => {
    if (!token) {
      setUser(null);
      return null;
    }
    try {
      const me = await apiGet<AuthUser>("/auth/me");
      setUser(me);
      return me;
    } catch {
      logout();
      return null;
    }
  }, [logout, token]);

  const login = useCallback(async (email: string): Promise<LoginStartResponse> => {
    const trustedDeviceToken = localStorage.getItem(TRUSTED_DEVICE_KEY);
    const res = await apiPost<LoginStartResponse>("/auth/start", {
      email,
      trusted_device_token: trustedDeviceToken,
    });

    if (res.status === "authenticated" && res.access_token) {
      setToken(res.access_token);
      setTokenState(res.access_token);
      const me = await apiGet<AuthUser>("/auth/me");
      setUser(me);
    }

    return res;
  }, []);

  const adminPasswordLogin = useCallback(async (email: string, password: string) => {
    const data = await apiPost<VerifyCodeResponse & { access_token: string }>("/auth/admin-password-login", {
      email,
      password,
    });
    setToken(data.access_token);
    setTokenState(data.access_token);
    const me = await apiGet<AuthUser>("/auth/me");
    setUser(me);
  }, []);

  const passwordLogin = useCallback(async (email: string, password: string) => {
    const data = await apiPost<VerifyCodeResponse & { access_token: string }>("/auth/password-login", {
      email,
      password,
    });
    setToken(data.access_token);
    setTokenState(data.access_token);
    const me = await apiGet<AuthUser>("/auth/me");
    setUser(me);
  }, []);

  const verifyCode = useCallback(async (challengeId: number, code: string) => {
    const data = await apiPost<VerifyCodeResponse>("/auth/verify-code", {
      challenge_id: challengeId,
      code,
    });
    setToken(data.access_token);
    setTokenState(data.access_token);
    if (data.trusted_device_token) {
      localStorage.setItem(TRUSTED_DEVICE_KEY, data.trusted_device_token);
    }
    const me = await apiGet<AuthUser>("/auth/me");
    setUser(me);
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!token) {
        if (!active) return;
        setLoading(false);
        return;
      }
      await refreshMe();
      if (!active) return;
      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [refreshMe, token]);

  const value = useMemo<AuthContextValue>(
    () => ({ token, user, loading, login, adminPasswordLogin, passwordLogin, verifyCode, logout, refreshMe }),
    [token, user, loading, login, adminPasswordLogin, passwordLogin, verifyCode, logout, refreshMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return ctx;
}
