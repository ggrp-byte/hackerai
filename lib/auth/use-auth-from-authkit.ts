"use client";

import { useCallback, useEffect, useRef, useMemo } from "react";
import { useAuth, useAccessToken } from "@workos-inc/authkit-nextjs/components";
import { CrossTabMutex } from "@/lib/auth/cross-tab-mutex";
import {
  clearExpiredSharedToken,
  getFreshSharedTokenWithFallback,
  TOKEN_FRESHNESS_MS,
} from "@/lib/auth/shared-token";
import { isCrossTabTokenSharingEnabled } from "@/lib/auth/feature-flags";

const refreshMutex = new CrossTabMutex({
  lockKey: "hackerai-token-refresh",
  lockTimeoutMs: 15000,
  onLog: (msg) => console.log(`[Convex Auth] ${msg}`),
});

export function useSharedTokenCleanup(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const interval = setInterval(clearExpiredSharedToken, TOKEN_FRESHNESS_MS);
    return () => clearInterval(interval);
  }, [enabled]);
}

export type ConvexAuthState = {
  isLoading: boolean;
  isAuthenticated: boolean;
  fetchAccessToken: (args?: { forceRefreshToken?: boolean }) => Promise<string | null>;
};

export type AuthKitDeps = {
  useAuth: typeof useAuth;
  useAccessToken: typeof useAccessToken;
  mutex: CrossTabMutex;
  isCrossTabEnabled?: (userId: string | undefined) => boolean;
};

const defaultDeps: AuthKitDeps = {
  useAuth,
  useAccessToken,
  mutex: refreshMutex,
  isCrossTabEnabled: isCrossTabTokenSharingEnabled,
};

export function useAuthFromAuthKit(
  deps: AuthKitDeps = defaultDeps,
): ConvexAuthState {
  const localMode = process.env.NEXT_PUBLIC_HACKERAI_LOCAL === "true";
  const { user, loading: authLoading, organizationId, refreshAuth } = deps.useAuth();
  const { getAccessToken, accessToken, refresh } = deps.useAccessToken();
  const accessTokenRef = useRef<string | undefined>(undefined);
  const lastRefreshErrorAt = useRef<number>(0);
  const hasResolvedOrgRef = useRef(false);

  const isCrossTabEnabled = useMemo(
    () => (deps.isCrossTabEnabled ?? isCrossTabTokenSharingEnabled)(user?.id),
    [deps.isCrossTabEnabled, user?.id],
  );

  useSharedTokenCleanup(!localMode && isCrossTabEnabled);

  useEffect(() => {
    if (localMode) return;
    if (organizationId && !hasResolvedOrgRef.current && refreshAuth) {
      refreshAuth({ organizationId })
        .then(() => {
          hasResolvedOrgRef.current = true;
        })
        .catch(() => {});
    }
  }, [localMode, organizationId, refreshAuth]);

  useEffect(() => {
    accessTokenRef.current = accessToken;
  }, [accessToken]);

  const isLoading = localMode ? false : authLoading;
  const isAuthenticated = localMode || !!user;

  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken }: { forceRefreshToken?: boolean } = {}): Promise<string | null> => {
      if (localMode) {
        return null;
      }

      if (!user) {
        return null;
      }

      try {
        if (forceRefreshToken) {
          const REFRESH_COOLDOWN_MS = 10_000;
          if (Date.now() - lastRefreshErrorAt.current < REFRESH_COOLDOWN_MS) {
            console.log(
              "[Convex Auth] Skipping refresh during cooldown, using cached token",
            );
            return accessTokenRef.current ?? null;
          }

          if (isCrossTabEnabled) {
            const refreshWithLock = async () => {
              const token = await deps.mutex.withLock(async () => {
                return getFreshSharedTokenWithFallback(async () => refresh());
              });
              return token ?? (await getFreshSharedTokenWithFallback(getAccessToken));
            };

            return getFreshSharedTokenWithFallback(refreshWithLock);
          }

          const newToken = await refresh();
          return newToken ?? null;
        }
        return (await getAccessToken()) ?? null;
      } catch {
        lastRefreshErrorAt.current = Date.now();
        console.log("[Convex Auth] Using cached token during network issues");
        return accessTokenRef.current ?? null;
      }
    },
    [localMode, user, getAccessToken, refresh, deps.mutex, isCrossTabEnabled],
  );

  return {
    isLoading,
    isAuthenticated,
    fetchAccessToken,
  };
}
