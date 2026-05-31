import { useEffect } from "react";

const BRAND = "fitai.coach";

/**
 * Set `document.title` for the current page. Static titles leave assistive-tech
 * users without an orientation cue when navigating between routes, so each page
 * declares its own (S4). Pass an empty string for the brand-only title.
 */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title ? `${title} — ${BRAND}` : BRAND;
  }, [title]);
}
