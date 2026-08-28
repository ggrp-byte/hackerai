"use client";

import { ReactNode, useState } from "react";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithAuth } from "convex/react";
import { AuthKitProvider } from "@workos-inc/authkit-nextjs/components";
import type { NoUserInfo, UserInfo } from "@workos-inc/authkit-nextjs";
import { useAuthFromAuthKit } from "@/lib/auth/use-auth-from-authkit";

const PRERENDER_CONVEX_URL = "https://placeholder.convex.cloud";

type AuthKitInitialAuth =
  Omit<UserInfo, "accessToken"> | Omit<NoUserInfo, "accessToken">;

const useLocalAuth = () => ({
  isLoading: false,
  isAuthenticated: true,
  fetchAccessToken: async () => null,
});

export function ConvexClientProvider({
  children,
  initialAuth,
}: {
  children: ReactNode;
  initialAuth: AuthKitInitialAuth;
}) {
  const [convex] = useState(() => {
    const convexUrl =
      process.env.NEXT_PUBLIC_CONVEX_URL ??
      (typeof window === "undefined" ? PRERENDER_CONVEX_URL : undefined);

    if (!convexUrl) {
      throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
    }

    return new ConvexReactClient(convexUrl);
  });

  const isLocalMode = process.env.NEXT_PUBLIC_HACKERAI_LOCAL === "true";

  if (isLocalMode) {
    // GlobalState still consumes WorkOS AuthKit hooks for UI/session state.
    // Keep that React context present, but start it signed out so AuthKit does
    // not try to call its server-side access-token action in local mode.
    return (
      <AuthKitProvider initialAuth={{ user: null }} onSessionExpired={false}>
        <ConvexProviderWithAuth client={convex} useAuth={useLocalAuth}>
          {children}
        </ConvexProviderWithAuth>
      </AuthKitProvider>
    );
  }

  return (
    <AuthKitProvider initialAuth={initialAuth} onSessionExpired={false}>
      <ConvexProviderWithAuth client={convex} useAuth={useAuthFromAuthKit}>
        {children}
      </ConvexProviderWithAuth>
    </AuthKitProvider>
  );
}
