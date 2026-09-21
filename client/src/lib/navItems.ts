import {
  Apple,
  BarChart3,
  CalendarRange,
  type LucideIcon,
  PlusCircle,
  Settings,
} from "lucide-react";

import { featureFlags } from "@/lib/featureFlags";

export interface PrimaryNavItem {
  /** Full label, used in the sidebar and for accessible names. */
  readonly title: string;
  /** Short label for the phone tab bar, where five items share the width. */
  readonly shortTitle: string;
  readonly url: string;
  readonly icon: LucideIcon;
}

/**
 * The app's top-level destinations, shared by the desktop sidebar and the phone
 * tab bar so the two never drift apart.
 */
export const PRIMARY_NAV_ITEMS: readonly PrimaryNavItem[] = [
  { title: "Training", shortTitle: "Training", url: "/", icon: CalendarRange },
  { title: "Log Workout", shortTitle: "Log", url: "/log", icon: PlusCircle },
  ...(featureFlags.nutritionEnabled
    ? [{ title: "Nutrition", shortTitle: "Nutrition", url: "/nutrition", icon: Apple }]
    : []),
  { title: "Analytics", shortTitle: "Analytics", url: "/analytics", icon: BarChart3 },
  { title: "Settings", shortTitle: "Settings", url: "/settings", icon: Settings },
];

/** `nav-log-workout` style test id, the convention the sidebar already uses. */
export function navTestId(prefix: string, title: string): string {
  return `${prefix}-${title.toLowerCase().replaceAll(/\s/g, "-")}`;
}
