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

/**
 * Shared layout for / and /c/[id]. In local mode, render the authenticated
 * shell unconditionally because local Convex auth is synthetic and does not
 * depend on the WorkOS browser session.
 */
export default function ChatRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const hasAuthHint = useHasAuthenticatedBefore();
  const isLocalMode = process.env.NEXT_PUBLIC_HACKERAI_LOCAL === "true";

  if (isLocalMode || isAuthenticated || (isLoading && hasAuthHint)) {
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
