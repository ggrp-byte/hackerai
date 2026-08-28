"use client";

import {
  useAccessToken as useWorkOSAccessToken,
  useAuth as useWorkOSAuth,
} from "@workos-inc/authkit-nextjs/components";

const isLocalMode = () =>
  process.env.NEXT_PUBLIC_HACKERAI_LOCAL === "true";

const LOCAL_USER = {
  id: "local-user",
  email: "local@localhost",
  firstName: "Local",
  lastName: "User",
  profilePictureUrl: null,
} as const;

export function useAuth() {
  if (isLocalMode()) {
    return {
      user: LOCAL_USER,
      loading: false,
      entitlements: [],
      organizationId: undefined,
      refreshAuth: async () => undefined,
    };
  }

  return useWorkOSAuth();
}

export function useAccessToken() {
  if (isLocalMode()) {
    return {
      accessToken: undefined,
      getAccessToken: async () => null,
      refresh: async () => null,
    };
  }

  return useWorkOSAccessToken();
}
