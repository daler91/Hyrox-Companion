import { useAuth } from "@/hooks/useAuth";
import { getMafCeiling } from "@/lib/mafFormat";

/**
 * The athlete's MAF aerobic ceiling in bpm, or null when they don't train to
 * one. Rides on the auth user query every surface already holds, so the several
 * components that ask cost one fetch between them.
 */
export function useMafCeiling(): number | null {
  const { user } = useAuth();
  return getMafCeiling(user);
}
