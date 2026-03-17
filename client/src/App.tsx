import { lazy, Suspense } from "react";
import { Switch, Route } from "wouter";
import { ClerkProvider, SignedIn, SignedOut } from "@clerk/clerk-react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { ThemeProvider } from "@/components/ThemeProvider";
import NotFound from "@/pages/not-found";
import Timeline from "@/pages/Timeline";
import { Loader2 } from "lucide-react";

const LogWorkout = lazy(() => import("@/pages/LogWorkout"));
const Settings = lazy(() => import("@/pages/Settings"));
const Analytics = lazy(() => import("@/pages/Analytics"));
const Landing = lazy(() => import("@/pages/Landing"));

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

function isCypressTest(): boolean {
  return typeof globalThis !== "undefined" && "Cypress" in globalThis;
}

function isDevPreview(): boolean {
  return import.meta.env.DEV && (!clerkPubKey || window.self !== window.top);
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
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}

function AuthenticatedRouter() {
  return (
    <Suspense fallback={<LazyFallback />}>
      <Switch>
        <Route path="/" component={Timeline} />
        <Route path="/log" component={LogWorkout} />
        <Route path="/analytics" component={Analytics} />
        <Route path="/settings" component={Settings} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function AuthenticatedLayout() {
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <header className="flex items-center gap-2 p-2 border-b h-14 flex-shrink-0 md:hidden">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            <span className="font-semibold">HyroxTracker</span>
          </header>
          <main className="flex-1 overflow-auto">
            <AuthenticatedRouter />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function AppContent() {
  if (shouldBypassAuth()) {
    return <AuthenticatedLayout />;
  }

  return (
    <>
      <SignedIn>
        <AuthenticatedLayout />
      </SignedIn>
      <SignedOut>
        <Suspense fallback={<LazyFallback />}>
          <Landing />
        </Suspense>
      </SignedOut>
    </>
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
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    );
  }

  return (
    <ClerkProvider publishableKey={clerkPubKey}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <TooltipProvider>
            <AppContent />
            <Toaster />
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

export default App;
