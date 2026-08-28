"use client";

import { useConvexAuth } from "convex/react";
import { ChatLayout } from "@/app/components/ChatLayout";
import Loading from "@/components/ui/loading";
import { useHasAuthenticatedBefore } from "@/app/hooks/useHasAuthenticatedBefore";
import { ChatRoutePresentationProvider } from "@/app/contexts/ChatRoutePresentationContext";

const fullWidthShell = (
  <div className="h-dvh min-h-0 flex flex-col bg-background overflow-hidden">
    <div className="flex-1 flex items-center justify-center min-h-0">
      <Loading />
    </div>
  </div>
);

function LocalChatRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="h-dvh min-h-0 flex flex-col bg-background overflow-hidden">
      <ChatRoutePresentationProvider>
        <ChatLayout>{children}</ChatLayout>
      </ChatRoutePresentationProvider>
    </div>
  );
}

function AuthenticatedChatRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const hasAuthHint = useHasAuthenticatedBefore();

  if (isAuthenticated || (isLoading && hasAuthHint)) {
    return (
      <div className="h-dvh min-h-0 flex flex-col bg-background overflow-hidden">
        <ChatRoutePresentationProvider>
          <ChatLayout>{children}</ChatLayout>
        </ChatRoutePresentationProvider>
      </div>
    );
  }

  if (isLoading) {
    return fullWidthShell;
  }

  return (
    <div className="h-dvh min-h-0 flex flex-col bg-background overflow-hidden">
      {children}
    </div>
  );
}

/**
 * Shared layout for / and /c/[id]. Local mode does not use Convex auth,
 * so it must not call useConvexAuth outside ConvexProviderWithAuth.
 */
export default function ChatRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const isLocalMode = process.env.NEXT_PUBLIC_HACKERAI_LOCAL === "true";

  if (isLocalMode) {
    return <LocalChatRouteLayout>{children}</LocalChatRouteLayout>;
  }

  return <AuthenticatedChatRouteLayout>{children}</AuthenticatedChatRouteLayout>;
}
