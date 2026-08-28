"use client";

import { ReactNode, useState } from "react";
import { ConvexReactClient, ConvexProvider, ConvexProviderWithAuth } from "convex/react";
import { AuthKitProvider } from "@workos-inc/authkit-nextjs/components";
import type { NoUserInfo, UserInfo } from "@workos-inc/authkit-nextjs";
import { useAuthFromAuthKit } from "@/lib/auth/use-auth-from-authkit";

const PRERENDER_CONVEX_URL = "https://placeholder.convex.cloud";

type AuthKitInitialAuth =
  Omit<UserInfo, "accessToken"> | Omit<NoUserInfo, "accessToken">;

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
    // Local mode deliberately does not fabricate a WorkOS/Convex JWT.
    // Keep AuthKit context available to legacy UI consumers, but use a plain
    // ConvexProvider so Convex does not enter an auth/token refresh loop.
    return (
      <AuthKitProvider initialAuth={{ user: null }} onSessionExpired={false}>
        <ConvexProvider client={convex}>{children}</ConvexProvider>
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
