const parseBool = (value: unknown, fallback = false): boolean => {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
};

export const featureFlags = {
  emomBuilderEnabled: parseBool(import.meta.env.VITE_EMOM_BUILDER_ENABLED, false),
  // On by default now the nutrition module is complete; set
  // VITE_NUTRITION_ENABLED=false at build time to hide it in an environment.
  nutritionEnabled: parseBool(import.meta.env.VITE_NUTRITION_ENABLED, true),
};
