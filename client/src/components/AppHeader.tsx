import { Logo } from "@/components/brand/Logo";
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

/**
 * The bar holding the sidebar toggle.
 *
 * Below md it is the only way to open the drawer, so it always shows there.
 * On desktop the sidebar is normally open and the bar stays hidden, but
 * Ctrl/Cmd+B collapses the sidebar and a cookie keeps it collapsed for a
 * week. The bar then shows on desktop too, or nothing on screen would bring
 * the sidebar back (tech debt #52).
 */
export function AppHeader() {
  const { state } = useSidebar();

  return (
    // min-h + safe-area padding rather than a fixed h-14: installed on a phone
    // with viewport-fit=cover the header runs under the status bar, and the
    // padding keeps the menu button below it.
    <header
      data-testid="app-header"
      className={cn(
        "sticky top-0 z-50 flex min-h-14 flex-shrink-0 items-center gap-2 border-b bg-background/80 p-2 pt-[calc(0.5rem+env(safe-area-inset-top))] backdrop-blur-sm",
        state === "expanded" && "md:hidden",
      )}
    >
      <SidebarTrigger data-testid="button-sidebar-toggle" />
      <Logo size={24} />
    </header>
  );
}
