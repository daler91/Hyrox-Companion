import { ClerkProvider, Show } from "@clerk/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
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
import { useEmailCheck } from "@/hooks/useEmailCheck";
import { useNavigationBreadcrumb } from "@/hooks/useNavigationBreadcrumb";
import { useOfflineDropNotifier } from "@/hooks/useOfflineDropNotifier";
import NotFound from "@/pages/not-found";
import Timeline from "@/pages/Timeline";

import { queryClient } from "./lib/queryClient";

const LogWorkout = lazy(() => import("@/pages/LogWorkout"));
const Settings = lazy(() => import("@/pages/Settings"));
const Analytics = lazy(() => import("@/pages/Analytics"));
const Landing = lazy(() => import("@/pages/Landing"));
const Privacy = lazy(() => import("@/pages/Privacy"));

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
      className="bg-yellow-500 text-black text-center text-xs py-1 font-semibold z-50 relative"
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
  const { isAuthenticated, isLoading } = useAuth();
  useEmailCheck(isAuthenticated);
  useOfflineDropNotifier();

  if (isLoading) {
    return <LazyFallback />;
  }

  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider
      style={style as React.CSSProperties}
      defaultOpen={getStoredSidebarOpen()}
    >
      <div className="flex h-screen w-full">
        <a href="#main-content" className="skip-to-content">
          Skip to main content
        </a>
        <AppSidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <header className="sticky top-0 z-50 flex items-center gap-2 p-2 border-b h-14 flex-shrink-0 md:hidden bg-background/80 backdrop-blur-sm">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            <Logo size={24} />
          </header>
          {/* tabIndex=-1 so the skip-to-content link can move focus here.
              Without it, browsers move scroll but not focus, which defeats AT users. */}
          <main id="main-content" tabIndex={-1} className="flex-1 overflow-auto focus:outline-none">
            <Breadcrumbs />
            <AuthenticatedRouter />
          </main>
        </div>
      </div>
      <PrivacyConsentBanner />
    </SidebarProvider>
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
  if (shouldBypassAuth()) {
    return (
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <TooltipProvider>
            {isDevPreview() && <DevModeBanner />}
            <AppContent />
            <Toaster />
            <OfflineIndicator />
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    );
  }

  return (
    <ClerkProvider publishableKey={clerkPubKey!}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <TooltipProvider>
            <AppContent />
            <Toaster />
            <OfflineIndicator />
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

export default App;
