import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const showSpy = vi.fn();

vi.mock("@clerk/react", () => ({
  ClerkProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="clerk-provider">{children}</div>,
  Show: ({ when, fallback, children }: { when: string; fallback: React.ReactNode; children: React.ReactNode }) => {
    showSpy(when);
    return <>{children ?? fallback}</>;
  },
}));

vi.mock("@/components/ThemeProvider", () => ({ ThemeProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="theme-provider">{children}</div> }));
vi.mock("@/components/ui/tooltip", () => ({ TooltipProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="tooltip-provider">{children}</div> }));
vi.mock("@tanstack/react-query", () => ({ QueryClientProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="query-provider">{children}</div> }));
vi.mock("./lib/queryClient", () => ({ queryClient: {} }));

vi.mock("@/components/ui/toaster", () => ({ Toaster: () => <div data-testid="toaster" /> }));
vi.mock("@/components/ui/OfflineIndicator", () => ({ OfflineIndicator: () => <div data-testid="offline-indicator" /> }));
vi.mock("@/components/PrivacyConsentBanner", () => ({ PrivacyConsentBanner: () => <div data-testid="privacy-banner" /> }));
vi.mock("@/components/Breadcrumbs", () => ({ Breadcrumbs: () => <div data-testid="breadcrumbs" /> }));
vi.mock("@/components/AppSidebar", () => ({ AppSidebar: () => <div data-testid="app-sidebar" /> }));
vi.mock("@/components/brand/Logo", () => ({ Logo: () => <div data-testid="logo" /> }));
vi.mock("@/components/FeatureErrorBoundaryWrapper", () => ({ FeatureErrorBoundaryWrapper: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/components/ui/loading-spinner", () => ({ LoadingSpinner: () => <div data-testid="loading-spinner" /> }));
vi.mock("@/components/ui/sidebar", () => ({
  SidebarProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="sidebar-provider">{children}</div>,
  SidebarTrigger: () => <button data-testid="button-sidebar-toggle" />,
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAuthenticated: true, isLoading: false, isAppUserLoaded: true }) }));
vi.mock("@/hooks/useEmailCheck", () => ({ useEmailCheck: vi.fn() }));
vi.mock("@/hooks/useNavigationBreadcrumb", () => ({ useNavigationBreadcrumb: vi.fn() }));
vi.mock("@/hooks/useOfflineDropNotifier", () => ({ useOfflineDropNotifier: vi.fn() }));

vi.mock("@/pages/not-found", () => ({ default: () => <div>Not Found</div> }));
vi.mock("@/pages/Timeline", () => ({ default: () => <div data-testid="timeline-page">Timeline</div> }));
vi.mock("@/pages/LogWorkout", () => ({ default: () => <div>Log Workout</div> }));
vi.mock("@/pages/Settings", () => ({ default: () => <div>Settings</div> }));
vi.mock("@/pages/Analytics", () => ({ default: () => <div>Analytics</div> }));
vi.mock("@/pages/Landing", () => ({ default: () => <div>Landing</div> }));
vi.mock("@/pages/Privacy", () => ({ default: () => <div>Privacy</div> }));

async function loadApp() {
  const mod = await import("./App");
  return mod.default;
}

describe("App providers", () => {
  beforeEach(() => {
    showSpy.mockClear();
    vi.resetModules();
    vi.unstubAllEnvs();
    delete (globalThis as typeof globalThis & { Cypress?: unknown }).Cypress;
  });

  it("renders the same base provider stack when auth is bypassed", async () => {
    (globalThis as typeof globalThis & { Cypress?: unknown }).Cypress = {};
    const App = await loadApp();

    render(<App />);

    expect(screen.getByTestId("query-provider")).toBeInTheDocument();
    expect(screen.getByTestId("theme-provider")).toBeInTheDocument();
    expect(screen.getByTestId("tooltip-provider")).toBeInTheDocument();
    expect(screen.queryByTestId("clerk-provider")).not.toBeInTheDocument();
    expect(screen.getByTestId("timeline-page")).toBeInTheDocument();
    expect(screen.getByTestId("toaster")).toBeInTheDocument();
    expect(screen.getByTestId("offline-indicator")).toBeInTheDocument();
  });

  it("keeps the same app shell composition when auth is enabled", async () => {
    vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", "pk_test_123");
    const App = await loadApp();

    render(<App />);

    expect(screen.getByTestId("clerk-provider")).toBeInTheDocument();
    expect(screen.getByTestId("query-provider")).toBeInTheDocument();
    expect(screen.getByTestId("theme-provider")).toBeInTheDocument();
    expect(screen.getByTestId("tooltip-provider")).toBeInTheDocument();
    expect(screen.getByTestId("timeline-page")).toBeInTheDocument();
    expect(screen.getByTestId("toaster")).toBeInTheDocument();
    expect(screen.getByTestId("offline-indicator")).toBeInTheDocument();
    expect(showSpy).toHaveBeenCalledWith("signed-in");
  });

  it("keeps authenticated pages constrained to the main scroll region", async () => {
    (globalThis as typeof globalThis & { Cypress?: unknown }).Cypress = {};
    const App = await loadApp();

    render(<App />);

    const mainContent = document.querySelector("#main-content");
    expect(mainContent).toHaveClass("min-h-0", "flex-1", "overflow-auto");
    expect(mainContent?.parentElement).toHaveClass("min-h-0", "flex-1", "min-w-0");
  });
});
