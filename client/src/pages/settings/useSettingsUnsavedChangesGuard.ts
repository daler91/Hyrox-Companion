import { useLocation, useSearch } from "wouter";

import { useUnsavedChangesPrompt } from "@/hooks/useUnsavedChangesPrompt";

/**
 * The Settings page's leave guard. The current path keeps the `?tab=` query
 * so a cancelled navigation stays on the tab the user was editing.
 */
export function useSettingsUnsavedChangesGuard(hasChanges: boolean) {
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const currentPath = search ? `${location}?${search}` : location;

  return useUnsavedChangesPrompt({
    enabled: hasChanges,
    currentPath,
    navigate: setLocation,
  });
}
