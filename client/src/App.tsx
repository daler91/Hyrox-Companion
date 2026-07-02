import { ClerkProvider, Show } from "@clerk/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense, useLayoutEffect } from "react";
import { Route,Switch } from "wouter";

import { AppSidebar } from "@/components/AppSidebar";
import { Logo } from "@/components/brand/Logo";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { FeatureErrorBoundaryWrapper } from "@/components/FeatureErrorBoundaryWrapper";
import { PrivacyConsentBanner } from "@/components/PrivacyConsentBanner";
import { ThemeProvider } from "@/components/ThemeProvider";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { OfflineIndicator } from "@/components/ui/OfflineIndicator";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import { useDetectTimezone } from "@/hooks/useDetectTimezone";
import { useEmailCheck } from "@/hooks/useEmailCheck";
import { useFocusMainOnRouteChange } from "@/hooks/useFocusMainOnRouteChange";
import { useNavigationBreadcrumb } from "@/hooks/useNavigationBreadcrumb";
import { useOfflineDropNotifier } from "@/hooks/useOfflineDropNotifier";
import { useOfflineQueueFlush } from "@/hooks/useOfflineQueueFlush";
import { featureFlags } from "@/lib/featureFlags";
import NotFound from "@/pages/not-found";

import { queryClient } from "./lib/queryClient";

// Lazy-loaded like the other routes (S8) so the Timeline page splits into its
// own chunk instead of riding in the main bundle. It's wrapped by the same
// Suspense fallback below, so first authenticated paint shows the spinner briefly.
const Timeline = lazy(() => import("@/pages/Timeline"));
const LogWorkout = lazy(() => import("@/pages/LogWorkout"));
const Settings = lazy(() => import("@/pages/Settings"));
const Analytics = lazy(() => import("@/pages/Analytics"));
const Landing = lazy(() => import("@/pages/Landing"));
const Privacy = lazy(() => import("@/pages/Privacy"));
const Nutrition = lazy(() => import("@/pages/Nutrition"));

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

function isCypressTest(): boolean {
  return globalThis.window !== undefined && "Cypress" in globalThis.window;
}

function isDevPreview(): boolean {
  return import.meta.env.DEV && (!clerkPubKey || (globalThis.window !== undefined && globalThis.window.self !== globalThis.window.top));
}

function shouldBypassAuth(): boolean {
  return isCypressTest() || isDevPreview();
}

function DevModeBanner() {
  return (
    <div
      data-testid="banner-dev-mode"
      // amber-400 on black passes 4.5:1 cleanly (~10:1); yellow-500 + text-xs
      // was marginal. Only renders in dev preview so visual changes are
      // invisible to end users, but keeps parity for screenshots / QA.
      className="relative z-50 shrink-0 bg-amber-400 py-1 text-center text-sm font-semibold text-black"
    >
      DEV MODE — Auth bypass active (Clerk skipped)
    </div>
  );
}

function LazyFallback() {
  return (
    <div className="flex items-center justify-center h-full">
      <LoadingSpinner />
    </div>
  );
}

function AuthenticatedRouter() {
  return (
    <Suspense fallback={<LazyFallback />}>
      <Switch>
        <Route path="/"><FeatureErrorBoundaryWrapper featureName="Timeline"><Timeline /></FeatureErrorBoundaryWrapper></Route>
        <Route path="/log"><FeatureErrorBoundaryWrapper featureName="Log Workout"><LogWorkout /></FeatureErrorBoundaryWrapper></Route>
        <Route path="/analytics"><FeatureErrorBoundaryWrapper featureName="Analytics"><Analytics /></FeatureErrorBoundaryWrapper></Route>
        {featureFlags.nutritionEnabled && (
          <Route path="/nutrition"><FeatureErrorBoundaryWrapper featureName="Nutrition"><Nutrition /></FeatureErrorBoundaryWrapper></Route>
        )}
        <Route path="/settings"><FeatureErrorBoundaryWrapper featureName="Settings"><Settings /></FeatureErrorBoundaryWrapper></Route>
        <Route path="/privacy"><Privacy /></Route>
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

const SIDEBAR_COOKIE_NAME = "sidebar_state";

function getStoredSidebarOpen(): boolean {
  if (globalThis.document === undefined) return true;
  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${SIDEBAR_COOKIE_NAME}=`));
  if (!match) return true;
  return match.split("=")[1] !== "false";
}

function AuthenticatedLayout() {
  const { user, isAuthenticated, isLoading, isAppUserLoaded } = useAuth();
  useEmailCheck(isAuthenticated, isAppUserLoaded);
  useDetectTimezone(isAuthenticated, isAppUserLoaded, user?.userTimezone);
  useOfflineDropNotifier();
  useOfflineQueueFlush();
  useFocusMainOnRouteChange();

  // Lock html/body/#root so only #main-content scrolls. `overflow: clip`
  // removes the visible document scrollbar, and fixing body to the viewport
  // keeps Blink from retaining a programmatic document scroll range from
  // descendant overflow:auto content. Safari <16 falls back to `hidden`,
  // which still removes the visible scrollbar.
  useLayoutEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const root = document.getElementById("root");
    const overflowValue = CSS.supports?.("overflow", "clip") ? "clip" : "hidden";
    const prev = {
      htmlOverflow: html.style.overflow,
      htmlHeight: html.style.height,
      htmlMaxHeight: html.style.maxHeight,
      bodyOverflow: body.style.overflow,
      bodyHeight: body.style.height,
      bodyMaxHeight: body.style.maxHeight,
      bodyPosition: body.style.position,
      bodyInset: body.style.inset,
      bodyWidth: body.style.width,
      rootOverflow: root?.style.overflow,
      rootHeight: root?.style.height,
      rootMaxHeight: root?.style.maxHeight,
      rootMinHeight: root?.style.minHeight,
    };
    html.style.overflow = overflowValue;
    html.style.height = "100%";
    html.style.maxHeight = "100%";
    body.style.overflow = overflowValue;
    body.style.height = "100%";
    body.style.maxHeight = "100%";
    body.style.position = "fixed";
    body.style.inset = "0";
    body.style.width = "100%";
    if (root) {
      root.style.overflow = overflowValue;
      root.style.height = "100%";
      root.style.maxHeight = "100%";
      root.style.minHeight = "0";
    }
    html.classList.add("app-shell-locked");
    return () => {
      html.style.overflow = prev.htmlOverflow;
      html.style.height = prev.htmlHeight;
      html.style.maxHeight = prev.htmlMaxHeight;
      body.style.overflow = prev.bodyOverflow;
      body.style.height = prev.bodyHeight;
      body.style.maxHeight = prev.bodyMaxHeight;
      body.style.position = prev.bodyPosition;
      body.style.inset = prev.bodyInset;
      body.style.width = prev.bodyWidth;
      if (root) {
        root.style.overflow = prev.rootOverflow ?? "";
        root.style.height = prev.rootHeight ?? "";
        root.style.maxHeight = prev.rootMaxHeight ?? "";
        root.style.minHeight = prev.rootMinHeight ?? "";
      }
      html.classList.remove("app-shell-locked");
    };
  }, []);

  if (isLoading) {
    return <LazyFallback />;
  }

  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <div className="flex h-svh min-h-0 flex-col overflow-hidden">
      {isDevPreview() && <DevModeBanner />}
      <SidebarProvider
        className="min-h-0 flex-1 overflow-hidden"
        style={style}
        defaultOpen={getStoredSidebarOpen()}
      >
        <div className="flex min-h-0 flex-1 w-full overflow-hidden">
          <a href="#main-content" className="skip-to-content">
            Skip to main content
          </a>
          <AppSidebar />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <header className="sticky top-0 z-50 flex h-14 flex-shrink-0 items-center gap-2 border-b bg-background/80 p-2 backdrop-blur-sm md:hidden">
              <SidebarTrigger data-testid="button-sidebar-toggle" />
              <Logo size={24} />
            </header>
            {/* tabIndex=-1 so the skip-to-content link can move focus here.
                Without it, browsers move scroll but not focus, which defeats AT users. */}
            <main id="main-content" tabIndex={-1} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto focus:outline-none">
              <Breadcrumbs />
              <AuthenticatedRouter />
            </main>
          </div>
        </div>
        <PrivacyConsentBanner />
      </SidebarProvider>
    </div>
  );
}

function AppContent() {
  useNavigationBreadcrumb();

  if (shouldBypassAuth()) {
    return <AuthenticatedLayout />;
  }

  return (
    <Show
      when="signed-in"
      fallback={
        <Suspense fallback={<LazyFallback />}>
          <Switch>
            <Route path="/privacy"><Privacy /></Route>
            <Route><Landing /></Route>
          </Switch>
        </Suspense>
      }
    >
      <AuthenticatedLayout />
    </Show>
  );
}

function App() {
  const appShell = (
    <>
      <AppContent />
      <Toaster />
      <OfflineIndicator />
    </>
  );

  if (shouldBypassAuth()) {
    return <BaseProviders>{appShell}</BaseProviders>;
  }

  return (
    <ClerkProvider publishableKey={clerkPubKey!}>
      <BaseProviders>{appShell}</BaseProviders>
    </ClerkProvider>
  );
}

function BaseProviders({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>{children}</TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
