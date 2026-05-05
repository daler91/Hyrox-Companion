const parseBool = (value: unknown, fallback = false): boolean => {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
};

export const featureFlags = {
  emomBuilderEnabled: parseBool(import.meta.env.VITE_EMOM_BUILDER_ENABLED, false),
};
