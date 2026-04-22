import * as Sentry from "@sentry/react";
import { useEffect, useRef } from "react";
import { useLocation, useSearch } from "wouter";

export function useNavigationBreadcrumb(): void {
  const [pathname] = useLocation();
  const search = useSearch();
  const currentUrl = search ? `${pathname}?${search}` : pathname;
  const previousUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (previousUrlRef.current === currentUrl) return;
    Sentry.addBreadcrumb({
      category: "navigation",
      type: "navigation",
      level: "info",
      message: currentUrl,
      data: { from: previousUrlRef.current, to: currentUrl },
    });
    previousUrlRef.current = currentUrl;
  }, [currentUrl]);
}
