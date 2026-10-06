import { createContext, useCallback,useContext, useEffect, useMemo, useState } from "react";

import { getStorageItem, setStorageItem } from "@/lib/safeStorage";

type Theme = "light" | "dark";

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  // Through safeStorage: with site data blocked, reading `localStorage` itself
  // throws, and this renders on every route, so the landing page fell to the
  // error boundary. CL60 (CODEBASE_ANALYSIS_2026-10-03)
  const [theme, setTheme] = useState<Theme>(() => {
    if (globalThis.window !== undefined) {
      const stored = getStorageItem("localStorage", "theme");
      if (stored === "light" || stored === "dark") return stored;
      return globalThis.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return "light";
  });

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(theme);
    setStorageItem("localStorage", "theme", theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === "light" ? "dark" : "light"));
  }, []);

  const contextValue = useMemo(() => ({
    theme,
    toggleTheme
  }), [theme, toggleTheme]);

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
