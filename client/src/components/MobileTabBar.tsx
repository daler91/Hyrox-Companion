import { Link, useLocation } from "wouter";

import { navTestId, PRIMARY_NAV_ITEMS } from "@/lib/navItems";
import { cn } from "@/lib/utils";

function isTabActive(location: string, url: string): boolean {
  if (url === "/") return location === "/";
  return location === url || location.startsWith(`${url}/`);
}

/**
 * Phone-only bottom tab bar for the app's five destinations. The drawer stays
 * for the rest (theme, log out), but switching sections mid-session used to be
 * two taps at the far top corner; now it is one, under the thumb. Rendered in
 * the layout's flex column below <main>, so it takes real height rather than
 * floating over content, and fixed elements offset by `--mobile-nav-h`.
 */
export function MobileTabBar() {
  const [location] = useLocation();

  return (
    <nav
      aria-label="Primary"
      className="z-40 flex shrink-0 items-stretch border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm md:hidden"
      data-testid="mobile-tab-bar"
    >
      {PRIMARY_NAV_ITEMS.map((item) => {
        const active = isTabActive(location, item.url);
        return (
          <Link
            key={item.url}
            href={item.url}
            aria-label={item.title}
            aria-current={active ? "page" : undefined}
            data-testid={navTestId("nav-tab", item.title)}
            className={cn(
              "flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              active ? "text-primary" : "text-muted-foreground",
            )}
          >
            <item.icon className="h-5 w-5" strokeWidth={active ? 2.5 : 2} aria-hidden="true" />
            <span className="max-w-full truncate">{item.shortTitle}</span>
          </Link>
        );
      })}
    </nav>
  );
}
